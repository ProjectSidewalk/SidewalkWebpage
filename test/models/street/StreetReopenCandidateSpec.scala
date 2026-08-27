package models.street

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

import java.time.LocalDate

/**
 * DB-backed tests for the regained-imagery review queue's DAO (#4929, evolution 365).
 *
 * What matters here is the guard discipline: a candidate can only be minted for a street that is still no_imagery
 * (so a race with a reopen can't resurrect a queue entry), evidence refreshes keep the original detection time, and
 * the review read applies the status filter again so a stale row can never offer the admin a Reopen button for an
 * already-open street. Dismissal gets the most attention, because it is the only judgement the poll has to keep
 * honouring: the row survives it, its evidence freezes at what the admin rejected, and only strictly better evidence
 * puts the street back in front of them.
 *
 * All cases run inside rolled-back transactions, leaving the connected DB untouched; requires Postgres+PostGIS like
 * the other DB-backed specs. Actors are disabled.
 */
class StreetReopenCandidateSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val candidateTable = app.injector.instanceOf[StreetReopenCandidateTable]

  private val capture = LocalDate.parse("2025-06-01")

  /** A street that belongs to a non-deleted region, so it can appear in candidatesForReview's region join. */
  private def streetInRegion: DBIO[Int] = {
    sql"""SELECT street_edge_region.street_edge_id
          FROM street_edge_region
          JOIN region ON street_edge_region.region_id = region.region_id
          WHERE region.deleted = FALSE
          ORDER BY street_edge_region.street_edge_id
          LIMIT 1""".as[Int].head
  }

  private def setStatus(streetEdgeId: Int, status: String): DBIO[Int] =
    sqlu"UPDATE street_edge SET status = ${status}::street_edge_status WHERE street_edge_id = $streetEdgeId"

  "upsertFromPoll" should {
    "refuse to mint a candidate for a street that is not no_imagery" in {
      val (written, row) = runRolledBack(for {
        streetId <- streetInRegion
        _        <- setStatus(streetId, "open")
        written  <- candidateTable.upsertFromPoll(streetId, 2, Some(capture))
        row      <- candidateTable.reopenCandidates.filter(_.streetEdgeId === streetId).result.headOption
      } yield (written, row))

      written mustBe 0
      row mustBe None
    }

    "record a candidate for a no_imagery street, refreshing evidence but keeping first_detected_at on re-detection" in {
      val (first, second) = runRolledBack(for {
        streetId <- streetInRegion
        _        <- setStatus(streetId, "no_imagery")
        _        <- candidateTable.upsertFromPoll(streetId, 1, None)
        first    <- candidateTable.reopenCandidates.filter(_.streetEdgeId === streetId).result.head
        _        <- candidateTable.upsertFromPoll(streetId, 3, Some(capture))
        second   <- candidateTable.reopenCandidates.filter(_.streetEdgeId === streetId).result.head
      } yield (first, second))

      first.nPanos mustBe 1
      first.newestCapture mustBe None
      second.nPanos mustBe 3
      second.newestCapture mustBe Some(capture)
      second.firstDetectedAt mustBe first.firstDetectedAt
      second.lastDetectedAt.isBefore(first.lastDetectedAt) mustBe false
    }

    "refuse zero-pano evidence (a conclusive empty poll deletes instead)" in {
      an[Exception] must be thrownBy runRolledBack(for {
        streetId <- streetInRegion
        _        <- setStatus(streetId, "no_imagery")
        written  <- candidateTable.upsertFromPoll(streetId, 0, None)
      } yield written)
    }
  }

  "delete" should {
    "remove the street's candidate row and report how many it removed" in {
      val (deleted, deletedAgain) = runRolledBack(for {
        streetId     <- streetInRegion
        _            <- setStatus(streetId, "no_imagery")
        _            <- candidateTable.upsertFromPoll(streetId, 2, Some(capture))
        deleted      <- candidateTable.delete(streetId)
        deletedAgain <- candidateTable.delete(streetId)
      } yield (deleted, deletedAgain))

      deleted mustBe 1
      deletedAgain mustBe 0
    }
  }

  "dismiss" should {
    "keep the row, take it out of the queue, and stay idempotent" in {
      val (dismissed, again, row, queued) = runRolledBack(for {
        streetId  <- streetInRegion
        _         <- setStatus(streetId, "no_imagery")
        _         <- candidateTable.upsertFromPoll(streetId, 2, Some(capture))
        dismissed <- candidateTable.dismiss(streetId)
        again     <- candidateTable.dismiss(streetId)
        row       <- candidateTable.reopenCandidates.filter(_.streetEdgeId === streetId).result.head
        queued    <- candidateTable.candidatesForReview(1000000)
      } yield (dismissed, again, row, queued.find(_.streetEdgeId == streetId)))

      dismissed mustBe 1
      again mustBe 0
      // The row is the record of the judgement, so it has to survive it -- that is what upsertFromPoll compares
      // later evidence against.
      row.dismissedAt mustBe defined
      queued mustBe None
    }

    "hold a dismissed street out of the queue until a poll beats the evidence that was dismissed" in {
      val (afterWeaker, afterMorePanos, afterNewerCapture) = runRolledBack(
        for {
          streetId <- streetInRegion
          _        <- setStatus(streetId, "no_imagery")
          _        <- candidateTable.upsertFromPoll(streetId, 2, Some(capture))
          _        <- candidateTable.dismiss(streetId)
          // Same evidence again, and fewer panos: neither is a reason to ask the admin a second time.
          _           <- candidateTable.upsertFromPoll(streetId, 2, Some(capture))
          _           <- candidateTable.upsertFromPoll(streetId, 1, None)
          afterWeaker <- candidateTable.candidatesForReview(1000000)
          // More panos than the admin rejected: worth another look.
          _              <- candidateTable.upsertFromPoll(streetId, 3, Some(capture))
          afterMorePanos <- candidateTable.candidatesForReview(1000000)
          _              <- candidateTable.dismiss(streetId)
          // So is imagery captured more recently than what was rejected, even with no more panos than before.
          _                 <- candidateTable.upsertFromPoll(streetId, 3, Some(capture.plusMonths(6)))
          afterNewerCapture <- candidateTable.candidatesForReview(1000000)
        } yield (
          afterWeaker.find(_.streetEdgeId == streetId),
          afterMorePanos.find(_.streetEdgeId == streetId),
          afterNewerCapture.find(_.streetEdgeId == streetId)
        )
      )

      afterWeaker mustBe None
      afterMorePanos.map(_.nPanos) mustBe Some(3)
      afterNewerCapture.map(_.newestCapture) mustBe Some(Some(capture.plusMonths(6)))
    }

    "leave the dismissed evidence frozen, so the bar for re-surfacing can't creep upward poll by poll" in {
      val row = runRolledBack(for {
        streetId <- streetInRegion
        _        <- setStatus(streetId, "no_imagery")
        _        <- candidateTable.upsertFromPoll(streetId, 2, Some(capture))
        _        <- candidateTable.dismiss(streetId)
        _        <- candidateTable.upsertFromPoll(streetId, 1, None)
        row      <- candidateTable.reopenCandidates.filter(_.streetEdgeId === streetId).result.head
      } yield row)

      row.nPanos mustBe 2
      row.newestCapture mustBe Some(capture)
    }
  }

  "deleteForNonRetiredStreets" should {
    "drop evidence about a street whose status has moved on, and keep a retired street's" in {
      val (retiredSurvived, movedOnDropped) = runRolledBack(for {
        retired <- streetInRegion
        movedOn <- sql"""SELECT street_edge_region.street_edge_id
                         FROM street_edge_region
                         JOIN region ON street_edge_region.region_id = region.region_id
                         WHERE region.deleted = FALSE AND street_edge_region.street_edge_id <> $retired
                         ORDER BY street_edge_region.street_edge_id
                         LIMIT 1""".as[Int].head
        _          <- setStatus(retired, "no_imagery")
        _          <- setStatus(movedOn, "no_imagery")
        _          <- candidateTable.upsertFromPoll(retired, 2, Some(capture))
        _          <- candidateTable.upsertFromPoll(movedOn, 2, Some(capture))
        _          <- setStatus(movedOn, "closed")
        _          <- candidateTable.deleteForNonRetiredStreets
        retiredRow <- candidateTable.reopenCandidates.filter(_.streetEdgeId === retired).result.headOption
        movedOnRow <- candidateTable.reopenCandidates.filter(_.streetEdgeId === movedOn).result.headOption
      } yield (retiredRow.isDefined, movedOnRow.isEmpty))

      retiredSurvived mustBe true
      movedOnDropped mustBe true
    }
  }

  "candidatesForReview" should {
    "list a no_imagery street's candidate with its region, and drop it once the street is no longer no_imagery" in {
      val (queued, afterReopen) = runRolledBack(for {
        streetId <- streetInRegion
        _        <- setStatus(streetId, "no_imagery")
        _        <- candidateTable.upsertFromPoll(streetId, 2, Some(capture))
        queued   <- candidateTable.candidatesForReview(1000000)
        // The second belt: a candidate row surviving a status change must not reach the admin.
        _           <- setStatus(streetId, "open")
        afterReopen <- candidateTable.candidatesForReview(1000000)
      } yield (queued.find(_.streetEdgeId == streetId), afterReopen.find(_.streetEdgeId == streetId)))

      queued mustBe defined
      queued.get.nPanos mustBe 2
      queued.get.newestCapture mustBe Some(capture)
      queued.get.regionName must not be empty
      afterReopen mustBe None
    }
  }
}
