package models.route

import com.google.inject.ImplementedBy
import models.audit.AuditTaskTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class AuditTaskUserRoute(auditTaskUserRouteId: Int, userRouteId: Int, auditTaskId: Int, routeStreetId: Int)

class AuditTaskUserRouteTableDef(tag: slick.lifted.Tag)
    extends Table[AuditTaskUserRoute](tag, "audit_task_user_route") {
  def auditTaskUserRouteId: Rep[Int] = column[Int]("audit_task_user_route_id", O.PrimaryKey, O.AutoInc)
  def userRouteId: Rep[Int]          = column[Int]("user_route_id")
  def auditTaskId: Rep[Int]          = column[Int]("audit_task_id")
  def routeStreetId: Rep[Int]        = column[Int]("route_street_id")

  def * = (auditTaskUserRouteId, userRouteId, auditTaskId, routeStreetId) <> (
    (AuditTaskUserRoute.apply _).tupled,
    AuditTaskUserRoute.unapply
  )

  def userRoute =
    foreignKey("audit_task_user_route_user_route_id_fkey", userRouteId, TableQuery[UserRouteTableDef])(_.userRouteId)
  def auditTask =
    foreignKey("audit_task_user_route_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTableDef])(_.auditTaskId)
  def routeStreet =
    foreignKey("audit_task_user_route_route_street_id_fkey", routeStreetId, TableQuery[RouteStreetTableDef])(
      _.routeStreetId
    )
  def auditTaskUnique = index("audit_task_user_route_audit_task_id_key", auditTaskId, unique = true)
}

@ImplementedBy(classOf[AuditTaskUserRouteTable])
trait AuditTaskUserRouteTableRepository {}

@Singleton
class AuditTaskUserRouteTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    implicit val ec: ExecutionContext
) extends AuditTaskUserRouteTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val auditTaskUserRoutes = TableQuery[AuditTaskUserRouteTableDef]
  val userRoutes          = TableQuery[UserRouteTableDef]
  val routeStreets        = TableQuery[RouteStreetTableDef]
  val auditTasks          = TableQuery[AuditTaskTableDef]

  /**
   * Links an audit task to the route_street row it was served for, if it isn't linked already.
   *
   * @param userRouteId   The route walk the task belongs to.
   * @param auditTaskId   The audit task being submitted.
   * @param routeStreetId The route_street row the task was served for, as carried through the submission.
   *                      Honored only if it really belongs to this walk's route; otherwise (and when absent, e.g.
   *                      a client running cached JS from before the field existed) the row is resolved by street.
   * @return              True if a new link was created.
   */
  def insertIfNew(userRouteId: Int, auditTaskId: Int, routeStreetId: Option[Int]): DBIO[Boolean] = {
    auditTaskUserRoutes
      .filter(x => x.userRouteId === userRouteId && x.auditTaskId === auditTaskId)
      .exists
      .result
      .flatMap {
        case true  => DBIO.successful(false) // Entry exists, nothing new inserted.
        case false =>
          val streetsInRoute = userRoutes
            .join(routeStreets)
            .on(_.routeId === _.routeId)
            .filter(_._1.userRouteId === userRouteId)
            .map(_._2)
          // Rows this walk has already linked. Excluding them keeps the fallback from handing every traversal of
          // a repeated street the same row, which would leave the later ones unlinked and the route never
          // completing.
          val linked = auditTaskUserRoutes.filter(_.userRouteId === userRouteId).map(_.routeStreetId)

          val submitted: DBIO[Option[Int]] = routeStreetId match {
            case Some(id) => streetsInRoute.filter(_.routeStreetId === id).map(_.routeStreetId).result.headOption
            case None     => DBIO.successful(None)
          }
          submitted.flatMap { verified =>
            val resolved: DBIO[Option[Int]] = verified match {
              case some @ Some(_) => DBIO.successful(some)
              case None           =>
                auditTasks
                  .filter(_.auditTaskId === auditTaskId)
                  .join(streetsInRoute.filterNot(_.routeStreetId in linked))
                  .on(_.streetEdgeId === _.streetEdgeId)
                  .sortBy(_._2.position)
                  .map(_._2.routeStreetId)
                  .result
                  .headOption
            }
            resolved.flatMap {
              case Some(id) => insert(AuditTaskUserRoute(0, userRouteId, auditTaskId, id)).map(_ => true)
              case None     => DBIO.successful(false) // The task isn't on a street this route still contains.
            }
          }
      }
      .transactionally
  }

  def insert(newAuditTaskUserRoute: AuditTaskUserRoute): DBIO[Int] = {
    (auditTaskUserRoutes returning auditTaskUserRoutes.map(_.auditTaskId)) += newAuditTaskUserRoute
  }

  /**
   * Deletes the progress links for the given route streets. Used when a route edit removes streets: the links
   * FK-reference route_street, and route-completion progress only makes sense for streets the route contains.
   * The audit tasks themselves (and their labels) are untouched.
   */
  def deleteForRouteStreets(routeStreetIds: Seq[Int]): DBIO[Int] = {
    auditTaskUserRoutes.filter(_.routeStreetId inSet routeStreetIds).delete
  }
}
