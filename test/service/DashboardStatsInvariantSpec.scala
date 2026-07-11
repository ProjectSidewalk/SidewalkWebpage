package service

import models.user.SidewalkUserWithRole
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder

import scala.concurrent.Await
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
 *   - The `on_leaderboard` opt-out test is the one write in the file: it flips a real user's flag and restores it in
 *     a `finally`, so even an assertion failure leaves the DB as it was found.
 */
class DashboardStatsInvariantSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val userService = app.injector.instanceOf[UserService]
  private val authService = app.injector.instanceOf[AuthenticationService]

  private val ghostId = "00000000-0000-0000-0000-000000000000"

  private def await[T](f: => scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

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
        val trophies = await(userService.getTrophies(u.userId, "Testville"))
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

        val asStranger = await(userService.getPublicProfile(u.username, isOwner = false, isMetric = true, "Testville"))
        asStranger mustBe defined
        asStranger.get.visible mustBe flagIsPublic
        asStranger.get.profile.isDefined mustBe flagIsPublic // stats populated ONLY when visible: nothing leaks
        if (!flagIsPublic) asStranger.get.trophies mustBe empty

        val asOwner = await(userService.getPublicProfile(u.username, isOwner = true, isMetric = true, "Testville"))
        asOwner.map(_.visible) mustBe Some(true)
      }
    }
  }

  "changeUsername" should {
    "reject a name that is too short" in {
      await(userService.changeUsername(ghostId, "ab")).left.toOption.get must include("3–30")
    }

    "reject a name with characters outside letters, numbers, hyphens, underscores" in {
      await(userService.changeUsername(ghostId, "bad name!")).left.toOption.get must include("letters")
    }

    "reject a profane name" in {
      await(userService.changeUsername(ghostId, "shithead99")).left.toOption.get must include("allowed")
    }

    "reject a name another user already holds" in {
      // Legacy usernames may contain characters the charset rule now forbids (that reject fires first), so pick a
      // board user whose name would pass it.
      overallBoard.map(_.username).find(_.matches("^[A-Za-z0-9_-]+$")).foreach { takenName =>
        await(userService.changeUsername(ghostId, takenName)).left.toOption.get must include("taken")
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
