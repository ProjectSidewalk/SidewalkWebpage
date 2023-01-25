package models.route

import models.audit.{AuditTask, AuditTaskTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class AuditTaskUserRoute(auditTaskUserRouteId: Int, userRouteId: Int, auditTaskId: Int)

class AuditTaskUserRouteTable(tag: slick.lifted.Tag) extends Table[AuditTaskUserRoute](tag, Some("sidewalk"), "route") {
  def auditTaskUserRouteId: Column[Int] = column[Int]("audit_task_user_route_id", O.PrimaryKey, O.AutoInc)
  def userRouteId: Column[Int] = column[Int]("user_route_id", O.NotNull)
  def auditTaskId: Column[Int] = column[Int]("audit_task_id", O.NotNull)

  def * = (auditTaskUserRouteId, userRouteId, auditTaskId) <> ((AuditTaskUserRoute.apply _).tupled, AuditTaskUserRoute.unapply)

  def userRoute: ForeignKeyQuery[UserRouteTable, UserRoute] = foreignKey("audit_task_user_route_user_route_id_fkey", userRouteId, TableQuery[UserRouteTable])(_.userRouteId)
  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] = foreignKey("audit_task_user_route_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)
}

/**
 * Data access object for the route table.
 */
object AuditTaskUserRouteTable {
  val db = play.api.db.slick.DB
  val auditTaskUserRoutes = TableQuery[AuditTaskUserRouteTable]

  /**
   * Saves a new route.
   */
  def save(newAuditTaskUserRoute: AuditTaskUserRoute): Int = db.withSession { implicit session =>
    auditTaskUserRoutes.insertOrUpdate(newAuditTaskUserRoute)
  }
}
