package models.route

import models.audit.{AuditTaskTable, NewTask}
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.street.{StreetEdgePriorityTable, StreetEdgeTable}
import models.utils.MyPostgresDriver.simple._
import com.vividsolutions.jts.geom.{Geometry, Point}
import play.api.Play.current
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.slick.lifted.ForeignKeyQuery

case class UserRoute(userRouteId: Int, routeId: Int, userId: String, completed: Boolean, discarded: Boolean)

class UserRouteTable(tag: slick.lifted.Tag) extends Table[UserRoute](tag, Some("sidewalk"), "user_route") {
  def userRouteId: Column[Int] = column[Int]("user_route_id", O.PrimaryKey, O.AutoInc)
  def routeId: Column[Int] = column[Int]("route_id", O.NotNull)
  def userId: Column[String] = column[String]("user_id", O.NotNull)
  def completed: Column[Boolean] = column[Boolean]("completed", O.NotNull)
  def discarded: Column[Boolean] = column[Boolean]("discarded", O.NotNull)

  def * = (userRouteId, routeId, userId, completed, discarded) <> ((UserRoute.apply _).tupled, UserRoute.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] = foreignKey("user_route_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)
  def user: ForeignKeyQuery[UserTable, DBUser] = foreignKey("user_route_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

/**
 * Data access object for the route table.
 */
object UserRouteTable {
  val db = play.api.db.slick.DB
  val userRoutes = TableQuery[UserRouteTable]
  val activeRoutes = userRoutes.filter(ur => !ur.completed && !ur.discarded)

  def setUpPossibleUserRoute(routeId: Option[Int], userId: UUID, resumeRoute: Boolean): Option[UserRoute] = db.withSession { implicit session =>
    (routeId, resumeRoute) match {
      case (Some(rId), true) =>
        // Discard routes that don't match routeId, resume route with given routeId if it exists, o/w make a new one.
        activeRoutes.filter(x => x.routeId =!= rId && x.userId === userId.toString).map(_.discarded).update(true)

        Some(activeRoutes
          .filter(ur => ur.routeId === rId && ur.userId === userId.toString)
          .firstOption.getOrElse(save(UserRoute(0, rId, userId.toString, completed = false, discarded = false))))
      case (Some(rId), false) =>
        // Discard old routes, save a new one with given routeId.
        activeRoutes.filter(_.userId === userId.toString).map(_.discarded).update(true)
        Some(save(UserRoute(0, rId, userId.toString, completed = false, discarded = false)))
      case (None, true) =>
        // Get an in progress route (with any routeId) if it exists, otherwise return None.
        activeRoutes.filter(_.userId === userId.toString).firstOption
      case (None, false) =>
        // Discard old routes, return None.
        activeRoutes.filter(_.userId === userId.toString).map(_.discarded).update(true)
        None
    }
  }

  def selectTasksInRoute(userRouteId: Int): List[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    val edgesInRoute = userRoutes
      .filter(_.userRouteId === userRouteId)
      .innerJoin(RouteStreetTable.routeStreets).on(_.routeId === _.routeId)
      .innerJoin(StreetEdgeTable.streetEdgesWithoutDeleted).on(_._2.streetEdgeId === _.streetEdgeId)
      .map{ case ((_userRoute, _routeStreet), _streetEdge) => (_streetEdge, _routeStreet) }

    // Get street_edge_id, task_start, audit_task_id, current_mission_id, and current_mission_start for streets the user
    // has audited. If there are multiple for the same street, choose most recent (one w/ the highest audit_task_id).
    val userCompletedStreets = AuditTaskUserRouteTable.auditTaskUserRoutes
      .filter(_.userRouteId === userRouteId)
      .innerJoin(AuditTaskTable.completedTasks).on(_.auditTaskId === _.auditTaskId)
      .groupBy(_._2.streetEdgeId).map(_._2.map(_._2.auditTaskId).max)
      .innerJoin(AuditTaskTable.auditTasks).on(_ === _.auditTaskId)
      .map(t => (t._2.streetEdgeId, t._2.taskStart, t._2.auditTaskId, t._2.currentMissionId, t._2.currentMissionStart))

    val tasks = for {
      ((_se1, _rs), ucs) <- edgesInRoute.leftJoin(userCompletedStreets).on(_._1.streetEdgeId === _._1)
      _se2 <- StreetEdgeTable.streetEdges if _se1.streetEdgeId === _se2.streetEdgeId
      _sep <- StreetEdgePriorityTable.streetEdgePriorities if _se2.streetEdgeId === _sep.streetEdgeId
      _scau <- AuditTaskTable.streetCompletedByAnyUser if _sep.streetEdgeId === _scau._1
    } yield (_se2.streetEdgeId, _se2.geom, _se2.x1, _se2.y1, _se2.x1, _se2.y1, _se2.x2, _se2.y2, _se2.wayType, false, ucs._2.?.getOrElse(timestamp), _scau._2, _sep.priority, ucs._1.?.isDefined, ucs._3.?, ucs._4, ucs._5, _rs.routeStreetId.?)

    tasks.list.map(NewTask.tupled(_))
  }

  /**
   * Get the active audit_task for the given UserRoute. If there is none, create a new task and return it.
   *
   * @param currRoute
   * @param missionId
   * @return
   */
  def getRouteTask(currRoute: UserRoute, missionId: Int): Option[NewTask] = db.withSession { implicit session =>
    // Check if the user has started the route. If so, just return their in-progress task.
    val possibleTask: Option[NewTask] = (for {
      (currTaskId, currRouteStreetId) <- AuditTaskUserRouteTable.auditTaskUserRoutes
        .innerJoin(AuditTaskTable.auditTasks).on(_.auditTaskId === _.auditTaskId)
        .filter(x => x._1.userRouteId === currRoute.userRouteId && x._2.completed === false)
        .map(x => (x._1.auditTaskId, x._1.routeStreetId)).firstOption
    } yield AuditTaskTable.selectTaskFromTaskId(currTaskId, Some(currRouteStreetId))).flatten

    if (possibleTask.isDefined) {
      possibleTask
    } else {
      // If the route hasn't been started, get the next incomplete street in the route and create a new task for it.
      val streetsInRoute = RouteStreetTable.routeStreets
        .filter(_.routeId === currRoute.routeId)
        .innerJoin(StreetEdgeTable.streetEdgesWithoutDeleted).on(_.streetEdgeId === _.streetEdgeId)
        .map(_._2)

      // Get the next street in the route. This is the street with the lowest route_street_id that hasn't been audited.
      val userTasks = AuditTaskUserRouteTable.auditTaskUserRoutes.filter(_.userRouteId === currRoute.userRouteId)
      for {
        (nextStreetId, routeStreetId) <- RouteStreetTable.routeStreets
          .leftJoin(userTasks).on(_.routeStreetId === _.routeStreetId)
          .filter(x => x._1.routeId === currRoute.routeId && x._2.auditTaskUserRouteId.?.isEmpty)
          .sortBy(_._1.routeStreetId)
          .map(x => (x._1.streetEdgeId, x._1.routeStreetId)).firstOption
      } yield {
        // If the default direction of the street would cause the user to jump at the end of the street (i.e. the endpoint
        // of the street doesn't intersect with any street in the route besides itself), then reverse the street.
        val endPoint: Point = streetsInRoute.filter(_.streetEdgeId === nextStreetId).map(_.geom).first.getEndPoint
        endPoint.setSRID(4326)
        val endPointIntersects: Boolean = streetsInRoute
          .map(_.geom.intersects(endPoint.asColumnOf[Geometry])).filter(x => x).size.run > 1

        AuditTaskTable.selectANewTask(nextStreetId, missionId, !endPointIntersects, Some(routeStreetId))
      }
    }
  }

  /**
   * Check if the given user route has been finished based on the audit_task table. Mark as complete if so.
   *
   * @param userRouteId
   * @return
   */
  def updateCompleteness(userRouteId: Int): Boolean = db.withSession { implicit session =>
    // Get the completed audit_tasks that are a part of this user_route.
    val userAudits = AuditTaskUserRouteTable.auditTaskUserRoutes
      .innerJoin(AuditTaskTable.completedTasks).on(_.auditTaskId === _.auditTaskId)
      .filter(_._1.userRouteId === userRouteId)

    // Check if all streets in the route have a completed audit using an outer join. If so, mark as complete in db.
    val complete: Boolean = userRoutes
      .innerJoin(RouteStreetTable.routeStreets).on(_.routeId === _.routeId)
      .leftJoin(userAudits).on(_._2.routeStreetId === _._1.routeStreetId)
      .filter(x => x._1._1.userRouteId === userRouteId && x._2._2.auditTaskId.?.isEmpty).size.run == 0
    if (complete) {
      val q = for { ur <- userRoutes if ur.userRouteId === userRouteId } yield ur.completed
      q.update(complete)
    }
    complete
  }

  /**
   * Saves a new route.
   */
  def save(newUserRoute: UserRoute): UserRoute = db.withSession { implicit session =>
    (userRoutes returning userRoutes) += newUserRoute
  }
}
