package service

import models.mission.{Mission, MissionTableDef, MissionType}
import models.audit.AuditTaskTableDef
import models.region.RegionTableDef
import models.route.{
  AuditTaskUserRouteTableDef,
  Route,
  RouteStreet,
  RouteStreetTableDef,
  RouteTableDef,
  UserRoute,
  UserRouteTableDef
}
import models.street.{StreetEdgeRegionTableDef, StreetEdgeTable, StreetEdgeTableDef}
import models.user.SidewalkUserWithRole
import models.utils.{ConfigTableDef, MyPostgresProfile}
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.silhouette.api.util.PasswordInfo
import slick.dbio.DBIO

import java.time.OffsetDateTime
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed regression tests for #4816: an in-progress route walk must never surface on the Explore page while the
 * session is the tutorial.
 *
 * The leak: `getDataForExplorePage` resolves a resumable `user_route` row before it resolves the mission, and a row
 * left active by an abandoned RouteBuilder walk would ship to the client even when the mission came back as the
 * tutorial — flipping the frontend into route mode and drawing the old route over the tutorial map. The contract
 * under test is suppress-not-discard: the tutorial page data carries no route, but the row itself stays active so
 * the walk still resumes on the post-tutorial reload of /explore.
 *
 * Creates throwaway anonymous users (same approach as ExploreAddressServiceSpec) and seeds each one's route walk
 * directly; a control test proves the same seed *does* surface for a tutorial graduate, so the suppression
 * assertions can't pass vacuously. All seeded route/user_route/mission rows are deleted in afterAll — mandatory,
 * not just tidy: the dev DB is shared. Requires a Postgres+PostGIS DB with at least one street/region and a
 * configured tutorial street (as in dev/CI); cancels gracefully otherwise.
 */
// BeforeAndAfterAll must be mixed in BEFORE GuiceOneAppPerSuite: linearization then runs afterAll inside the running
// app, rather than after the app (and its DB pool) has already been stopped.
class ExploreTutorialRouteSpec extends PlaySpec with org.scalatest.BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val exploreService  = app.injector.instanceOf[ExploreService]
  private val authService     = app.injector.instanceOf[AuthenticationService]
  private val streetEdgeTable = app.injector.instanceOf[StreetEdgeTable]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)
  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

  private val missions            = TableQuery[MissionTableDef]
  private val auditTasks          = TableQuery[AuditTaskTableDef]
  private val routes              = TableQuery[RouteTableDef]
  private val routeStreets        = TableQuery[RouteStreetTableDef]
  private val userRoutes          = TableQuery[UserRouteTableDef]
  private val auditTaskUserRoutes = TableQuery[AuditTaskUserRouteTableDef]

  /** Every throwaway user the suite creates, so afterAll can sweep all of their rows uniformly. */
  private val createdUserIds = scala.collection.mutable.Set[String]()

  /** Distinguishes seeded routes' slugs; route.slug is globally unique (route_slug_idx). */
  private val slugCounter = new AtomicInteger(0)

  /** Creates a throwaway anonymous user and registers it for afterAll cleanup. */
  private def newAnonUser(): SidewalkUserWithRole = {
    val generated = await(authService.generateUniqueAnonUser())
    val pwInfo    = PasswordInfo("bcrypt-sha256", "spec-only-not-a-hash", None)
    val user      = await(authService.createUser(generated, "credentials", pwInfo, oldUserId = None))
    createdUserIds += user.userId
    user
  }

  /** A routable (open, non-tutorial) street and its region to hang seeded routes on; None means the DB is unseeded. */
  private lazy val seedStreet: Option[(Int, Int)] = run(
    TableQuery[StreetEdgeRegionTableDef]
      .join(streetEdgeTable.streets)
      .on(_.streetEdgeId === _.streetEdgeId)
      .join(TableQuery[RegionTableDef].filterNot(_.deleted))
      .on(_._1.regionId === _.regionId)
      .map { case ((streetEdgeRegion, _), _) => (streetEdgeRegion.streetEdgeId, streetEdgeRegion.regionId) }
      .result
      .headOption
  )

  /** Tutorial page data needs the configured tutorial street to exist (AuditTaskTable.getATutorialTask joins it). */
  private lazy val tutorialStreetExists: Boolean = run(
    TableQuery[StreetEdgeTableDef]
      .join(TableQuery[ConfigTableDef])
      .on(_.streetEdgeId === _.tutorialStreetEdgeID)
      .exists
      .result
  )

  /** Seeds a one-street route and an in-progress (active) walk of it for the given user; returns the route id. */
  private def seedActiveRouteWalk(userId: String, streetEdgeId: Int, regionId: Int): Int = {
    val n       = slugCounter.incrementAndGet()
    val routeId = run(
      (routes returning routes.map(_.routeId)) +=
        Route(
          0,
          userId,
          regionId,
          s"4816 spec route $n",
          s"spec-4816-route-$n",
          None,
          public = false,
          deleted = false,
          OffsetDateTime.now,
          0d,
          1
        )
    )
    val _ = run(routeStreets += RouteStreet(0, routeId, streetEdgeId, reverse = false, position = 0))
    val _ = run(userRoutes += UserRoute(0, routeId, userId, completed = false, discarded = false))
    routeId
  }

  /** Records tutorial completion the way the schema does: a completed auditOnboarding mission. */
  private def markOnboardingComplete(userId: String): Unit = {
    val now = OffsetDateTime.now
    val _   = run(
      missions += Mission(0, MissionType.AuditOnboarding, userId, now, now, completed = true, 0d, paid = false, None,
        None, None, None, None, None, skipped = false, None, None)
    )
  }

  /** The bare `/explore` visit: no explicit route/region/street params, resumeRoute at its routes-file default. */
  private def pageData(userId: String, retakingTutorial: Boolean = false): ExplorePageData = await(
    exploreService.getDataForExplorePage(userId, retakingTutorial, newRegion = false, routeId = None,
      resumeRoute = true, regionId = None, streetEdgeId = None)
  )

  /**
   * Deletes every row the suite created under its throwaway users. Mission and audit_task reference each other
   * (mission.current_audit_task_id), so the mission->task pointer is nulled first; route children (route_street,
   * user_route and its audit_task_user_route rows) go before the routes themselves. The bare user/auth rows are
   * left behind, matching ExploreAddressServiceSpec's precedent.
   */
  override def afterAll(): Unit = {
    val userIds        = createdUserIds.toSeq
    val seededRouteIds = routes.filter(_.userId inSet userIds).map(_.routeId)
    val seededWalkIds  = userRoutes.filter(_.userId inSet userIds).map(_.userRouteId)
    val _              = run(
      DBIO
        .seq(
          missions.filter(_.userId inSet userIds).map(_.currentAuditTaskId).update(None),
          auditTaskUserRoutes.filter(_.userRouteId in seededWalkIds).delete,
          auditTasks.filter(_.userId inSet userIds).delete,
          missions.filter(_.userId inSet userIds).delete,
          userRoutes.filter(_.userId inSet userIds).delete,
          routeStreets.filter(_.routeId in seededRouteIds).delete,
          routes.filter(_.userId inSet userIds).delete,
          TableQuery[models.user.UserCurrentRegionTableDef].filter(_.userId inSet userIds).delete
        )
        .transactionally
    )
    super.afterAll()
  }

  "getDataForExplorePage" should {
    "not surface an in-progress route walk to a user who still needs the tutorial (#4816)" in {
      seedStreet match {
        case None                           => cancel("No street/region rows in the connected DB; nothing to exercise.")
        case Some((streetEdgeId, regionId)) =>
          if (!tutorialStreetExists) cancel("No tutorial street configured in the connected DB.")
          val user = newAnonUser()
          seedActiveRouteWalk(user.userId, streetEdgeId, regionId)

          val data = pageData(user.userId)

          data.mission.missionType mustBe MissionType.AuditOnboarding
          data.userRoute mustBe None
          data.route mustBe None

          // Suppress, not discard: the walk must stay active so it resumes on the post-tutorial reload.
          val walk = run(userRoutes.filter(_.userId === user.userId).result.head)
          walk.completed mustBe false
          walk.discarded mustBe false
      }
    }

    "resume the same seeded walk for a tutorial graduate (control: the suppression tests aren't vacuous)" in {
      seedStreet match {
        case None                           => cancel("No street/region rows in the connected DB; nothing to exercise.")
        case Some((streetEdgeId, regionId)) =>
          val user = newAnonUser()
          markOnboardingComplete(user.userId)
          val routeId = seedActiveRouteWalk(user.userId, streetEdgeId, regionId)

          val data = pageData(user.userId)

          data.mission.missionType must not be MissionType.AuditOnboarding
          data.userRoute.value.routeId mustBe routeId
          data.route.value.routeId mustBe routeId
      }
    }

    "suppress the route again when a tutorial graduate retakes the tutorial" in {
      seedStreet match {
        case None                           => cancel("No street/region rows in the connected DB; nothing to exercise.")
        case Some((streetEdgeId, regionId)) =>
          if (!tutorialStreetExists) cancel("No tutorial street configured in the connected DB.")
          val user = newAnonUser()
          markOnboardingComplete(user.userId)
          seedActiveRouteWalk(user.userId, streetEdgeId, regionId)

          val data = pageData(user.userId, retakingTutorial = true)

          data.mission.missionType mustBe MissionType.AuditOnboarding
          data.userRoute mustBe None
          data.route mustBe None
      }
    }
  }
}
