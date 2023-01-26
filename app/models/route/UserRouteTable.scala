package models.route

import models.audit.{AuditTaskTable, NewTask}
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
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

  def getRouteTask(routeId: Int, userId: UUID, resumeRoute: Boolean, missionId: Int): Option[NewTask] = db.withSession { implicit session =>
    val existingUserRoute: Option[UserRoute] = userRoutes
      .filter(ur => ur.routeId === routeId && ur.userId === userId.toString && !ur.completed)
      .sortBy(_.userRouteId.desc).firstOption
    if (!resumeRoute || existingUserRoute.isEmpty) {
      save(UserRoute(0, routeId, userId.toString, false))
      val firstStreet: Option[Int] = RouteStreetTable.routeStreets.filter(rs => rs.routeId === routeId && rs.firstStreet).map(_.streetEdgeId).firstOption
      firstStreet.map(AuditTaskTable.selectANewTask(_, missionId))
    } else {
      val currTaskId: Option[Int] = AuditTaskUserRouteTable.auditTaskUserRoutes
        .innerJoin(AuditTaskTable.auditTasks).on(_.auditTaskId === _.auditTaskId)
        .filter(x => x._1.userRouteId === existingUserRoute.get.userRouteId && x._2.completed === false)
        .map(_._1.auditTaskId).firstOption
      val possibleTask: Option[NewTask] = currTaskId.flatMap(AuditTaskTable.selectTaskFromTaskId(_))
      if (possibleTask.isDefined) {
        possibleTask
      } else {
        val nextStreetId: Option[Int] = RouteStreetTable.routeStreets
          .leftJoin(AuditTaskUserRouteTable.auditTaskUserRoutes).on(_.routeStreetId === _.routeStreetId)
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
  def save(newUserRoute: UserRoute): Int = db.withSession { implicit session =>
    userRoutes.insertOrUpdate(newUserRoute)
  }
}
