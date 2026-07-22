package models.audit

import models.region.RegionTableDef
import models.route.{
  AuditTaskUserRoute,
  AuditTaskUserRouteTableDef,
  Route,
  RouteStreet,
  RouteStreetTableDef,
  RouteTableDef,
  UserRoute,
  UserRouteTableDef
}
import models.street.{StreetEdgeRegionTableDef, StreetEdgeTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.silhouette.api.util.PasswordInfo
import service.AuthenticationService
import slick.dbio.DBIO

import java.time.OffsetDateTime
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed tests for AuditTaskTable.selectTasksInRoute, the query that hands Explore the full task list for a route
 * walk. It decides the walking order shown on the minimap and which streets still need auditing, so when it fails the
 * whole session degrades to a single street.
 *
 * These run the real query against Postgres on purpose. The query joins a grouped subquery, and Slick will happily
 * compile a shape that only fails once Postgres parses it ("missing FROM-clause entry"), so type-checking proves
 * nothing here — it has to be executed.
 *
 * The route deliberately traverses one street twice (an out-and-back), which is the case that distinguishes keying
 * completion by route_street from keying it by street: with the latter, finishing the outbound leg marks the return
 * leg done and hands it the outbound leg's audit task.
 *
 * Every row created here is removed in afterAll — the dev DB is shared, so residue would pollute other work.
 */
class RouteTaskQuerySpec extends PlaySpec with org.scalatest.BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val dbConfig        = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private lazy val auditTaskTable  = app.injector.instanceOf[AuditTaskTable]
  private lazy val authService     = app.injector.instanceOf[AuthenticationService]
  private lazy val streetEdgeTable = app.injector.instanceOf[StreetEdgeTable]

  private def run[T](action: DBIO[T]): T                 = Await.result(dbConfig.db.run(action), 60.seconds)
  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

  private val routes           = TableQuery[RouteTableDef]
  private val routeStreets     = TableQuery[RouteStreetTableDef]
  private val userRoutes       = TableQuery[UserRouteTableDef]
  private val auditTasks       = TableQuery[AuditTaskTableDef]
  private val auditTaskLinks   = TableQuery[AuditTaskUserRouteTableDef]
  private val streetEdgeRegion = TableQuery[StreetEdgeRegionTableDef]
  private val regions          = TableQuery[RegionTableDef]

  private var userId: String           = _
  private var routeId: Int             = _
  private var userRouteId: Int         = _
  private var routeStreetIds: Seq[Int] = Seq.empty
  private var auditTaskIds: Seq[Int]   = Seq.empty

  /**
   * Two street ids sharing a region, so the seeded route is a legal one-neighborhood route.
   *
   * Drawn from the same filtered street query selectTasksInRoute joins against — a street that's hidden or is the
   * tutorial street would silently drop out of the result and look like a query bug.
   */
  private def twoStreetsInARegion(): Option[(Int, Int, Int)] = {
    val rows = run(
      streetEdgeRegion
        .join(regions.filter(!_.deleted))
        .on(_.regionId === _.regionId)
        .join(streetEdgeTable.streets)
        .on { case ((ser, _), street) => ser.streetEdgeId === street.streetEdgeId }
        .map { case ((ser, _), _) => (ser.regionId, ser.streetEdgeId) }
        .result
    )
    rows.groupBy(_._1).collectFirst {
      case (regionId, streets) if streets.size >= 2 => (regionId, streets.head._2, streets(1)._2)
    }
  }

  override def beforeAll(): Unit = {
    super.beforeAll()
    twoStreetsInARegion().foreach { case (regionId, streetA, streetB) =>
      val generated = await(authService.generateUniqueAnonUser())
      val pwInfo    = PasswordInfo("bcrypt-sha256", "spec-only-not-a-hash", None)
      userId = await(authService.createUser(generated, "credentials", pwInfo, oldUserId = None)).userId

      routeId = run(
        (routes returning routes.map(_.routeId)) += Route(
          0,
          userId,
          regionId,
          "Spec Route",
          s"spec-route-${java.util.UUID.randomUUID}",
          None,
          public = false,
          deleted = false,
          OffsetDateTime.now,
          0d,
          0
        )
      )
      // A -> B -> A: the same street twice, in opposite directions.
      routeStreetIds = run(
        (routeStreets returning routeStreets.map(_.routeStreetId)) ++= Seq(
          RouteStreet(0, routeId, streetA, reverse = false, 0),
          RouteStreet(0, routeId, streetB, reverse = false, 1),
          RouteStreet(0, routeId, streetA, reverse = true, 2)
        )
      )
      userRouteId = run(
        (userRoutes returning userRoutes.map(_.userRouteId)) += UserRoute(0, routeId, userId, completed = false,
          discarded = false)
      )
    }
  }

  override def afterAll(): Unit = {
    if (routeId != 0) {
      run(auditTaskLinks.filter(_.userRouteId === userRouteId).delete)
      run(auditTasks.filter(_.auditTaskId inSet auditTaskIds).delete)
      run(userRoutes.filter(_.userRouteId === userRouteId).delete)
      run(routeStreets.filter(_.routeId === routeId).delete)
      run(routes.filter(_.routeId === routeId).delete)
    }
    super.afterAll()
  }

  "selectTasksInRoute" should {
    "return every route_street as its own task, in walking order" in {
      assume(routeId != 0, "no region with two streets in the connected DB")
      val tasks = run(auditTaskTable.selectTasksInRoute(userRouteId))

      tasks must have size 3
      tasks.flatMap(_.routeStreetPosition).sorted mustBe Seq(0, 1, 2)
      // Each traversal is a distinct route_street row, including the street walked twice.
      tasks.flatMap(_.routeStreetId).distinct must have size 3
      tasks.forall(!_.completed) mustBe true
    }

    "mark only the traversal that was actually completed, not every visit to that street" in {
      assume(routeId != 0, "no region with two streets in the connected DB")
      val outboundRouteStreetId = routeStreetIds.head // position 0, the first traversal of street A.
      val outbound              = run(auditTaskTable.selectTasksInRoute(userRouteId))
        .find(_.routeStreetId.contains(outboundRouteStreetId))
        .get

      val now         = OffsetDateTime.now
      val auditTaskId = run(
        (auditTasks returning auditTasks.map(_.auditTaskId)) += AuditTask(0, None, userId, outbound.edgeId, now, now,
          completed = true, 0d, 0d, startPointReversed = false, None, None, lowQuality = false, incomplete = false,
          stale = false, None)
      )
      auditTaskIds = auditTaskIds :+ auditTaskId
      run(auditTaskLinks += AuditTaskUserRoute(0, userRouteId, auditTaskId, outboundRouteStreetId))

      val tasks = run(auditTaskTable.selectTasksInRoute(userRouteId))
      tasks must have size 3
      tasks.filter(_.completed).flatMap(_.routeStreetId) mustBe Seq(outboundRouteStreetId)
      // The return leg walks the same street, so keying completion by street would have marked it done too.
      tasks.find(_.routeStreetPosition.contains(2)).get.completed mustBe false
    }
  }
}
