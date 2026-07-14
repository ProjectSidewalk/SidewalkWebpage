package service

import models.user.{LeaderboardStat, SidewalkUserWithRole, UserStatTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import scala.concurrent.Await
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.DurationInt

/**
 * DB-backed invariant tests for every stat surface the redesigned dashboard/leaderboard/profile presents.
 *
 * The suite's philosophy is contract/shape over data values, so these assertions are written to hold against
 * *whatever* the connected DB contains (dev seed, CI seed, or a live dev DB): ordering, caps, ranges, and
 * cross-endpoint reconciliation — never specific numbers. Sections that need a real user pick one off the all-time
 * leaderboard and are vacuously green on an empty DB.
 *
 * Two deliberate scope choices:
 *   - `changeUsername` is covered only on its reject ladder (length/charset/profanity/uniqueness) — every reject
 *     happens before any write, so these are safe against a shared dev DB. The accept path needs a disposable user
 *     (Silhouette fixtures) and stays a documented gap.
 *   - Two sections write. The `on_leaderboard` opt-out test flips a real user's flag and restores it in a `finally`.
 *     The #4533 regression synthesizes a label-only mapper and runs the board query in one transaction that is always
 *     rolled back (`runRolledBack`). Both leave the shared dev DB exactly as found, even on assertion failure.
 */
class DashboardStatsInvariantSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val userService   = app.injector.instanceOf[UserService]
  private val userStatTable = app.injector.instanceOf[UserStatTable]
  private val messages      = play.api.test.Helpers.stubMessages()
  private val authService   = app.injector.instanceOf[AuthenticationService]
  // Stable DatabaseConfig val; call .db.run inline (binding .db to a val infers a path-dependent existential type).
  private val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private val ghostId = "00000000-0000-0000-0000-000000000000"

  private def await[T](f: => scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

  // Carries a successful result out through the forced-rollback failure path of `runRolledBack`.
  private case class RollbackWithResult(result: Any) extends RuntimeException with scala.util.control.NoStackTrace

  /**
   * Runs `action` inside a transaction that is ALWAYS rolled back, returning the action's result. Lets a test insert a
   * synthetic fixture, exercise the real query against it in the same transaction (so uncommitted rows are visible),
   * and leave the shared dev DB exactly as it was found — even if an assertion later fails.
   */
  private def runRolledBack[T](action: DBIO[T]): T = {
    val alwaysRollback = action.flatMap(r => DBIO.failed(RollbackWithResult(r))).transactionally
    Await.result(
      dbConfig.db.run(alwaysRollback).recover { case RollbackWithResult(r) => r.asInstanceOf[T] },
      60.seconds
    )
  }

  private val FixtureUserId   = "zz-fixture-4533"
  private val FixtureUsername = "zz_fixture_4533"

  /**
   * Inserts a mapper whose only period activity is a label placed *now* — their mission ended 30 days ago and their
   * audit task is not completed, so neither the mission-count nor the distance aggregate has a qualifying weekly row —
   * then runs the real leaderboard query in the same (rolled-back) transaction. Reference ids are looked up from the
   * connected DB so the fixture is city-agnostic.
   *
   * @param onLeaderboard Value for the user's `on_leaderboard` privacy flag.
   * @param timePeriod    "weekly" or "overall".
   * @return              The board, including the fixture user iff the query admits label-only mappers.
   */
  private def boardWithLabelOnlyUser(onLeaderboard: Boolean, timePeriod: String): Seq[LeaderboardStat] =
    runRolledBack(for {
      roleId      <- sql"SELECT role_id FROM role WHERE role = 'Registered'".as[Int].head
      missionType <- sql"SELECT mission_type_id FROM mission_type LIMIT 1".as[Int].head
      labelType   <- sql"SELECT label_type_id FROM label_type LIMIT 1".as[Int].head
      streetEdge  <- sql"SELECT street_edge_id FROM street_edge LIMIT 1".as[Int].head
      _           <- sqlu"""INSERT INTO sidewalk_user (user_id, username, email)
                  VALUES ($FixtureUserId, $FixtureUsername, 'zz_fixture_4533@example.com')"""
      _ <- sqlu"INSERT INTO user_role (user_id, role_id) VALUES ($FixtureUserId, $roleId)"
      _ <-
        sqlu"""INSERT INTO user_stat (user_id, meters_audited, high_quality, excluded, on_leaderboard, public_profile)
                  VALUES ($FixtureUserId, 0, TRUE, FALSE, $onLeaderboard, TRUE)"""
      missionId <- sql"""INSERT INTO mission
                             (mission_type_id, user_id, mission_start, mission_end, completed, pay, paid, skipped)
                         VALUES ($missionType, $FixtureUserId, now() - INTERVAL '30 days', now() - INTERVAL '30 days',
                                 TRUE, 0, FALSE, FALSE)
                         RETURNING mission_id""".as[Int].head
      auditTaskId <- sql"""INSERT INTO audit_task
                               (user_id, street_edge_id, task_start, task_end, completed, current_lat, current_lng)
                           VALUES ($FixtureUserId, $streetEdge, now(), now(), FALSE, 0, 0)
                           RETURNING audit_task_id""".as[Int].head
      _ <- sqlu"""INSERT INTO label
                      (audit_task_id, pano_id, label_type_id, deleted, temporary_label_id, time_created, mission_id,
                       tutorial, street_edge_id, agree_count, disagree_count, unsure_count, tags, user_id)
                  VALUES ($auditTaskId, 'fixture_pano', $labelType, FALSE, 1, now(), $missionId, FALSE, $streetEdge,
                          0, 0, 0, '{}', $FixtureUserId)"""
      board <- userStatTable.getLeaderboardStats(100000, timePeriod, byTeam = false, None, streetDistance = 1000000d)
    } yield board)

  // One user who is definitely eligible for the boards (rows here passed the role/excluded/on_leaderboard filters).
  private lazy val overallBoard                          = await(userService.getLeaderboardStats(10, "overall"))
  private lazy val topUser: Option[SidewalkUserWithRole] =
    overallBoard.headOption.flatMap(s => await(authService.findByUsername(s.username)))

  private def assertBoardInvariants(board: Seq[models.user.LeaderboardStat]): Unit = {
    board.length must be <= 10
    board.map(_.username).distinct.length mustBe board.length // no user listed twice
    board.map(_.score).sliding(2).foreach {
      case Seq(higher, lower) => higher must be >= lower // ranked by score, descending
      case _                  => ()
    }
    board.foreach { s =>
      s.labelCount must be >= 0
      s.missionCount must be >= 0
      s.distanceMeters must be >= 0.0
      s.accuracy.foreach { a => a must be >= 0.0; a must be <= 1.0 }
    }
  }

  "getLeaderboardStats" should {
    "return an all-time board of at most 10 unique users, score-ordered, with stats in range" in {
      assertBoardInvariants(overallBoard)
    }

    "return a weekly board with the same invariants (may legitimately be empty)" in {
      assertBoardInvariants(await(userService.getLeaderboardStats(10, "weekly")))
    }

    "return a team board with the same invariants" in {
      assertBoardInvariants(await(userService.getLeaderboardStats(10, "overall", byTeam = true)))
    }
  }

  // Regression for #4533: qualification is by labels placed in the period. A new mapper who has labels but hasn't
  // finished a mission or a street was dropped by the query's INNER JOINs onto mission/distance; they must now appear
  // (mission/distance default to 0), matching getUserStanding's label-based eligibility.
  "getLeaderboardStats (labels alone qualify, #4533)" should {
    "list a mapper who placed a label this week but has no completed mission or street, with mission/distance = 0" in {
      val row = boardWithLabelOnlyUser(onLeaderboard = true, "weekly").find(_.username == FixtureUsername)
      row mustBe defined
      row.get.labelCount mustBe 1
      row.get.missionCount mustBe 0 // mission ended 30 days ago -> no qualifying weekly row -> COALESCE 0, not dropped
      row.get.distanceMeters mustBe 0.0 // audit task not completed -> no distance row -> COALESCE 0, not dropped
    }

    "also list that same label-only mapper on the overall board" in {
      boardWithLabelOnlyUser(onLeaderboard = true, "overall").map(_.username) must contain(FixtureUsername)
    }

    "keep honoring the on_leaderboard opt-out for a label-only mapper" in {
      boardWithLabelOnlyUser(onLeaderboard = false, "weekly").map(_.username) must not contain FixtureUsername
    }
  }

  "getUserProfileData (hero KPIs)" should {
    "return non-negative KPIs with accuracy in [0, 1] for a real leaderboard user" in {
      topUser.foreach { u =>
        val pd = await(userService.getUserProfileData(u.userId, metricSystem = true))
        pd.missionCount must be >= 0
        pd.labelCount must be >= 0
        pd.validationCount must be >= 0
        pd.auditedDistance must be >= 0.0
        pd.accuracy.foreach { a => a must be >= 0.0; a must be <= 1.0 }
      }
    }

    "report the same distance in km and miles (metric = imperial * 1.609344)" in {
      topUser.foreach { u =>
        val metric   = await(userService.getUserProfileData(u.userId, metricSystem = true))
        val imperial = await(userService.getUserProfileData(u.userId, metricSystem = false))
        if (imperial.auditedDistance > 0) {
          val ratio = metric.auditedDistance / imperial.auditedDistance
          ratio mustBe 1.609344 +- 0.001
        }
      }
    }
  }

  "getUserStanding" should {
    "return a rank within the cohort and a slice that includes the user, when the user has standing" in {
      topUser.foreach { u =>
        await(userService.getUserStanding(u.userId)).foreach { st =>
          st.rank must be >= 1
          st.rank must be <= st.cohortSize
          st.labelCount must be >= 0
          st.slice.map(_.rank) must contain(st.rank)
        }
      }
    }
  }

  "getTrophies" should {
    "respect the per-category caps and only mint fully-formed trophies" in {
      topUser.foreach { u =>
        val trophies = await(userService.getTrophies(u.userId, "Testville", messages))
        trophies.length must be <= 17 // pioneers/champions/weekly capped at 5/6/6 in UserService.getTrophies
        trophies.foreach { t =>
          t.title must not be empty
          t.medal must not be empty
        }
      }
    }
  }

  "getPublicProfile" should {
    "mirror the target's public_profile flag for a non-owner viewer, and never hide the profile from its owner" in {
      topUser.foreach { u =>
        val flagIsPublic = await(userService.getPrivacySettings(u.userId)).exists(_._2)

        val asStranger =
          await(userService.getPublicProfile(u.username, isOwner = false, isMetric = true, "Testville", messages))
        asStranger mustBe defined
        asStranger.get.visible mustBe flagIsPublic
        asStranger.get.profile.isDefined mustBe flagIsPublic // stats populated ONLY when visible: nothing leaks
        if (!flagIsPublic) asStranger.get.trophies mustBe empty

        val asOwner =
          await(userService.getPublicProfile(u.username, isOwner = true, isMetric = true, "Testville", messages))
        asOwner.map(_.visible) mustBe Some(true)
      }
    }
  }

  // The reject ladder returns i18n keys (the controller localizes them), so assert on the keys.
  "changeUsername" should {
    "reject a name that is too short" in {
      await(userService.changeUsername(ghostId, "ab")).left.toOption.get must
        be("dashboard.settings.username.error.length")
    }

    "reject a name with characters outside letters, numbers, hyphens, underscores" in {
      await(userService.changeUsername(ghostId, "bad name!")).left.toOption.get must
        be("dashboard.settings.username.error.charset")
    }

    "reject a profane name" in {
      await(userService.changeUsername(ghostId, "shithead99")).left.toOption.get must
        be("dashboard.settings.username.error.allowed")
    }

    "reject a name another user already holds" in {
      // Legacy usernames may contain characters the charset rule now forbids (that reject fires first), so pick a
      // board user whose name would pass it.
      overallBoard.map(_.username).find(_.matches("^[A-Za-z0-9_-]+$")).foreach { takenName =>
        await(userService.changeUsername(ghostId, takenName)).left.toOption.get must
          be("dashboard.settings.username.error.taken")
      }
    }
  }

  "the on_leaderboard opt-out" should {
    "hide the user by name from the individual boards, and persist through getPrivacySettings" in {
      for {
        u                         <- topUser
        (origOnBoard, origPublic) <- await(userService.getPrivacySettings(u.userId))
      } {
        try {
          await(userService.updatePrivacySettings(u.userId, onLeaderboard = false, publicProfile = origPublic))
          await(userService.getPrivacySettings(u.userId)) mustBe Some((false, origPublic))
          await(userService.getLeaderboardStats(10, "overall")).map(_.username) must not contain u.username
        } finally {
          val _ = await(userService.updatePrivacySettings(u.userId, origOnBoard, origPublic))
        }
        await(userService.getPrivacySettings(u.userId)) mustBe Some((origOnBoard, origPublic))
      }
    }
  }
}
