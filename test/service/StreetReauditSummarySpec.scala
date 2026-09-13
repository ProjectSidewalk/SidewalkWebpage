package service

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, StreetFixtures}

import java.time.{LocalDate, OffsetDateTime}

/**
 * DB-backed tests for the street re-audit summary behind the map's hover card (#5258).
 *
 * The summary exists to answer "is it worth going back to this street", so the contract that matters is the gate: it
 * describes a street exactly when the map draws that street as needing a re-audit, and says nothing about any other.
 * Getting that wrong in either direction is a visible bug — a card on a street that was already refreshed, or no card
 * on one that wasn't.
 *
 * Every case seeds its own streets, audits and labels inside a rolled-back transaction. Hunting for pre-existing rows
 * would not work here: nothing in a fresh dev dump is flagged as needing a re-audit, and CI's schema holds a single
 * street and no audits at all (see [[util.StreetFixtures]]).
 */
class StreetReauditSummarySpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb with StreetFixtures {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val streetService = app.injector.instanceOf[StreetService]

  /** Records the imagery capture date the nightly poll would have written for a street. */
  private def setImagery(streetEdgeId: Int, medianNewestCapture: LocalDate): DBIO[Int] =
    sqlu"""INSERT INTO street_imagery
               (street_edge_id, oldest_capture, newest_capture, median_newest_capture, n_panos, data_source,
                updated_at)
           VALUES ($streetEdgeId, $medianNewestCapture, $medianNewestCapture, $medianNewestCapture, 1,
                   'imagery_poll', now())
           ON CONFLICT (street_edge_id) DO UPDATE SET median_newest_capture = EXCLUDED.median_newest_capture"""

  /**
   * Places `n` labels of one type on a street, through the audit_task/pano_data/mission chain a real label needs.
   *
   * The label's own `street_edge_id` is what the breakdown groups on, so it is set explicitly rather than left to be
   * inferred from the audit task.
   */
  private def labelStreet(streetEdgeId: Int, userId: String, auditTaskId: Int, labelType: String, n: Int): DBIO[Unit] =
    for {
      missionId <- sql"""INSERT INTO mission
                             (mission_type, user_id, mission_start, mission_end, completed, pay, paid, skipped)
                         VALUES ('audit', $userId, now(), now(), TRUE, 0, FALSE, FALSE)
                         RETURNING mission_id""".as[Int].head
      // label.pano_id references pano_data (#4587), so the label's pano has to exist before the label does.
      _ <- sqlu"""INSERT INTO pano_data (pano_id, capture_date, source)
                  VALUES ($labelType || '_pano_' || $streetEdgeId, '2020-01', 'gsv')
                  ON CONFLICT (pano_id) DO NOTHING"""
      _ <- DBIO.sequence((1 to n).map { i =>
        sqlu"""INSERT INTO label
                   (audit_task_id, pano_id, label_type, deleted, temporary_label_id, time_created, mission_id,
                    tutorial, street_edge_id, agree_count, disagree_count, unsure_count, tags, user_id)
               VALUES ($auditTaskId, $labelType || '_pano_' || $streetEdgeId, CAST($labelType AS label_type), FALSE,
                       $i, now(), $missionId, FALSE, $streetEdgeId, 0, 0, 0, '{}', $userId)"""
      })
    } yield ()

  /** A mapper the seeded queries will actually count: not excluded, marked high quality. */
  private def insertCountedUser(): DBIO[String] = for {
    userId <- insertUser()
    _      <- sqlu"INSERT INTO user_role (user_id, role) VALUES ($userId, 'Registered')"
    _      <- sqlu"""INSERT INTO user_stat (user_id, meters_audited, high_quality, excluded, on_leaderboard,
                                            public_profile)
                     VALUES ($userId, 0, TRUE, FALSE, TRUE, TRUE)"""
  } yield userId

  "getReauditSummaryDBIO" should {
    "describe a street whose only audit predates its imagery" in {
      val capture = LocalDate.of(2025, 8, 1)
      val audited = OffsetDateTime.parse("2024-04-19T14:33:13Z")

      val summary = runRolledBack(for {
        userId   <- insertCountedUser()
        streetId <- insertStreet()
        _        <- audit(streetId, userId, taskEnd = audited, outdated = true)
        _        <- setImagery(streetId, capture)
        result   <- streetService.getReauditSummaryDBIO(streetId)
      } yield result)

      summary mustBe defined
      summary.get.newImageryDate mustBe Some(capture)
      // Compared to the second: Postgres round-trips timestamptz at microsecond resolution.
      summary.get.lastAuditedAt.toInstant.getEpochSecond mustBe audited.toInstant.getEpochSecond
    }

    "say nothing about a street nobody has ever audited" in {
      val summary = runRolledBack(for {
        streetId <- insertStreet()
        result   <- streetService.getReauditSummaryDBIO(streetId)
      } yield result)

      summary mustBe None
    }

    "say nothing about a street whose audit is still current" in {
      val summary = runRolledBack(for {
        userId   <- insertCountedUser()
        streetId <- insertStreet()
        _        <- audit(streetId, userId, outdated = false)
        result   <- streetService.getReauditSummaryDBIO(streetId)
      } yield result)

      summary mustBe None
    }

    "stop describing a street as soon as anyone re-audits it, whoever made the stale audit" in {
      val summary = runRolledBack(for {
        firstMapper  <- insertCountedUser()
        secondMapper <- insertCountedUser()
        streetId     <- insertStreet()
        _            <- audit(streetId, firstMapper, outdated = true)
        _            <- audit(streetId, secondMapper, outdated = false)
        result       <- streetService.getReauditSummaryDBIO(streetId)
      } yield result)

      summary mustBe None
    }

    "report the most recent audit when the street was mapped more than once" in {
      val older = OffsetDateTime.parse("2022-01-05T10:00:00Z")
      val newer = OffsetDateTime.parse("2024-06-30T10:00:00Z")

      val summary = runRolledBack(for {
        userId   <- insertCountedUser()
        streetId <- insertStreet()
        _        <- audit(streetId, userId, taskEnd = older, outdated = true)
        _        <- audit(streetId, userId, taskEnd = newer, outdated = true)
        result   <- streetService.getReauditSummaryDBIO(streetId)
      } yield result)

      summary.get.lastAuditedAt.toInstant.getEpochSecond mustBe newer.toInstant.getEpochSecond
    }

    "still describe a street whose imagery poll came back empty, without a capture date" in {
      val summary = runRolledBack(for {
        userId   <- insertCountedUser()
        streetId <- insertStreet()
        _        <- audit(streetId, userId, outdated = true)
        result   <- streetService.getReauditSummaryDBIO(streetId)
      } yield result)

      summary mustBe defined
      summary.get.newImageryDate mustBe None
    }
  }

  "the label breakdown" should {
    "count each type on the street, most frequent first" in {
      val summary = runRolledBack(for {
        userId      <- insertCountedUser()
        streetId    <- insertStreet()
        auditTaskId <- audit(streetId, userId, outdated = true)
        _           <- labelStreet(streetId, userId, auditTaskId, "CurbRamp", 2)
        _           <- labelStreet(streetId, userId, auditTaskId, "NoSidewalk", 5)
        result      <- streetService.getReauditSummaryDBIO(streetId)
      } yield result)

      summary.get.labelCounts mustBe Seq(("NoSidewalk", 5), ("CurbRamp", 2))
    }

    "count only the street's own labels, not its neighbor's" in {
      val summary = runRolledBack(for {
        userId       <- insertCountedUser()
        streetId     <- insertStreet()
        neighborId   <- insertStreet()
        auditTaskId  <- audit(streetId, userId, outdated = true)
        neighborTask <- audit(neighborId, userId, outdated = true)
        _            <- labelStreet(streetId, userId, auditTaskId, "CurbRamp", 2)
        _            <- labelStreet(neighborId, userId, neighborTask, "Obstacle", 7)
        result       <- streetService.getReauditSummaryDBIO(streetId)
      } yield result)

      summary.get.labelCounts mustBe Seq(("CurbRamp", 2))
    }

    "leave out labels the mapper deleted, matching what the map and Gallery show" in {
      val summary = runRolledBack(for {
        userId      <- insertCountedUser()
        streetId    <- insertStreet()
        auditTaskId <- audit(streetId, userId, outdated = true)
        _           <- labelStreet(streetId, userId, auditTaskId, "CurbRamp", 3)
        _           <- sqlu"""UPDATE label SET deleted = TRUE
                              WHERE street_edge_id = $streetId AND temporary_label_id = 1"""
        result <- streetService.getReauditSummaryDBIO(streetId)
      } yield result)

      summary.get.labelCounts mustBe Seq(("CurbRamp", 2))
    }

    "be empty rather than absent for a street whose labels were all removed" in {
      val summary = runRolledBack(for {
        userId      <- insertCountedUser()
        streetId    <- insertStreet()
        auditTaskId <- audit(streetId, userId, outdated = true)
        _           <- labelStreet(streetId, userId, auditTaskId, "CurbRamp", 1)
        _           <- sqlu"UPDATE label SET deleted = TRUE WHERE street_edge_id = $streetId"
        result      <- streetService.getReauditSummaryDBIO(streetId)
      } yield result)

      summary mustBe defined
      summary.get.labelCounts mustBe empty
    }
  }
}
