package models.route

import com.google.inject.ImplementedBy
import models.audit.AuditTaskTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

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
class AuditTaskUserRouteTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider, implicit val ec: ExecutionContext) extends AuditTaskUserRouteTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val auditTaskUserRoutes = TableQuery[AuditTaskUserRouteTableDef]
  val userRoutes = TableQuery[UserRouteTableDef]
  val routeStreets = TableQuery[RouteStreetTableDef]
  val auditTasks = TableQuery[AuditTaskTableDef]

  /**
   * Adds a new entry if one doesn't exist. Returns true if a new entry was created.
   */
  def insertIfNew(userRouteId: Int, auditTaskId: Int): DBIO[Boolean] = {
    auditTaskUserRoutes.filter(x => x.userRouteId === userRouteId && x.auditTaskId === auditTaskId).exists.result.flatMap {
      case true => DBIO.successful(false) // Entry exists, nothing new inserted.
      case false =>
        val streetsInRoute = userRoutes
          .join(routeStreets).on(_.routeId === _.routeId)
          .filter(_._1.userRouteId === userRouteId)
          .map(_._2)
        for {
          routeStreetId: Int <- auditTasks.filter(_.auditTaskId === auditTaskId)
            .join(streetsInRoute).on(_.streetEdgeId === _.streetEdgeId)
            .map(_._2.routeStreetId).result.head
          _ <- insert(AuditTaskUserRoute(0, userRouteId, auditTaskId, routeStreetId))
        } yield {
          true
        }
    }.transactionally
  }

  def insert(newAuditTaskUserRoute: AuditTaskUserRoute): DBIO[Int] = {
    (auditTaskUserRoutes returning auditTaskUserRoutes.map(_.auditTaskId)) += newAuditTaskUserRoute
  }
}
