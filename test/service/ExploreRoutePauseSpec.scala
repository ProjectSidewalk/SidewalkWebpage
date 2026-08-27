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
import models.street.{StreetEdgeRegionTableDef, StreetEdgeTable}
import models.user.{SidewalkUserWithRole, UserCurrentRegionTableDef}
import models.utils.MyPostgresProfile
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
 * DB-backed tests for #4833: exiting a custom-route walk pauses it (progress kept, resumable) rather than
 * discarding it, and a paused walk is only ever resumed by an explicit ?routeId= visit — never silently.
 *
 * The contract, end to end through `getDataForExplorePage`:
 *   - `/explore?resumeRoute=false` (the exit-route link) pauses the user's active walk and returns no route.
 *   - A later bare `/explore` visit does NOT resume a paused walk.
 *   - An explicit `/explore?routeId=X` visit resumes the *same* paused walk (same user_route row, progress intact).
 *   - `/explore?routeId=X&resumeRoute=false` is the one destructive path: it discards the old walk and starts fresh.
 *   - Entering a different route pauses (not discards) the walk being left behind.
 *
 * Setup/teardown mirror ExploreTutorialRouteSpec: throwaway anonymous users, seeded route walks, all rows swept in
 * afterAll. Requires a Postgres+PostGIS DB with at least one street/region (as in dev/CI); cancels otherwise.
 */
// BeforeAndAfterAll must be mixed in BEFORE GuiceOneAppPerSuite: linearization then runs afterAll inside the running
// app, rather than after the app (and its DB pool) has already been stopped.
class ExploreRoutePauseSpec
    extends PlaySpec
    with org.scalatest.BeforeAndAfterAll
    with org.scalatest.LoneElement
    with GuiceOneAppPerSuite {

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

  /** Creates a throwaway anonymous user (marked past the tutorial) and registers it for afterAll cleanup. */
  private def newTutorialGraduate(): SidewalkUserWithRole = {
    val generated = await(authService.generateUniqueAnonUser())
    val pwInfo    = PasswordInfo("bcrypt-sha256", "spec-only-not-a-hash", None)
    val user      = await(authService.createUser(generated, "credentials", pwInfo, oldUserId = None))
    createdUserIds += user.userId
    val now = OffsetDateTime.now
    val _   = run(
      missions += Mission(0, MissionType.AuditOnboarding, user.userId, now, now, completed = true, 0d, paid = false,
        None, None, None, None, None, None, skipped = false, None, None)
    )
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

  /** Seeds a one-street route and an in-progress (active) walk of it for the given user; returns the route id. */
  private def seedActiveRouteWalk(userId: String, streetEdgeId: Int, regionId: Int): Int = {
    val n       = slugCounter.incrementAndGet()
    val routeId = run(
      (routes returning routes.map(_.routeId)) +=
        Route(
          0,
          userId,
          regionId,
          s"4833 spec route $n",
          s"spec-4833-route-$n",
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

  /** The `/explore` visit with the params under test; no region/street params. */
  private def pageData(
      userId: String,
      routeId: Option[Int] = None,
      resumeRoute: Boolean = true
  ): ExplorePageData = await(
    exploreService.getDataForExplorePage(userId, retakingTutorial = false, newRegion = false, routeId = routeId,
      resumeRoute = resumeRoute, regionId = None, streetEdgeId = None)
  )

  private def walksFor(userId: String): Seq[UserRoute] =
    run(userRoutes.filter(_.userId === userId).sortBy(_.userRouteId).result)

  /**
   * Deletes every row the suite created under its throwaway users. Mission and audit_task reference each other
   * (mission.current_audit_task_id), so the mission->task pointer is nulled first; route children (route_street,
   * user_route and its audit_task_user_route rows) go before the routes themselves. The bare user/auth rows are
   * left behind, matching ExploreTutorialRouteSpec's precedent.
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
          TableQuery[UserCurrentRegionTableDef].filter(_.userId inSet userIds).delete
        )
        .transactionally
    )
    super.afterAll()
  }

  "getDataForExplorePage" should {
    "pause the active walk on /explore?resumeRoute=false, and stop resuming it silently" in {
      seedStreet match {
        case None                           => cancel("No street/region rows in the connected DB; nothing to exercise.")
        case Some((streetEdgeId, regionId)) =>
          val user = newTutorialGraduate()
          seedActiveRouteWalk(user.userId, streetEdgeId, regionId)

          val exitData = pageData(user.userId, resumeRoute = false)
          exitData.userRoute mustBe None
          exitData.route mustBe None

          // Paused, not discarded: the walk keeps its progress and stays explicitly resumable.
          val walk = walksFor(user.userId).loneElement
          walk.paused mustBe true
          walk.discarded mustBe false
          walk.completed mustBe false

          // A later bare /explore visit must not resume the paused walk.
          val laterData = pageData(user.userId)
          laterData.userRoute mustBe None
          laterData.route mustBe None
          walksFor(user.userId).loneElement.paused mustBe true
      }
    }

    "resume the same paused walk when the route is explicitly re-entered via ?routeId=" in {
      seedStreet match {
        case None                           => cancel("No street/region rows in the connected DB; nothing to exercise.")
        case Some((streetEdgeId, regionId)) =>
          val user    = newTutorialGraduate()
          val routeId = seedActiveRouteWalk(user.userId, streetEdgeId, regionId)
          val walkId  = walksFor(user.userId).loneElement.userRouteId

          val _    = pageData(user.userId, resumeRoute = false) // Exit the route.
          val data = pageData(user.userId, routeId = Some(routeId))

          // The same user_route row, un-paused — so all walk progress hanging off it carries over.
          data.userRoute.value.userRouteId mustBe walkId
          val walk = walksFor(user.userId).loneElement
          walk.paused mustBe false
          walk.discarded mustBe false
      }
    }

    "discard the old walk and start fresh on ?routeId=X&resumeRoute=false (explicit restart)" in {
      seedStreet match {
        case None                           => cancel("No street/region rows in the connected DB; nothing to exercise.")
        case Some((streetEdgeId, regionId)) =>
          val user    = newTutorialGraduate()
          val routeId = seedActiveRouteWalk(user.userId, streetEdgeId, regionId)
          val walkId  = walksFor(user.userId).loneElement.userRouteId

          val data = pageData(user.userId, routeId = Some(routeId), resumeRoute = false)

          data.userRoute.value.userRouteId must not be walkId
          val walks = walksFor(user.userId)
          walks must have size 2
          walks.find(_.userRouteId == walkId).value.discarded mustBe true
      }
    }

    "pause (not discard) the walk being left behind when entering a different route" in {
      seedStreet match {
        case None                           => cancel("No street/region rows in the connected DB; nothing to exercise.")
        case Some((streetEdgeId, regionId)) =>
          val user     = newTutorialGraduate()
          val routeIdA = seedActiveRouteWalk(user.userId, streetEdgeId, regionId)
          val routeIdB = seedActiveRouteWalk(user.userId, streetEdgeId, regionId)

          val data = pageData(user.userId, routeId = Some(routeIdB))

          data.userRoute.value.routeId mustBe routeIdB
          val walkA = walksFor(user.userId).find(_.routeId == routeIdA).value
          walkA.paused mustBe true
          walkA.discarded mustBe false
      }
    }
  }
}
