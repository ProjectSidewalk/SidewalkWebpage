package models.route

import models.audit.{AuditTaskTable, NewTask}
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.street.{StreetEdgePriorityTable, StreetEdgeTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.slick.lifted.ForeignKeyQuery

case class UserRoute(userRouteId: Int, routeId: Int, userId: String, completed: Boolean)

class UserRouteTable(tag: slick.lifted.Tag) extends Table[UserRoute](tag, Some("sidewalk"), "user_route") {
  def userRouteId: Column[Int] = column[Int]("user_route_id", O.PrimaryKey, O.AutoInc)
  def routeId: Column[Int] = column[Int]("route_id", O.NotNull)
  def userId: Column[String] = column[String]("user_id", O.NotNull)
  def completed: Column[Boolean] = column[Boolean]("completed", O.NotNull)

  def * = (userRouteId, routeId, userId, completed) <> ((UserRoute.apply _).tupled, UserRoute.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] = foreignKey("user_route_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)
  def user: ForeignKeyQuery[UserTable, DBUser] = foreignKey("user_route_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

/**
 * Data access object for the route table.
 */
object UserRouteTable {
  val db = play.api.db.slick.DB
  val userRoutes = TableQuery[UserRouteTable]

  def resumeOrCreateNewUserRoute(routeId: Int, userId: UUID, resumeRoute: Boolean): UserRoute = db.withSession { implicit session =>
    // If we are not resuming, create a new UserRoute.
    if (!resumeRoute) {
      save(UserRoute(0, routeId, userId.toString, false))
    } else {
      userRoutes
        .filter(ur => ur.routeId === routeId && ur.userId === userId.toString && !ur.completed)
        .sortBy(_.userRouteId.desc).firstOption
        .getOrElse(save(UserRoute(0, routeId, userId.toString, false)))
    }
  }

  def selectTasksInRoute(userRouteId: Int): List[NewTask] = db.withSession { implicit session =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

    val edgesInRoute = userRoutes
      .filter(_.userRouteId === userRouteId)
      .innerJoin(RouteStreetTable.routeStreets).on(_.routeId === _.routeId)
      .innerJoin(StreetEdgeTable.streetEdgesWithoutDeleted).on(_._2.streetEdgeId === _.streetEdgeId)
      .map(_._2)

    // Get street_edge_id, task_start, audit_task_id, current_mission_id, and current_mission_start for streets the user
    // has audited. If there are multiple for the same street, choose most recent (one w/ the highest audit_task_id).
    val userCompletedStreets = AuditTaskUserRouteTable.auditTaskUserRoutes
      .innerJoin(AuditTaskTable.completedTasks).on(_.auditTaskId === _.auditTaskId)
      .groupBy(_._2.streetEdgeId).map(_._2.map(_._2.auditTaskId).max)
      .innerJoin(AuditTaskTable.auditTasks).on(_ === _.auditTaskId)
      .map(t => (t._2.streetEdgeId, t._2.taskStart, t._2.auditTaskId, t._2.currentMissionId, t._2.currentMissionStart))

    val tasks = for {
      (ser, ucs) <- edgesInRoute.leftJoin(userCompletedStreets).on(_.streetEdgeId === _._1)
      se <- StreetEdgeTable.streetEdges if ser.streetEdgeId === se.streetEdgeId
      sep <- StreetEdgePriorityTable.streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
      scau <- AuditTaskTable.streetCompletedByAnyUser if sep.streetEdgeId === scau._1
    } yield (se.streetEdgeId, se.geom, se.x2, se.y2, se.x1, se.y1, se.x2, se.y2, false, ucs._2.?.getOrElse(timestamp), scau._2, sep.priority, ucs._1.?.isDefined, ucs._3.?, ucs._4, ucs._5)

    tasks.list.map(NewTask.tupled(_))
  }

  def getRouteTask(routeId: Int, userId: UUID, resumeRoute: Boolean, missionId: Int): Option[NewTask] = db.withSession { implicit session =>
    val currRoute: Option[UserRoute] = userRoutes
      .filter(ur => ur.routeId === routeId && ur.userId === userId.toString && !ur.completed)
      .sortBy(_.userRouteId.desc).firstOption

    if (!resumeRoute || currRoute.isEmpty) {
      save(UserRoute(0, routeId, userId.toString, false))
      val firstStreet: Option[Int] = RouteStreetTable.routeStreets.filter(rs => rs.routeId === routeId && rs.firstStreet).map(_.streetEdgeId).firstOption
      firstStreet.map(AuditTaskTable.selectANewTask(_, missionId))
    } else {
      val currTaskId: Option[Int] = AuditTaskUserRouteTable.auditTaskUserRoutes
        .innerJoin(AuditTaskTable.auditTasks).on(_.auditTaskId === _.auditTaskId)
        .filter(x => x._1.userRouteId === currRoute.get.userRouteId && x._2.completed === false)
        .map(_._1.auditTaskId).firstOption
      val possibleTask: Option[NewTask] = currTaskId.flatMap(AuditTaskTable.selectTaskFromTaskId)
      if (possibleTask.isDefined) {
        possibleTask
      } else {
        val userTasks = AuditTaskUserRouteTable.auditTaskUserRoutes.filter(_.userRouteId === currRoute.get.userRouteId)
        val nextStreetId: Option[Int] = RouteStreetTable.routeStreets
          .leftJoin(userTasks).on(_.routeStreetId === _.routeStreetId)
          .filter(x => x._1.routeId === routeId && x._2.auditTaskUserRouteId.?.isEmpty)
          .sortBy(_._1.routeStreetId)
          .map(_._1.streetEdgeId).firstOption
        nextStreetId.map(AuditTaskTable.selectANewTask(_, missionId))
      }
    }
  }

  /**
   * Saves a new route.
   */
  def save(newUserRoute: UserRoute): UserRoute = db.withSession { implicit session =>
    (userRoutes returning userRoutes) += newUserRoute
  }
}
