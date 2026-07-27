package service

import models.user.{SidewalkUserWithRole, UserStatTable}
import models.utils.MyPostgresProfile
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.db.slick.DatabaseConfigProvider
import slick.basic.DatabaseConfig
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.{Application, Configuration}

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

  private val userService   = app.injector.instanceOf[UserService]
  private val messages      = play.api.test.Helpers.stubMessages()
  private val authService   = app.injector.instanceOf[AuthenticationService]
  private val configService = app.injector.instanceOf[ConfigService]
  private val config        = app.injector.instanceOf[Configuration]
  private val userStatTable = app.injector.instanceOf[UserStatTable]
  // Typed explicitly: letting `.db` infer here yields an existential type the compiler rejects under -Xfatal-warnings.
  private val dbConfig: DatabaseConfig[MyPostgresProfile] =
    app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private val ghostId = "00000000-0000-0000-0000-000000000000"

  private def await[T](f: => scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

  // One user who is definitely eligible for the boards (rows here passed the role/excluded/on_leaderboard filters).
  private lazy val overallBoard                          = await(userService.getLeaderboardStats(10, "overall"))
  private lazy val topUser: Option[SidewalkUserWithRole] =
    overallBoard.headOption.flatMap(s => await(authService.findByUsername(s.username)))
  private lazy val globalBoardOpt: Option[Seq[GlobalLeaderboardEntry]] =
    await(userService.getGlobalLeaderboardStats(10))
  private lazy val globalBoard: Seq[GlobalLeaderboardEntry] = globalBoardOpt.getOrElse(Seq.empty)

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

  "getGlobalLeaderboardScope" should {
    "return (cityId, schema) pairs that are configured, queryable, and not opted out" in {
      val cities        = await(configService.getGlobalLeaderboardScope).cities
      val configuredIds = config.get[Seq[String]]("city-params.city-ids").toSet

      cities.map(_._1).distinct.length mustBe cities.length // a city can't be counted twice in the totals
      cities.map(_._2).distinct.length mustBe cities.length
      cities.foreach { case (cityId, schema) =>
        configuredIds must contain(cityId)
        cityId must not be "staging" // not a real deployment
        // Schemas are spliced into the cross-schema SQL, so anything but a bare identifier would be an injection risk.
        schema must fullyMatch regex "^[a-z_][a-z0-9_]*$"
        configService.getCitySchema(cityId) mustBe schema
      }
    }

    "exclude cities that opt out of the by-name board, whether explicitly or via private-by-default (#4480)" in {
      val included = await(configService.getGlobalLeaderboardScope).cities.map(_._1)
      val optedOut = config.get[Seq[String]]("city-params.city-ids").filter { cityId =>
        Seq("global-leaderboard-excluded", "private-profiles-by-default").exists { block =>
          val path = s"city-params.$block.$cityId"
          config.underlying.hasPath(path) && config.get[Boolean](path)
        }
      }
      // Vacuous while no city sets either flag; it fails loudly the moment one does and the filter regresses.
      optedOut.foreach(cityId => included must not contain cityId)
    }

    "name only publicly launched deployments, so the Top city column can't advertise an unlaunched one" in {
      await(configService.getGlobalLeaderboardScope).cities.foreach { case (cityId, _) =>
        config.getOptional[String](s"city-params.status.$cityId") mustBe Some("public")
      }
    }

    "read opt-outs from ready deployments it excludes, but never from private-by-default ones" in {
      val scope = await(configService.getGlobalLeaderboardScope)
      // An opt-out schema is one whose contributions are excluded, so the two sets must not overlap.
      scope.optOutSchemas.toSet.intersect(scope.cities.map(_._2).toSet) mustBe empty
      scope.optOutSchemas.foreach { schema =>
        schema must fullyMatch regex "^[a-z_][a-z0-9_]*$"
        // There, on_leaderboard is off for everyone by default, so a FALSE isn't a deliberate choice to honor.
        val cityId = config.get[Seq[String]]("city-params.city-ids").find(configService.getCitySchema(_) == schema)
        cityId.foreach { id =>
          val path = s"city-params.private-profiles-by-default.$id"
          (config.underlying.hasPath(path) && config.get[Boolean](path)) mustBe false
        }
      }
    }
  }

  "getGlobalLeaderboardStats" should {
    "return at most n unique users in strict label-count order, with stats in range" in {
      globalBoard.length must be <= 10
      globalBoard.map(_.username).distinct.length mustBe globalBoard.length
      // Unlike the per-city boards, this one ranks on the value it displays, so rows are in true descending order.
      globalBoard.map(_.labelCount).sliding(2).foreach {
        case Seq(higher, lower) => higher must be >= lower
        case _                  => ()
      }
      globalBoard.foreach { s =>
        s.labelCount must be > 0 // a user whose every city is excluded is dropped, not shown with a zero
        s.missionCount must be >= 0
        s.distanceMeters must be >= 0.0
        s.accuracy.foreach { a => a must be >= 0.0; a must be <= 1.0 }
        s.username.trim must not be empty
      }
    }

    "name a top city that is one of the cities the board was built from" in {
      val eligibleIds = await(configService.getGlobalLeaderboardScope).cities.map(_._1).toSet
      globalBoard.flatMap(_.topCityId).foreach(cityId => eligibleIds must contain(cityId))
    }

    "credit a user with at least as many labels as they have in this city alone" in {
      // The global total sums this city plus every other, so it can never come in under the local all-time board.
      val localByUser = overallBoard.map(s => s.username -> s.labelCount).toMap
      globalBoard.foreach { g => localByUser.get(g.username).foreach(localCount => g.labelCount must be >= localCount) }
    }

    "link a name only when that mapper has a public profile in this city" in {
      // A row can come from a mapper who never labeled here, whose profile page would just say "kept private".
      globalBoard.filter(_.profileLinked).foreach { entry =>
        await(userService.resolveVisibleUser(entry.username, isOwner = false)) must not be None
      }
    }

    "be stable across calls, so a tie doesn't shuffle the board between refreshes" in {
      // Same n twice: the cache serves the second, but a missing ORDER BY tiebreaker would show up here uncached too.
      await(userService.getGlobalLeaderboardStats(10)).map(_.map(_.username)) mustBe globalBoardOpt.map(
        _.map(_.username)
      )
    }

    "respect n" in {
      await(userService.getGlobalLeaderboardStats(3)).getOrElse(Nil).length must be <= 3
    }
  }

  "the global leaderboard's cross-schema SQL" should {
    "refuse a schema name that isn't a bare identifier" in {
      // Guards the one place the leaderboard interpolates rather than binds; a thrown error beats a crafted query.
      Seq("public; DROP TABLE label", "sidewalk_seattle\"", "Sidewalk_Seattle", "").foreach { bad =>
        an[IllegalArgumentException] must be thrownBy userStatTable.getGlobalLeaderboardStats(Seq(bad), Seq.empty, 10)
        an[IllegalArgumentException] must be thrownBy
          userStatTable.getGlobalLeaderboardStats(Seq("sidewalk_seattle"), Seq(bad), 10)
      }
    }

    "return nothing at all when no city qualifies, rather than building an empty union" in {
      await(dbConfig.db.run(userStatTable.getGlobalLeaderboardStats(Seq.empty[String], Seq.empty[String], 10))) mustBe
        empty
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
