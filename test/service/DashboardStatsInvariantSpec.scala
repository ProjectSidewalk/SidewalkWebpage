package service

import forms.UsernamePolicy
import models.user.{LeaderboardStat, SidewalkUserWithRole, UserStatTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import models.utils.ProfanityGuard
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.db.slick.DatabaseConfigProvider
import slick.basic.DatabaseConfig
import slick.dbio.DBIO
import play.api.i18n.Lang
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.{Application, Configuration}

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

  private val userService               = app.injector.instanceOf[UserService]
  private val messages                  = play.api.test.Helpers.stubMessages()
  private val authService               = app.injector.instanceOf[AuthenticationService]
  private val configService             = app.injector.instanceOf[ConfigService]
  private val config                    = app.injector.instanceOf[Configuration]
  private val userStatTable             = app.injector.instanceOf[UserStatTable]
  private val auditTaskInteractionTable = app.injector.instanceOf[models.audit.AuditTaskInteractionTable]
  // Typed explicitly: letting `.db` infer here yields an existential type the compiler rejects under -Xfatal-warnings.
  private val dbConfig: DatabaseConfig[MyPostgresProfile] =
    app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private val ghostId = "00000000-0000-0000-0000-000000000000"

  private def await[T](f: => scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

  /** The one-decimal rounding `getCrossCityHours` applies before the Time Check page ever sees a number. */
  private def toTenth(hours: Double): Double =
    java.math.BigDecimal.valueOf(hours).setScale(1, java.math.RoundingMode.HALF_UP).doubleValue

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

  private lazy val someStreetEdgeId: Option[Int] =
    await(dbConfig.db.run(sql"SELECT street_edge_id FROM street_edge LIMIT 1".as[Int].headOption))

  /**
   * The reference row a synthetic mapper has to hang off, or a cancellation when this database lacks one.
   *
   * Read outside the fixture's transaction, and as options, so a schema thin enough to be missing one of them cancels
   * these tests rather than erroring the suite — the CANCEL-on-thin-data posture the rest of the suite already takes,
   * and what lets it run against a freshly-created city schema in CI.
   */
  private def fixtureRefs: Int = someStreetEdgeId.getOrElse(cancel("no street_edge rows in this database"))

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
  private def boardWithLabelOnlyUser(onLeaderboard: Boolean, timePeriod: String): Seq[LeaderboardStat] = {
    val streetEdge = fixtureRefs
    runRolledBack(for {
      _ <- sqlu"""INSERT INTO sidewalk_user (user_id, username, email)
                  VALUES ($FixtureUserId, $FixtureUsername, 'zz_fixture_4533@example.com')"""
      _ <- sqlu"INSERT INTO user_role (user_id, role) VALUES ($FixtureUserId, 'Registered')"
      _ <-
        sqlu"""INSERT INTO user_stat (user_id, meters_audited, high_quality, excluded, on_leaderboard, public_profile)
                  VALUES ($FixtureUserId, 0, TRUE, FALSE, $onLeaderboard, TRUE)"""
      missionId <- sql"""INSERT INTO mission
                             (mission_type, user_id, mission_start, mission_end, completed, pay, paid, skipped)
                         VALUES ('audit', $FixtureUserId, now() - INTERVAL '30 days', now() - INTERVAL '30 days',
                                 TRUE, 0, FALSE, FALSE)
                         RETURNING mission_id""".as[Int].head
      auditTaskId <- sql"""INSERT INTO audit_task
                               (user_id, street_edge_id, task_start, task_end, completed, current_lat, current_lng)
                           VALUES ($FixtureUserId, $streetEdge, now(), now(), FALSE, 0, 0)
                           RETURNING audit_task_id""".as[Int].head
      // label.pano_id references pano_data (#4587), so the label's pano has to exist before the label does.
      _ <- sqlu"""INSERT INTO pano_data (pano_id, capture_date, source)
                  VALUES ('fixture_pano', '2020-01', 'gsv')"""
      _ <- sqlu"""INSERT INTO label
                      (audit_task_id, pano_id, label_type, deleted, temporary_label_id, time_created, mission_id,
                       tutorial, street_edge_id, agree_count, disagree_count, unsure_count, tags, user_id)
                  VALUES ($auditTaskId, 'fixture_pano', 'CurbRamp', FALSE, 1, now(), $missionId, FALSE, $streetEdge,
                          0, 0, 0, '{}', $FixtureUserId)"""
      board <- userStatTable.getLeaderboardStats(100000, timePeriod, byTeam = false, None, streetDistance = 1000000d)
    } yield board)
  }

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
      // Uniqueness is the last rung of the ladder, so the name has to clear every rung above it: existing usernames
      // predate the policy and can fail any of them (the login migration's `orphan_<uuid>` names are 43 chars, well
      // over maxLength). Read the rules off the policy rather than restating them, so a bound change can't leave this
      // asserting against a name the service now rejects earlier.
      val eligible = overallBoard.map(_.username).find { name =>
        UsernamePolicy.pattern.findFirstIn(name).isDefined &&
        name.length >= UsernamePolicy.minLength && name.length <= UsernamePolicy.maxLength &&
        ProfanityGuard.isClean(name)
      }
      eligible.foreach { takenName =>
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

  "getCrossCityUserScope" should {
    "return (cityId, schema) pairs that are configured, queryable, and safe to splice" in {
      val scope         = await(configService.getCrossCityUserScope)
      val configuredIds = config.get[Seq[String]]("city-params.city-ids").toSet

      scope.map(_._1).distinct.length mustBe scope.length // a city can't be counted twice in the totals
      scope.map(_._2).distinct.length mustBe scope.length
      scope.foreach { case (cityId, schema) =>
        configuredIds must contain(cityId)
        cityId must not be "staging" // not a real deployment
        schema must fullyMatch regex "^[a-z_][a-z0-9_]*$"
        configService.getCitySchema(cityId) mustBe schema
      }
    }

    "include this deployment, so a mapper always sees the city they are reading the dashboard on" in {
      // Whatever else the scope drops for evolution drift, the schema serving this page is queryable by definition.
      await(configService.getCrossCityUserScope).map(_._1) must contain(configService.getCityId)
    }

    "keep cities the by-name leaderboard excludes, since a mapper's own totals are not a public board" in {
      val selfView    = await(configService.getCrossCityUserScope).map(_._1).toSet
      val boardCities = await(configService.getGlobalLeaderboardScope).cities.map(_._1).toSet
      boardCities.subsetOf(selfView) mustBe true
    }
  }

  "the cross-city stats' cross-schema SQL" should {
    "refuse a schema name that isn't a bare identifier" in {
      // Guards the one place this query interpolates rather than binds; a thrown error beats a crafted query.
      Seq("public; DROP TABLE label", "sidewalk_seattle\"", "Sidewalk_Seattle", "").foreach { bad =>
        an[IllegalArgumentException] must be thrownBy userStatTable.getCrossCityUserStats(
          Seq(bad),
          Set.empty[String],
          ghostId
        )
      }
    }

    "return nothing at all when no city qualifies, rather than building an empty union" in {
      await(
        dbConfig.db.run(userStatTable.getCrossCityUserStats(Seq.empty[String], Set.empty[String], ghostId))
      ) mustBe empty
    }

    "report every queried schema, so the service can tell 'no activity' from 'not queried'" in {
      val schemas = await(configService.getCrossCityUserScope).map(_._2)
      val rows    = await(dbConfig.db.run(userStatTable.getCrossCityUserStats(schemas, Set.empty[String], ghostId)))
      rows.map(_.citySchema).toSet mustBe schemas.toSet
      // A user id that belongs to nobody: every count is zero, and none of them is negative or null-shaped.
      rows.foreach { row =>
        row.labels mustBe 0
        row.validations mustBe 0
        row.missions mustBe 0
        row.lastActivity mustBe None
      }
    }
  }

  "getCrossCityUserStats" should {
    "list only cities with real activity, most labels first, and total them exactly" in {
      topUser.foreach { user =>
        val stats = await(userService.getCrossCityUserStats(user.userId, metricSystem = true, Lang("en"))).get
        stats.cities.map(_.cityId).distinct.length mustBe stats.cities.length
        stats.cities.map(_.labels).sliding(2).foreach {
          case Seq(higher, lower) => higher must be >= lower
          case _                  => ()
        }
        stats.cities.foreach { city =>
          (city.labels + city.validations + city.missions) > 0 || city.distance > 0 mustBe true
          city.labels must be >= 0
          city.validations must be >= 0
          city.missions must be >= 0
          city.distance must be >= 0.0
          city.cityName.trim must not be empty
          // Every row is a city the mapper has worked in, so every row is linkable.
          city.cityUrl.trim must not be empty
        }
        stats.totalLabels mustBe stats.cities.map(_.labels).sum
        stats.totalValidation mustBe stats.cities.map(_.validations).sum
        stats.totalMissions mustBe stats.cities.map(_.missions).sum
        stats.publicCityCount must be >= 0
      }
    }

    "mark exactly one row as the current city, and only when the mapper has worked here" in {
      topUser.foreach { user =>
        val stats = await(userService.getCrossCityUserStats(user.userId, metricSystem = true, Lang("en"))).get
        stats.cities.count(_.isCurrentCity) must be <= 1
        // Against the schema the connection reads, not `city-id` config: a dev box can have the two point at
        // different cities, and the row that must match the hero KPIs is the one the KPIs were computed from.
        val currentSchema = await(dbConfig.db.run(userStatTable.currentSchema))
        stats.cities
          .filter(_.isCurrentCity)
          .foreach(city => configService.getCitySchema(city.cityId) mustBe currentSchema)
        // Distance is recomputed live for this city only; every other row carries the nightly value.
        stats.cities.filterNot(_.isCurrentCity).foreach(_.liveDistance mustBe false)
      }
    }

    "reconcile the current city's row with the hero KPIs it sits under (#4699)" in {
      // The whole point of the section is comparability; a divergence here is the bug the issue describes.
      topUser.foreach { user =>
        val profile = await(userService.getUserProfileData(user.userId, metricSystem = true))
        val stats   = await(userService.getCrossCityUserStats(user.userId, metricSystem = true, Lang("en"))).get
        stats.cities.find(_.isCurrentCity).foreach { here =>
          here.labels mustBe profile.labelCount
          here.validations mustBe profile.validationCount
          here.missions mustBe profile.missionCount
          here.distance mustBe profile.auditedDistance
        }
      }
    }

    "answer in the caller's units and language, not whichever request warmed the cache" in {
      // Only the fan-out is cached; units and names are applied per response. Measurement system is a cookie the
      // mapper can flip mid-session, so a cached rendering would leave the table in miles under a "km" header.
      topUser.foreach { user =>
        val km      = await(userService.getCrossCityUserStats(user.userId, metricSystem = true, Lang("en"))).get
        val miles   = await(userService.getCrossCityUserStats(user.userId, metricSystem = false, Lang("en"))).get
        val spanish = await(userService.getCrossCityUserStats(user.userId, metricSystem = true, Lang("es"))).get

        km.cities.map(_.cityId) mustBe miles.cities.map(_.cityId)
        km.cities.zip(miles.cities).foreach { case (inKm, inMiles) =>
          if (inKm.distance > 0) inMiles.distance must be < inKm.distance
        }
        if (km.totalDistance > 0) miles.totalDistance must be < km.totalDistance

        val spanishNames: Map[String, String] =
          configService.getAllCityInfo(Lang("es")).map(city => city.cityId -> city.cityNameShort).toMap
        spanish.cities.foreach(city => city.cityName mustBe spanishNames(city.cityId))
      }
    }

    "credit a mapper with at least what they did in this city alone" in {
      topUser.foreach { user =>
        val profile = await(userService.getUserProfileData(user.userId, metricSystem = true))
        val stats   = await(userService.getCrossCityUserStats(user.userId, metricSystem = true, Lang("en"))).get
        stats.totalLabels must be >= profile.labelCount
        stats.totalValidation must be >= profile.validationCount
      }
    }

    "report an account that has done nothing as empty rather than unavailable" in {
      val stats = await(userService.getCrossCityUserStats(ghostId, metricSystem = true, Lang("en")))
      stats mustBe defined
      stats.get.cities mustBe empty
      stats.get.totalLabels mustBe 0
    }
  }

  "getCrossCityHoursScope" should {
    "return (cityId, schema) pairs that are configured, queryable, and safe to splice" in {
      val scope         = await(configService.getCrossCityHoursScope)
      val configuredIds = config.get[Seq[String]]("city-params.city-ids").toSet

      scope.cities.map(_._1).distinct.length mustBe scope.cities.length
      scope.cities.foreach { case (cityId, schema) =>
        configuredIds must contain(cityId)
        cityId must not be "staging"
        schema must fullyMatch regex "^[a-z_][a-z0-9_]*$"
        configService.getCitySchema(cityId) mustBe schema
      }
    }

    "gate on the interaction tables the hours query reads, not the contribution tables" in {
      // The two self-view scopes exist separately only because they read different tables. If the column sets ever
      // converged, one of the fan-outs would be gating on readiness it doesn't actually need.
      val hoursTables = ConfigService.CrossCityHoursRequiredColumns.map(_._1)
      val statsTables = ConfigService.CrossCityUserRequiredColumns.map(_._1)

      hoursTables must contain("audit_task_interaction_small")
      hoursTables must contain("webpage_activity")
      statsTables must not contain "audit_task_interaction_small"
      hoursTables must not contain "user_stat"
    }

    "account for every deployment it considered, so an excluded city is never simply lost" in {
      // The count of skipped schemas is what the Time Check page shows the volunteer, so it has to be complete.
      val scope = await(configService.getCrossCityHoursScope)
      scope.skippedSchemas.toSet intersect scope.cities.map(_._2).toSet mustBe empty
      scope.skippedSchemas.distinct.length mustBe scope.skippedSchemas.length
    }
  }

  "getHoursAuditingAndValidatingBySchema" should {
    "refuse a schema name that isn't a bare identifier" in {
      Seq("public; DROP TABLE label", "sidewalk_seattle\"", "Sidewalk_Seattle", "").foreach { bad =>
        an[IllegalArgumentException] must be thrownBy
          auditTaskInteractionTable.getHoursAuditingAndValidatingBySchema(ghostId, bad)
      }
    }

    "agree with the unqualified query when pointed at this connection's own schema" in {
      // The unqualified one delegates here, so a divergence would mean the delegation broke rather than the SQL.
      topUser.foreach { user =>
        val schema = await(dbConfig.db.run(userStatTable.currentSchema))
        await(
          dbConfig.db.run(auditTaskInteractionTable.getHoursAuditingAndValidatingBySchema(user.userId, schema))
        ) mustBe
          await(dbConfig.db.run(auditTaskInteractionTable.getHoursAuditingAndValidating(user.userId)))
      }
    }

    "report zero for an account with no logged activity" in {
      val schema = await(dbConfig.db.run(userStatTable.currentSchema))
      await(
        dbConfig.db.run(auditTaskInteractionTable.getHoursAuditingAndValidatingBySchema(ghostId, schema))
      ) mustBe 0.0
    }
  }

  "getCrossCityHours" should {
    "list only cities with logged time, most hours first, and include at least this city's own total" in {
      topUser.foreach { user =>
        val result = await(userService.getCrossCityHours(user.userId, Lang("en")))
        val rows   = result.cities
        val local  = await(userService.getHoursAuditingAndValidating(user.userId))

        rows.map(_.cityId).distinct.length mustBe rows.length
        rows.map(_.hours).sliding(2).foreach {
          case Seq(higher, lower) => higher must be >= lower
          case _                  => ()
        }
        rows.foreach { row =>
          row.hours must be >= 0d
          row.cityName.trim must not be empty
        }
        rows.count(_.isCurrentCity) must be <= 1
        // The total rounds the full-precision sum, so it can only fall below one city's own by that rounding.
        result.totalHours must be >= local - 0.05001
        // Apportionment can move the current city's row a tenth off its own value to make the table reconcile, so
        // this is the tightest bound that still holds.
        rows.find(_.isCurrentCity).foreach(row => (row.hours - local).abs must be <= 0.10001)
      }
    }

    "hand the page whole tenths, so its one-decimal rendering loses nothing" in {
      // That these tenths reconcile with the headline is arithmetic, covered exhaustively in HoursApportionmentSpec.
      topUser.foreach { user =>
        await(userService.getCrossCityHours(user.userId, Lang("en"))).cities
          .foreach(row => row.hours mustBe toTenth(row.hours))
      }
    }

    "report nothing for an account that has never worked anywhere" in {
      val result = await(userService.getCrossCityHours(ghostId, Lang("en")))
      result.cities mustBe empty
      result.totalHours mustBe 0d
    }

    "count every city it couldn't total, so the page can admit the number is a floor" in {
      val result = await(userService.getCrossCityHours(ghostId, Lang("en")))
      val scope  = await(configService.getCrossCityHoursScope)
      // Nothing is unreachable beyond what the scope already held back, on a database that is answering queries.
      result.unreachableCities must be >= scope.skippedSchemas.size
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

  "user_stat's one-row-per-user invariant (#4604)" should {
    "hold in the connected database" in {
      // Every read of a user's stats takes the first row it finds, so a second row is a silent wrong answer rather
      // than an error. Catches an evolution or hand fix-up that drops user_stat_user_id_key.
      val dupeCount = await(
        dbConfig.db.run(
          sql"SELECT count(*) FROM (SELECT 1 FROM user_stat GROUP BY user_id HAVING count(*) > 1) duplicated"
            .as[Int]
            .head
        )
      )
      dupeCount mustBe 0
    }

    "make a second insertIfNew for the same user a no-op" in {
      // The behavior every caller now leans on instead of a read-then-insert. Also fails loudly if the constraint is
      // ever renamed out from under insertIfNew's ON CONFLICT (user_id) inference.
      val (first, second) = runRolledBack(for {
        _ <- sqlu"""INSERT INTO sidewalk_user (user_id, username, email)
                    VALUES ($FixtureUserId, $FixtureUsername, 'zz_fixture_4533@example.com')"""
        _      <- sqlu"INSERT INTO user_role (user_id, role) VALUES ($FixtureUserId, 'Registered')"
        first  <- userStatTable.insertIfNew(FixtureUserId, onLeaderboard = true, publicProfile = true)
        second <- userStatTable.insertIfNew(FixtureUserId, onLeaderboard = false, publicProfile = false)
        rows   <- sql"SELECT count(*) FROM user_stat WHERE user_id = $FixtureUserId".as[Int].head
      } yield {
        rows mustBe 1
        (first, second)
      })
      first mustBe 1
      second mustBe 0
    }
  }
}
