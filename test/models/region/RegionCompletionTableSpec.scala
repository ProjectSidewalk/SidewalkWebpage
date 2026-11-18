package models.region

import models.utils.MyPostgresProfile.api.*
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec, StreetFixtures}

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future, Promise}

/** How `region_completion` is rebuilt (#6014): in place, never emptied, and safe to run twice at once. */
class RegionCompletionTableSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb with StreetFixtures {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val table: RegionCompletionTable = app.injector.instanceOf[RegionCompletionTable]

  /** One region's (total_distance, audited_distance), or None when it has no row. */
  private def distances(regionId: Int): DBIO[Option[(Double, Double)]] =
    sql"SELECT total_distance, audited_distance FROM region_completion WHERE region_id = $regionId"
      .as[(Double, Double)]
      .headOption

  "rebuild" should {
    "overwrite stale rows, add missing ones, and drop rows of deleted regions" in {
      val (written, rowCount, stale, fresh, empty, deleted) = runRolledBack(for {
        // Two equal streets, one explored (priority below 1), so exactly half the region's distance is audited.
        staleRegion   <- insertRegion()
        _             <- insertStreet(Some(staleRegion), withPriority = true)
        _             <- insertStreet(Some(staleRegion), withPriority = true, priority = 0.5)
        _             <- sqlu"INSERT INTO region_completion VALUES ($staleRegion, -1, -1)"
        freshRegion   <- insertRegion()
        _             <- insertStreet(Some(freshRegion), withPriority = true)
        emptyRegion   <- insertRegion()
        deletedRegion <- insertRegion(deleted = true)
        _             <- sqlu"INSERT INTO region_completion VALUES ($deletedRegion, 5, 5)"
        written       <- table.rebuild
        rowCount      <- sql"SELECT COUNT(*) FROM region_completion".as[Int].head
        stale         <- distances(staleRegion)
        fresh         <- distances(freshRegion)
        empty         <- distances(emptyRegion)
        deleted       <- distances(deletedRegion)
      } yield (written, rowCount, stale, fresh, empty, deleted))

      written mustBe rowCount
      val (staleTotal, staleAudited) = stale.get
      val (freshTotal, freshAudited) = fresh.get
      freshTotal must be > 0.0
      freshAudited mustBe 0.0
      staleTotal mustBe 2 * freshTotal +- 1e-6
      staleAudited mustBe freshTotal +- 1e-6
      empty mustBe Some((0.0, 0.0))
      deleted mustBe None
    }

    "finish while another transaction that has read the table is still open, as the nightly backup's is" in {
      // The reader keeps its read lock until `release` completes, the way a backup holds one on every table.
      val hasRead = Promise[Unit]()
      val release = Promise[Unit]()
      val reader  = dbConfig.db.run(
        sql"SELECT COUNT(*) FROM region_completion"
          .as[Int]
          .flatMap { _ =>
            hasRead.success(())
            DBIO.from(release.future)
          }
          .transactionally
      )
      try {
        Await.result(hasRead.future, dbTimeout)
        Await.result(dbConfig.db.run(table.rebuild), 30.seconds) must be > 0
      } finally {
        release.success(())
        Await.result(reader, dbTimeout)
      }
    }

    "let several rebuilds run at once without one failing on the other's rows" in {
      // These commit, harmlessly: a rebuild only rewrites the table to what the streets already say.
      val rebuilds = Future.sequence((1 to 6).map(_ => dbConfig.db.run(table.rebuild)))
      val written  = Await.result(rebuilds, dbTimeout)
      written.distinct must have size 1
    }
  }

  "rebuildIfEmpty" should {
    "leave a filled table alone and fill an empty one" in {
      val (whenFilled, whenEmpty, rowCount) = runRolledBack(for {
        _          <- insertRegion()
        _          <- table.rebuild
        whenFilled <- table.rebuildIfEmpty
        _          <- sqlu"DELETE FROM region_completion"
        whenEmpty  <- table.rebuildIfEmpty
        rowCount   <- sql"SELECT COUNT(*) FROM region_completion".as[Int].head
      } yield (whenFilled, whenEmpty, rowCount))

      whenFilled mustBe 0
      whenEmpty must be > 0
      whenEmpty mustBe rowCount
    }
  }

  "updateAuditedDistance" should {
    "skip the credit rather than fail when the region has no row" in {
      val updated = runRolledBack(for {
        regionId <- insertRegion()
        streetId <- insertStreet(Some(regionId), withPriority = true, priority = 0.5)
        _        <- sqlu"DELETE FROM region_completion"
        updated  <- table.updateAuditedDistance(streetId)
      } yield updated)

      updated mustBe 0
    }
  }
}
