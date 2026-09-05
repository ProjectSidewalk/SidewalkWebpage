package models.audit

import models.street.{StreetImagery, StreetImagerySource, StreetImageryTableDef}
import models.utils.ConfigTableDef
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, StreetFixtures}

import java.time.{LocalDate, OffsetDateTime}

/**
 * DB-backed tests pinning the dashboard's per-user re-audit list (#4896): the streets a mapper audited that still
 * need a re-audit because no completed audit of them -- theirs or anyone else's -- was made against the current
 * imagery (#4384). The "anyone else's" half is the load-bearing part: once another mapper refreshes the street it
 * leaves every list, so two people are never sent to the same re-audit.
 *
 * Every case builds its own world with [[StreetFixtures]] inside a deliberately rolled-back transaction
 * (runRolledBack): its own users, its own region, its own streets. Nothing is read that the case did not write, so
 * each assertion can be exact ("these three streets, in this order") rather than a bound that pre-existing rows
 * might satisfy on their own, and the suite is equally meaningful against a full dev dump and against CI's
 * near-empty schema. Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in
 * dev/CI). Scheduling actors are disabled so nightly jobs can't race the tests.
 */
class OutdatedStreetsForUserSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb with StreetFixtures {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val auditTaskTable = app.injector.instanceOf[AuditTaskTable]

  private val streetImagery = TableQuery[StreetImageryTableDef]
  private val configTable   = TableQuery[ConfigTableDef]

  private val ListLimit = 12

  private def setImagery(streetEdgeId: Int, median: Option[LocalDate]): DBIO[Int] =
    streetImagery.insertOrUpdate(
      StreetImagery(streetEdgeId, None, median, median, 1, StreetImagerySource.ImageryPoll, OffsetDateTime.now)
    )

  "getOutdatedStreetsForUser" should {
    "list a street only once the user's audit of it is flagged" in {
      val (fresh, stale) = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        auditTaskId  <- audit(streetEdgeId, userId)
        fresh        <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
        _            <- setOutdatedFlag(auditTaskId, outdated = true)
        stale        <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
      } yield (fresh, stale))

      fresh mustBe empty
      stale.size mustBe 1
      stale.head.regionName mustBe "Spec Region"
      stale.head.distanceMeters mustBe OneDegreeEquatorMeters +- 1.0
      stale.head.lastAuditedAt mustBe defined
    }

    "drop a street once any other mapper audits it against the current imagery" in {
      val (mine, afterTheirs) = runRolledBack(for {
        userId       <- insertUser()
        otherUserId  <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        _            <- audit(streetEdgeId, userId, outdated = true)
        before       <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
        // Another mapper redoes the street on the new imagery; the sync leaves their audit unflagged.
        _     <- audit(streetEdgeId, otherUserId)
        after <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
      } yield (before, after))

      mine.size mustBe 1
      afterTheirs mustBe empty
    }

    "keep a street that another mapper has only started re-auditing" in {
      // The rescue is a *completed* audit. A walk in progress leaves the street exactly as much in need of one.
      val rows = runRolledBack(for {
        userId       <- insertUser()
        otherUserId  <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        _            <- audit(streetEdgeId, userId, outdated = true)
        _            <- audit(streetEdgeId, otherUserId, completed = false)
        rows         <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
      } yield rows.map(_.streetEdgeId))

      rows.size mustBe 1
    }

    "ignore a street the user started but never finished" in {
      val rows = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        _            <- audit(streetEdgeId, userId, outdated = true, completed = false)
        rows         <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
      } yield rows)

      rows mustBe empty
    }

    "list only the requesting mapper's own streets" in {
      val (mine, theirs, myStreet, theirStreet) = runRolledBack(for {
        userId      <- insertUser()
        otherUserId <- insertUser()
        regionId    <- insertRegion()
        myStreet    <- insertStreet(Some(regionId))
        theirStreet <- insertStreet(Some(regionId))
        _           <- audit(myStreet, userId, outdated = true)
        _           <- audit(theirStreet, otherUserId, outdated = true)
        mine        <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
        theirs      <- auditTaskTable.getOutdatedStreetsForUser(otherUserId, ListLimit)
      } yield (mine.map(_.streetEdgeId), theirs.map(_.streetEdgeId), myStreet, theirStreet))

      mine mustBe Seq(myStreet)
      theirs mustBe Seq(theirStreet)
    }

    "show a street once, dated by the user's most recent audit of it" in {
      val (rows, latest) = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        latest = now.minusDays(2)
        _ <- audit(streetEdgeId, userId, taskEnd = now.minusYears(3), outdated = true)
        _ <- audit(streetEdgeId, userId, taskEnd = latest, outdated = true)
        // Seeded out of order, so a query reading the first or last row rather than the max would show it here.
        _    <- audit(streetEdgeId, userId, taskEnd = now.minusYears(1), outdated = true)
        rows <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
      } yield (rows, latest))

      rows.size mustBe 1
      rows.head.lastAuditedAt.map(_.toInstant) mustBe Some(latest.toInstant)
    }

    "lead with the street the user finished auditing longest ago" in {
      val (rows, oldestFirst) = runRolledBack(for {
        userId    <- insertUser()
        regionId  <- insertRegion()
        streetIds <- insertStreets(regionId, 3)
        // Seeded youngest-first, so insertion order and audit order disagree.
        _ <- DBIO.sequence(streetIds.zipWithIndex.map { case (streetEdgeId, i) =>
          audit(streetEdgeId, userId, taskEnd = now.minusYears(1L + i), outdated = true)
        })
        rows <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
      } yield (rows, streetIds.reverse))

      rows.map(_.streetEdgeId) mustBe oldestFirst
      val auditedAt = rows.flatMap(_.lastAuditedAt).map(_.toInstant)
      auditedAt mustBe auditedAt.sorted
    }

    "break ties on street id, so paging can't show or skip a row twice" in {
      // A mapper who audited a whole neighborhood in one sitting has many streets carrying the same timestamp;
      // without a second sort key their order is Postgres's choice, and "show more" would page a shifting list.
      val (firstPage, wholeList, streetIds) = runRolledBack(for {
        userId    <- insertUser()
        regionId  <- insertRegion()
        streetIds <- insertStreets(regionId, 4)
        sameMoment = now.minusMonths(6)
        _         <- DBIO.sequence(streetIds.map(id => audit(id, userId, taskEnd = sameMoment, outdated = true)))
        firstPage <- auditTaskTable.getOutdatedStreetsForUser(userId, 2)
        wholeList <- auditTaskTable.getOutdatedStreetsForUser(userId, 4)
      } yield (firstPage.map(_.streetEdgeId), wholeList.map(_.streetEdgeId), streetIds))

      wholeList mustBe streetIds
      firstPage mustBe streetIds.take(2)
    }

    "report the capture date that flagged the street, and still list it when there is none" in {
      val captured = LocalDate.of(2025, 8, 1)

      val (withDate, withoutDate) = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        _            <- audit(streetEdgeId, userId, outdated = true)
        _            <- setImagery(streetEdgeId, Some(captured))
        dated        <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
        // An empty poll clears the median while the flags it created stand until the next sync.
        _       <- setImagery(streetEdgeId, None)
        undated <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
      } yield (dated.map(_.newImageryDate), undated.map(_.newImageryDate)))

      withDate mustBe Seq(Some(captured))
      withoutDate mustBe Seq(None)
    }

    "skip streets that are no longer auditable" in {
      // The list is a to-do list, so it may only hold streets Explore would actually hand back: open ones, in a live
      // region, that aren't the tutorial. Each street below is flagged and audited by the user, so the only thing
      // keeping it off the list is the exclusion under test.
      val (rows, openStreet) = runRolledBack(for {
        userId          <- insertUser()
        regionId        <- insertRegion()
        deletedRegionId <- insertRegion(deleted = true)
        openStreet      <- insertStreet(Some(regionId))
        closedStreet    <- insertStreet(Some(regionId), status = "closed")
        noImageryStreet <- insertStreet(Some(regionId), status = "no_imagery")
        hiddenStreet    <- insertStreet(Some(deletedRegionId))
        tutorialStreet  <- configTable.map(_.tutorialStreetEdgeID).result.head
        // Made auditable and put in the live region, so its absence below is the tutorial rule and nothing else.
        _ <- sqlu"""UPDATE street_edge SET status = 'open' WHERE street_edge_id = $tutorialStreet"""
        _ <- putInRegion(tutorialStreet, regionId)
        _ <- DBIO.sequence(
          Seq(openStreet, closedStreet, noImageryStreet, hiddenStreet, tutorialStreet)
            .map(id => audit(id, userId, outdated = true))
        )
        rows <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
      } yield (rows.map(_.streetEdgeId), openStreet))

      rows mustBe Seq(openStreet)
    }
  }

  "countOutdatedStreetsForUser" should {
    "count every needs-re-audit street, including the ones past the list's limit" in {
      val (rows, total) = runRolledBack(for {
        userId    <- insertUser()
        regionId  <- insertRegion()
        streetIds <- insertStreets(regionId, 3)
        _         <- DBIO.sequence(streetIds.map(id => audit(id, userId, outdated = true)))
        rows      <- auditTaskTable.getOutdatedStreetsForUser(userId, 2)
        total     <- auditTaskTable.countOutdatedStreetsForUser(userId)
      } yield (rows.size, total))

      rows mustBe 2
      total mustBe 3
    }

    "agree with the list itself, so the heading can't over- or under-claim" in {
      val (rows, total) = runRolledBack(for {
        userId      <- insertUser()
        otherUserId <- insertUser()
        regionId    <- insertRegion()
        streetIds   <- insertStreets(regionId, 3)
        _           <- DBIO.sequence(streetIds.map(id => audit(id, userId, outdated = true)))
        // Neither a street someone else refreshed nor a street that is only someone else's may reach the count.
        refreshed <- insertStreet(Some(regionId))
        _         <- audit(refreshed, userId, outdated = true)
        _         <- audit(refreshed, otherUserId)
        theirs    <- insertStreet(Some(regionId))
        _         <- audit(theirs, otherUserId, outdated = true)
        rows      <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
        total     <- auditTaskTable.countOutdatedStreetsForUser(userId)
      } yield (rows.size, total))

      total mustBe rows
      total mustBe 3
    }

    "count nothing for a mapper who has never completed an audit" in {
      val (rows, total) = runRolledBack(for {
        userId <- insertUser()
        rows   <- auditTaskTable.getOutdatedStreetsForUser(userId, ListLimit)
        total  <- auditTaskTable.countOutdatedStreetsForUser(userId)
      } yield (rows, total))

      rows mustBe empty
      total mustBe 0
    }
  }

  "getAuditedStreets" should {
    "mark a user's street as needing a re-audit without dropping it from their map" in {
      val (fresh, stale) = runRolledBack(
        for {
          userId       <- insertUser()
          regionId     <- insertRegion()
          streetEdgeId <- insertStreet(Some(regionId))
          auditTaskId  <- audit(streetEdgeId, userId)
          fresh        <- auditTaskTable.getAuditedStreets(userId)
          _            <- setOutdatedFlag(auditTaskId, outdated = true)
          stale        <- auditTaskTable.getAuditedStreets(userId)
        } yield (
          fresh.map { case (street, outdated) => (street.streetEdgeId, outdated) },
          stale.map { case (street, outdated) => (street.streetEdgeId, outdated) }
        )
      )

      fresh.map(_._2) mustBe Seq(false)
      // Still the user's street -- their work is credited either way; only the freshness flag flips.
      stale.map(_._2) mustBe Seq(true)
      stale.map(_._1) mustBe fresh.map(_._1)
    }

    "clear the flag once another mapper refreshes the street, matching the list" in {
      val flags = runRolledBack(for {
        userId       <- insertUser()
        otherUserId  <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        _            <- audit(streetEdgeId, userId, outdated = true)
        _            <- audit(streetEdgeId, otherUserId)
        pairs        <- auditTaskTable.getAuditedStreets(userId)
      } yield pairs.map(_._2))

      flags mustBe Seq(false)
    }

    "return a street once however many times the user audited it" in {
      val streetIds = runRolledBack(for {
        userId       <- insertUser()
        regionId     <- insertRegion()
        streetEdgeId <- insertStreet(Some(regionId))
        _            <- audit(streetEdgeId, userId, taskEnd = now.minusYears(2), outdated = true)
        _            <- audit(streetEdgeId, userId, outdated = true)
        pairs        <- auditTaskTable.getAuditedStreets(userId)
      } yield pairs.map(_._1.streetEdgeId))

      streetIds.size mustBe 1
    }
  }
}
