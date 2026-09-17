package service

import models.api.{RegionSpotlightRowForApi, SpotlightUnit, StreetSpotlightRowForApi}
import models.region.{RegionAccessScoreTable, RegionAccessScoreTableDef}
import models.street.{StreetAccessScoreTable, StreetAccessScoreTableDef}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.i18n.Lang
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import scala.concurrent.duration._
import scala.concurrent.{Await, Future}

/**
 * DB-backed cover for the AccessScore Spotlight's write-then-read path (#5215).
 *
 * [[AccessScoreSpotlightSpec]] pins the rules with no database attached; what it cannot reach is the half that is
 * raw SQL and Slick mappings — the nightly insert, the "newest run" read, the qualification bars restated in the
 * WHERE clause, and the `region` join the module's names come from. A typo in any of those compiles and then fails
 * on a live landing page, so they are exercised here against a real Postgres.
 *
 * The snapshot is the real one the clustering job runs, so this writes real rows: the region table gains a run (it
 * accumulates by design) and the street table is replaced whole, exactly as tonight's job would. Nothing is
 * restored afterwards, because there is nothing to restore — the next run overwrites or appends the same way.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI). The dev
 * database is tiny and may have nothing ranked at all, which is a state the module is built for, so the assertions
 * are invariants rather than counts.
 */
class AccessScoreSpotlightSnapshotSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val service                    = app.injector.instanceOf[AccessScoreSpotlightService]
  private val regionScoreTable           = app.injector.instanceOf[RegionAccessScoreTable]
  private val streetScoreTable           = app.injector.instanceOf[StreetAccessScoreTable]
  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 120.seconds)
  private def await[T](f: Future[T]): T  = Await.result(f, 120.seconds)
  private val regionScores               = TableQuery[RegionAccessScoreTableDef]
  private val streetScores               = TableQuery[StreetAccessScoreTableDef]

  "the nightly snapshot" should {
    "write a region row for every region and replace the street table whole" in {
      val written = await(service.recordSnapshot())
      written.regions must be >= 0
      written.streets must be >= 0

      val latestRegionRun = run(regionScoreTable.latestComputedAt(None))
      latestRegionRun mustBe defined
      // Every region row of that run, which is what the endpoint reads.
      val rows: Seq[RegionSpotlightRowForApi] = run(regionScoreTable.getLatestSnapshot(None))
      rows.size mustBe written.regions
      rows.foreach { row =>
        row.name.trim must not be empty
        row.completionRate must (be >= 0.0 and be <= 1.0)
        row.auditedDistanceM must be >= 0.0
        // The explored length can't exceed the whole. A scored region can have no clusters at all: an explored
        // street nobody labeled scores as a confirmed absence of problems, which is what the CI seed holds.
        row.totalDistanceM must be >= row.auditedDistanceM
        row.clusterCount must be >= 0
        row.score.foreach(score => score must (be >= 0.0 and be <= 1.0))
      }

      // The street table holds one run and only one, since each run replaces it.
      val streetRuns = run(streetScores.map(_.computedAt).distinct.result)
      streetRuns.size must be <= 1
      run(streetScores.length.result) mustBe written.streets
    }

    "leave the previous run readable if a second one lands" in {
      // Region rows accumulate, which is the score history the table exists to give for free.
      val before = run(regionScores.length.result)
      await(service.recordSnapshot())
      run(regionScores.length.result) must be >= before
      // Two runs never collide on the (region, computed_at) unique key, and the read still takes exactly one run.
      val rows = run(regionScoreTable.getLatestSnapshot(None))
      rows.map(_.regionId).distinct.size mustBe rows.size
    }

    "roll street edges up so a way appears once per region" in {
      await(service.recordSnapshot())
      val keys = run(streetScores.map(row => (row.osmWayId, row.regionId)).result)
      keys.distinct.size mustBe keys.size
      run(streetScores.map(row => (row.lengthM, row.tieBreak)).result).foreach { case (lengthM, tieBreak) =>
        lengthM must be >= 0.0
        tieBreak must (be >= 0.0 and be < 1.0)
      }
    }
  }

  "the Spotlight feed" should {
    "answer from the snapshot with lists bounded by n and counts that agree" in {
      await(service.recordSnapshot())

      for (unit <- SpotlightUnit.All) {
        val feed = await(service.getSpotlight(unit, 5))
        withClue(s"unit $unit: ") {
          feed.unit mustBe unit
          feed.minCompletion mustBe AccessScoreSpotlight.MinRegionCompletion
          feed.qualifying must be <= feed.total
          feed.top.size must be <= 5
          feed.bottom.size must be <= 5
          feed.top.size must be <= feed.qualifying
          // Every ranked row has a score, and the lists run in the directions their headings claim.
          feed.top.flatMap(_.score) mustBe feed.top.map(_.score.get)
          feed.top.flatMap(_.score) mustBe feed.top.flatMap(_.score).sorted.reverse
          feed.bottom.flatMap(_.score) mustBe feed.bottom.flatMap(_.score).sorted
          if (feed.qualifying > 0) feed.computedAt mustBe defined
        }
      }
    }

    "offer the closest-to-qualifying regions only while the ranked list is short" in {
      await(service.recordSnapshot())
      val feed = await(service.getSpotlight(SpotlightUnit.Regions, 5))

      if (feed.qualifying >= 5) feed.nearest mustBe empty
      else {
        feed.nearest.size must be <= 5
        // Best-explored first, and never a region that is already ranked.
        val rates = feed.nearest.collect { case row: RegionSpotlightRowForApi => row.completionRate }
        rates mustBe rates.sorted.reverse
        feed.nearest
          .collect { case row: RegionSpotlightRowForApi => row }
          .foreach(row => AccessScoreSpotlight.regionQualifies(row) mustBe false)
      }
      // A street is never a "go explore this" ask; that belongs to the neighborhood it is in.
      await(service.getSpotlight(SpotlightUnit.Streets, 5)).nearest mustBe empty
    }

    "name every street row's neighborhood, which the region join is there for" in {
      await(service.recordSnapshot())
      val feed = await(service.getSpotlight(SpotlightUnit.Streets, 5))

      (feed.top ++ feed.bottom).collect { case row: StreetSpotlightRowForApi => row }.foreach { row =>
        row.regionName.trim must not be empty
        row.lengthM must be >= AccessScoreSpotlight.MinStreetLengthMeters
        row.streetEdgeId must be > 0
      }
    }

    "read another city's schema through the same queries the cross-city scope uses" in {
      // The /cities fan-out runs these very statements with a schema spliced in, and a schema name cannot be a bind
      // parameter, so the spliced form is what has to be proven to parse and run.
      val configService = app.injector.instanceOf[ConfigService]
      val schema        = Some(configService.getCitySchema(configService.getCityId))
      noException should be thrownBy run(regionScoreTable.getLatestSnapshot(schema))
      noException should be thrownBy run(regionScoreTable.latestComputedAt(schema))
      noException should be thrownBy run(
        streetScoreTable.getSpotlight(
          5,
          AccessScoreSpotlight.MinStreetLengthMeters,
          AccessScoreSpotlight.MinStreetClusters,
          schema
        )
      )
    }

    "fan out over the public cities without failing on a city it cannot read" in {
      val feed = await(service.getCrossCitySpotlight(SpotlightUnit.Regions, 5, Lang("en")))
      feed.unit mustBe SpotlightUnit.Regions
      feed.qualifying must be <= feed.total
      feed.nearest mustBe empty
      // A cross-city row must name its deployment, or a click has nowhere to go.
      (feed.top ++ feed.bottom).foreach(row => row.city mustBe defined)
    }
  }

  "the table helper" should {
    "quote another schema's name and leave this connection's own bare" in {
      RegionAccessScoreTable.qualified(Some("sidewalk_seattle"), "region_access_score") mustBe
        "\"sidewalk_seattle\".region_access_score"
      RegionAccessScoreTable.qualified(None, "region_access_score") mustBe "region_access_score"
    }
  }
}
