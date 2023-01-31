package models.route

import models.audit.{AuditTask, AuditTaskTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class AuditTaskUserRoute(auditTaskUserRouteId: Int, userRouteId: Int, auditTaskId: Int, routeStreetId: Int)

class AuditTaskUserRouteTable(tag: slick.lifted.Tag) extends Table[AuditTaskUserRoute](tag, Some("sidewalk"), "audit_task_user_route") {
  def auditTaskUserRouteId: Column[Int] = column[Int]("audit_task_user_route_id", O.PrimaryKey, O.AutoInc)
  def userRouteId: Column[Int] = column[Int]("user_route_id", O.NotNull)
  def auditTaskId: Column[Int] = column[Int]("audit_task_id", O.NotNull)
  def routeStreetId: Column[Int] = column[Int]("route_street_id", O.NotNull)

  def * = (auditTaskUserRouteId, userRouteId, auditTaskId, routeStreetId) <> ((AuditTaskUserRoute.apply _).tupled, AuditTaskUserRoute.unapply)

  def userRoute: ForeignKeyQuery[UserRouteTable, UserRoute] = foreignKey("audit_task_user_route_user_route_id_fkey", userRouteId, TableQuery[UserRouteTable])(_.userRouteId)
  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] = foreignKey("audit_task_user_route_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)
  def routeStreet: ForeignKeyQuery[RouteStreetTable, RouteStreet] = foreignKey("audit_task_user_route_route_street_id_fkey", routeStreetId, TableQuery[RouteStreetTable])(_.routeStreetId)
}

/**
 * Data access object for the route table.
 */
object AuditTaskUserRouteTable {
  val db = play.api.db.slick.DB
  val auditTaskUserRoutes = TableQuery[AuditTaskUserRouteTable]

  /**
   * Adds a new entry if one doesn't exist. Returns true of a new entry was created.
   */
  def insertIfNew(userRouteId: Int, auditTaskId: Int): Boolean = db.withSession { implicit session =>
    val entryExists = auditTaskUserRoutes.filter(x => x.userRouteId === userRouteId && x.auditTaskId === auditTaskId).size.run > 0
    if (entryExists) {
      false
    } else {
      val streetsInRoute = UserRouteTable.userRoutes
        .innerJoin(RouteStreetTable.routeStreets).on(_.routeId === _.routeId)
        .filter(_._1.userRouteId === userRouteId)
        .map(_._2)
      val routeStreetId: Int = AuditTaskTable.auditTasks
        .filter(_.auditTaskId === auditTaskId)
        .innerJoin(streetsInRoute).on(_.streetEdgeId === _.streetEdgeId)
        .map(_._2.routeStreetId).first
      save(AuditTaskUserRoute(0, userRouteId, auditTaskId, routeStreetId))
      true
    }
  }

  /**
   * Saves a new route.
   */
  def save(newAuditTaskUserRoute: AuditTaskUserRoute): Int = db.withSession { implicit session =>
    auditTaskUserRoutes.insertOrUpdate(newAuditTaskUserRoute)
  }
}
