package models.route

import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class AuditTaskUserRoute(auditTaskUserRouteId: Int, userRouteId: Int, auditTaskId: Int, routeStreetId: Int)

class AuditTaskUserRouteTableDef(tag: slick.lifted.Tag) extends Table[AuditTaskUserRoute](tag, "audit_task_user_route") {
  def auditTaskUserRouteId: Rep[Int] = column[Int]("audit_task_user_route_id", O.PrimaryKey, O.AutoInc)
  def userRouteId: Rep[Int] = column[Int]("user_route_id")
  def auditTaskId: Rep[Int] = column[Int]("audit_task_id")
  def routeStreetId: Rep[Int] = column[Int]("route_street_id")

  def * = (auditTaskUserRouteId, userRouteId, auditTaskId, routeStreetId) <> ((AuditTaskUserRoute.apply _).tupled, AuditTaskUserRoute.unapply)

//  def userRoute: ForeignKeyQuery[UserRouteTable, UserRoute] = foreignKey("audit_task_user_route_user_route_id_fkey", userRouteId, TableQuery[UserRouteTable])(_.userRouteId)
//  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] = foreignKey("audit_task_user_route_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)
//  def routeStreet: ForeignKeyQuery[RouteStreetTable, RouteStreet] = foreignKey("audit_task_user_route_route_street_id_fkey", routeStreetId, TableQuery[RouteStreetTable])(_.routeStreetId)
}

@ImplementedBy(classOf[AuditTaskUserRouteTable])
trait AuditTaskUserRouteTableRepository {
}

@Singleton
class AuditTaskUserRouteTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends AuditTaskUserRouteTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val auditTaskUserRoutes = TableQuery[AuditTaskUserRouteTableDef]

  /**
   * Adds a new entry if one doesn't exist. Returns true of a new entry was created.
   */
//  def insertIfNew(userRouteId: Int, auditTaskId: Int): Boolean = db.withSession { implicit session =>
//    val entryExists = auditTaskUserRoutes.filter(x => x.userRouteId === userRouteId && x.auditTaskId === auditTaskId).size.run > 0
//    if (entryExists) {
//      false
//    } else {
//      val streetsInRoute = UserRouteTable.userRoutes
//        .innerJoin(RouteStreetTable.routeStreets).on(_.routeId === _.routeId)
//        .filter(_._1.userRouteId === userRouteId)
//        .map(_._2)
//      val routeStreetId: Int = AuditTaskTable.auditTasks
//        .filter(_.auditTaskId === auditTaskId)
//        .innerJoin(streetsInRoute).on(_.streetEdgeId === _.streetEdgeId)
//        .map(_._2.routeStreetId).first
//      save(AuditTaskUserRoute(0, userRouteId, auditTaskId, routeStreetId))
//      true
//    }
//  }

  /**
   * Saves a new route.
   */
//  def save(newAuditTaskUserRoute: AuditTaskUserRoute): Int = db.withSession { implicit session =>
//    auditTaskUserRoutes.insertOrUpdate(newAuditTaskUserRoute)
//  }
}
