package models.street

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

import java.time.OffsetDateTime

/**
 * DB-backed tests for the three `street_edge_issue` reads behind the Street Status page's missing-imagery views
 * (#4928): the weekly report series, the by-region ranking, and the "Awaiting confirmation" queue.
 *
 * These are the surfaces that decide where the offline imagery checker gets pointed next, so what matters is what
 * they let through: corroboration has to mean distinct *accounts* rather than a repeat visitor, a street already
 * retired needs no further evidence, and a neighborhood that has itself been retired must not out-rank a live one.
 *
 * Every fixture is seeded here — regions, streets, users, reports — rather than found in whatever the connected
 * database holds, so an empty seed can't make a case pass without exercising anything. All of it runs inside a
 * deliberately rolled-back transaction, so the shared dev DB is left untouched. Requires a Postgres+PostGIS database
 * (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); scheduling actors are disabled.
 */
class NoImageryReportsSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val issueTable = app.injector.instanceOf[StreetEdgeIssueTable]

  private val minReporters = 2
  private val noLimit      = 100

  /** A window wide enough to hold every fixture except the ones deliberately placed outside it. */
  private def since: OffsetDateTime = OffsetDateTime.now.minusWeeks(8)

  private def insertUser(suffix: String): DBIO[String] = {
    val id = s"4928-report-user-$suffix"
    sqlu"""INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email)
           VALUES ($id, ${s"user-$suffix-4928"}, ${s"$id@example.test"})""".map(_ => id)
  }

  // Ids are assigned as MAX + 1 rather than left to the sequences. The dev database is seeded from a dump that
  // inserts explicit ids without advancing them, so `nextval` hands back ids that already exist (street_edge is at
  // 2172 with its sequence still on 4). Reading MAX inside the transaction also sees this spec's own earlier rows.
  private def insertRegion(name: String, deleted: Boolean): DBIO[Int] = {
    sql"""INSERT INTO region (region_id, data_source, name, geom, deleted)
          SELECT COALESCE(MAX(region_id), 0) + 1, '4928-spec', $name,
                 ST_GeomFromText('MULTIPOLYGON(((0 0, 0 1, 1 1, 1 0, 0 0)))', 4326), $deleted
          FROM region
          RETURNING region_id""".as[Int].head
  }

  /** A street in a region, at a status. Each gets its own `street_edge_region` row, which is one-to-one. */
  private def insertStreet(regionId: Int, status: StreetEdgeStatus.Value): DBIO[Int] = {
    for {
      streetId <- sql"""INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
                        SELECT COALESCE(MAX(street_edge_id), 0) + 1,
                               ST_GeomFromText('LINESTRING(0 0, 0.001 0.001)', 4326), 0, 0, 0.001, 0.001,
                               'residential'::way_type, ${status.toString}::street_edge_status
                        FROM street_edge
                        RETURNING street_edge_id""".as[Int].head
      _ <- sqlu"""INSERT INTO street_edge_region (street_edge_region_id, street_edge_id, region_id)
                  SELECT COALESCE(MAX(street_edge_region_id), 0) + 1, $streetId, $regionId
                  FROM street_edge_region"""
    } yield streetId
  }

  private def report(streetId: Int, userId: String, at: OffsetDateTime): DBIO[Int] = {
    sqlu"""INSERT INTO street_edge_issue (street_edge_issue_id, street_edge_id, issue, user_id, ip_address, timestamp)
           SELECT COALESCE(MAX(street_edge_issue_id), 0) + 1, $streetId,
                  ${StreetEdgeIssueType.PanoNotAvailable.toString}::street_edge_issue_type, $userId, '0.0.0.0', $at
           FROM street_edge_issue"""
  }

  "reportsByWeek" should {
    "count reports and distinct streets separately, bucketed by week" in {
      val weeks = runRolledBack(for {
        user    <- insertUser("a")
        other   <- insertUser("b")
        region  <- insertRegion("Live region", deleted = false)
        streetA <- insertStreet(region, StreetEdgeStatus.Open)
        streetB <- insertStreet(region, StreetEdgeStatus.Open)
        // Two labelers on one street plus a second street, all in the same week: 3 reports across 2 streets. The
        // distinct-street count is the number worth watching, so the two must not collapse into one figure.
        _      <- report(streetA, user, OffsetDateTime.now)
        _      <- report(streetA, other, OffsetDateTime.now)
        _      <- report(streetB, user, OffsetDateTime.now)
        _      <- report(streetA, user, OffsetDateTime.now.minusWeeks(3))
        result <- issueTable.reportsByWeek(since)
      } yield result)

      // Other rows may exist in the connected DB, so assert on the totals this spec seeded rather than on the
      // whole result: 4 reports over 2 buckets, and the busy week separates its two counts.
      weeks.map(_.reportCount).sum must be >= 4
      weeks.exists(week => week.reportCount >= 3 && week.streetCount == 2) mustBe true
    }

    "leave out reports older than the window" in {
      val weeks = runRolledBack(for {
        user   <- insertUser("a")
        region <- insertRegion("Live region", deleted = false)
        street <- insertStreet(region, StreetEdgeStatus.Open)
        _      <- report(street, user, OffsetDateTime.now.minusWeeks(30))
        result <- issueTable.reportsByWeek(since)
      } yield result)

      weeks.exists(_.weekStart.isBefore(since.toLocalDate)) mustBe false
    }
  }

  "topReportRegions" should {
    "rank regions by distinct reported streets, worst first" in {
      val regions = runRolledBack(for {
        user   <- insertUser("a")
        other  <- insertUser("b")
        busy   <- insertRegion("Zzz busy region", deleted = false)
        quiet  <- insertRegion("Aaa quiet region", deleted = false)
        busyA  <- insertStreet(busy, StreetEdgeStatus.Open)
        busyB  <- insertStreet(busy, StreetEdgeStatus.Open)
        quietA <- insertStreet(quiet, StreetEdgeStatus.Open)
        _      <- report(busyA, user, OffsetDateTime.now)
        _      <- report(busyB, other, OffsetDateTime.now)
        // The quiet region has more raw reports but fewer distinct streets, which is what the ranking keys on --
        // report volume alone says more about traffic than about imagery.
        _      <- report(quietA, user, OffsetDateTime.now)
        _      <- report(quietA, other, OffsetDateTime.now)
        _      <- report(quietA, user, OffsetDateTime.now.minusDays(1))
        result <- issueTable.topReportRegions(since, noLimit)
      } yield result)

      val seeded = regions.filter(region => region.regionName.endsWith("region"))
      seeded.map(_.regionName) must contain theSameElementsInOrderAs Seq("Zzz busy region", "Aaa quiet region")
      seeded.head.streetCount mustBe 2
      seeded.last.reportCount mustBe 3
    }

    "leave out deleted regions, which cannot lose streets they no longer have" in {
      val regions = runRolledBack(for {
        user    <- insertUser("a")
        deleted <- insertRegion("Retired neighborhood", deleted = true)
        street  <- insertStreet(deleted, StreetEdgeStatus.Open)
        _       <- report(street, user, OffsetDateTime.now)
        result  <- issueTable.topReportRegions(since, noLimit)
      } yield result)

      // The page frames this list as "the regions most likely to lose streets next", so a retired neighborhood
      // ranking into it points the imagery checker somewhere nobody can audit and pushes a live region out.
      regions.map(_.regionName) must not contain "Retired neighborhood"
    }

    "honor the limit" in {
      val regions = runRolledBack(for {
        user    <- insertUser("a")
        first   <- insertRegion("Region one", deleted = false)
        second  <- insertRegion("Region two", deleted = false)
        streetA <- insertStreet(first, StreetEdgeStatus.Open)
        streetB <- insertStreet(second, StreetEdgeStatus.Open)
        _       <- report(streetA, user, OffsetDateTime.now)
        _       <- report(streetB, user, OffsetDateTime.now)
        result  <- issueTable.topReportRegions(since, 1)
      } yield result)

      regions must have size 1
    }
  }

  "corroboratedOpenStreets" should {
    "require reports from that many distinct accounts, not just that many reports" in {
      val (streets, oneReporterStreet) = runRolledBack(for {
        user   <- insertUser("a")
        other  <- insertUser("b")
        region <- insertRegion("Live region", deleted = false)
        agreed <- insertStreet(region, StreetEdgeStatus.Open)
        lonely <- insertStreet(region, StreetEdgeStatus.Open)
        _      <- report(agreed, user, OffsetDateTime.now)
        _      <- report(agreed, other, OffsetDateTime.now)
        // Three reports, one account: one bad session or a transient provider outage, which is exactly what
        // corroboration is meant to separate out.
        _      <- report(lonely, user, OffsetDateTime.now)
        _      <- report(lonely, user, OffsetDateTime.now.minusDays(1))
        _      <- report(lonely, user, OffsetDateTime.now.minusDays(2))
        result <- issueTable.corroboratedOpenStreets(since, minReporters, noLimit)
      } yield (result, lonely))

      streets.map(_.streetEdgeId) must not contain oneReporterStreet
      val corroborated = streets.find(_.regionName == "Live region")
      corroborated mustBe defined
      corroborated.get.reporterCount mustBe 2
      corroborated.get.reportCount mustBe 2
    }

    "leave out a street that is no longer open" in {
      val streets = runRolledBack(for {
        user    <- insertUser("a")
        other   <- insertUser("b")
        region  <- insertRegion("Live region", deleted = false)
        retired <- insertStreet(region, StreetEdgeStatus.NoImagery)
        _       <- report(retired, user, OffsetDateTime.now)
        _       <- report(retired, other, OffsetDateTime.now)
        result  <- issueTable.corroboratedOpenStreets(since, minReporters, noLimit)
      } yield result)

      // A street the checker already confirmed needs no further evidence; leaving it queued would re-spend the
      // reviewer's attention on a settled case.
      streets.map(_.regionName) must not contain "Live region"
    }

    "leave out a street in a deleted region" in {
      val streets = runRolledBack(for {
        user    <- insertUser("a")
        other   <- insertUser("b")
        deleted <- insertRegion("Retired neighborhood", deleted = true)
        street  <- insertStreet(deleted, StreetEdgeStatus.Open)
        _       <- report(street, user, OffsetDateTime.now)
        _       <- report(street, other, OffsetDateTime.now)
        result  <- issueTable.corroboratedOpenStreets(since, minReporters, noLimit)
      } yield result)

      streets.map(_.regionName) must not contain "Retired neighborhood"
    }

    "leave out reports older than the window" in {
      val streets = runRolledBack(for {
        user   <- insertUser("a")
        other  <- insertUser("b")
        region <- insertRegion("Live region", deleted = false)
        street <- insertStreet(region, StreetEdgeStatus.Open)
        _      <- report(street, user, OffsetDateTime.now.minusWeeks(30))
        _      <- report(street, other, OffsetDateTime.now.minusWeeks(30))
        result <- issueTable.corroboratedOpenStreets(since, minReporters, noLimit)
      } yield result)

      streets.map(_.regionName) must not contain "Live region"
    }

    "order by corroboration strength and honor the limit" in {
      val streets = runRolledBack(for {
        user   <- insertUser("a")
        other  <- insertUser("b")
        third  <- insertUser("c")
        region <- insertRegion("Live region", deleted = false)
        strong <- insertStreet(region, StreetEdgeStatus.Open)
        weak   <- insertStreet(region, StreetEdgeStatus.Open)
        _      <- report(strong, user, OffsetDateTime.now)
        _      <- report(strong, other, OffsetDateTime.now)
        _      <- report(strong, third, OffsetDateTime.now)
        _      <- report(weak, user, OffsetDateTime.now)
        _      <- report(weak, other, OffsetDateTime.now)
        result <- issueTable.corroboratedOpenStreets(since, minReporters, 1)
      } yield result)

      streets must have size 1
      streets.head.reporterCount mustBe 3
    }
  }
}
