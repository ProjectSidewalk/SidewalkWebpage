package models.route

import com.google.inject.ImplementedBy
import models.audit.{AuditTaskTable, AuditTaskTableDef, NewTask}
import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class UserRoute(
    userRouteId: Int,
    routeId: Int,
    userId: String,
    completed: Boolean,
    discarded: Boolean,
    paused: Boolean = false
)

class UserRouteTableDef(tag: slick.lifted.Tag) extends Table[UserRoute](tag, "user_route") {
  def userRouteId: Rep[Int]   = column[Int]("user_route_id", O.PrimaryKey, O.AutoInc)
  def routeId: Rep[Int]       = column[Int]("route_id")
  def userId: Rep[String]     = column[String]("user_id")
  def completed: Rep[Boolean] = column[Boolean]("completed")
  def discarded: Rep[Boolean] = column[Boolean]("discarded")
  def paused: Rep[Boolean]    = column[Boolean]("paused", O.Default(false))

  def * =
    (userRouteId, routeId, userId, completed, discarded, paused) <> ((UserRoute.apply _).tupled, UserRoute.unapply)

  def route = foreignKey("user_route_route_id_fkey", routeId, TableQuery[RouteTableDef])(_.routeId)
  def user  = foreignKey("user_route_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
}

@ImplementedBy(classOf[UserRouteTable])
trait UserRouteTableRepository {}

@Singleton
class UserRouteTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    auditTaskTable: AuditTaskTable,
    implicit val ec: ExecutionContext
) extends UserRouteTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val userRoutes          = TableQuery[UserRouteTableDef]
  val routes              = TableQuery[RouteTableDef]
  val routeStreets        = TableQuery[RouteStreetTableDef]
  val auditTaskUserRoutes = TableQuery[AuditTaskUserRouteTableDef]
  val auditTasks          = TableQuery[AuditTaskTableDef]
  val completedTasks      = auditTasks.filter(_.completed)
  val activeRoutes        = userRoutes.filter(ur => !ur.completed && !ur.discarded)

  /**
   * The user's in-progress route walk, if any — the walk that a bare /explore visit silently resumes.
   *
   * Paused walks are excluded: the user exited that route, so it only resumes on an explicit ?routeId= visit
   * (getActiveRouteOrCreateNew), never silently (#4833).
   *
   * Routes soft-deleted by their owner are excluded. A shared route can be deleted while someone else is partway
   * through it, and resuming one builds an inconsistent session — the mission is route-scoped off the user_route
   * while the task is not, because getRoute filters deleted routes — leaving the user unable to progress or to
   * fall back to normal exploration.
   */
  def getInProgressRoute(userId: String): DBIO[Option[UserRoute]] = {
    activeRoutes
      .filter(ur => ur.userId === userId && !ur.paused)
      .join(routes.filter(!_.deleted))
      .on(_.routeId === _.routeId)
      .map(_._1)
      .result
      .headOption
  }

  def discardAllActiveRoutes(userId: String): DBIO[Int] = {
    activeRoutes.filter(_.userId === userId).map(_.discarded).update(true)
  }

  /**
   * Discard any active routes for the given user that doesn't match the given routeId.
   */
  def discardOtherActiveRoutes(routeId: Int, userId: String): DBIO[Int] = {
    activeRoutes.filter(x => x.routeId =!= routeId && x.userId === userId).map(_.discarded).update(true)
  }

  /**
   * Pause all of the user's active route walks. Unlike discarding, a paused walk keeps its progress and resumes
   * where it left off when the user explicitly re-enters the route via ?routeId= (#4833).
   */
  def pauseAllActiveRoutes(userId: String): DBIO[Int] = {
    activeRoutes.filter(_.userId === userId).map(_.paused).update(true)
  }

  /**
   * Pause any active route walks for the given user that don't match the given routeId.
   */
  def pauseOtherActiveRoutes(routeId: Int, userId: String): DBIO[Int] = {
    activeRoutes.filter(x => x.routeId =!= routeId && x.userId === userId).map(_.paused).update(true)
  }

  /**
   * The user's active walk of the given route (un-pausing it if they had exited), or a brand new walk of it.
   */
  def getActiveRouteOrCreateNew(routeId: Int, userId: String): DBIO[UserRoute] = {
    activeRoutes.filter(ar => ar.routeId === routeId && ar.userId === userId).result.headOption.flatMap {
      case Some(ur) if ur.paused =>
        userRoutes
          .filter(_.userRouteId === ur.userRouteId)
          .map(_.paused)
          .update(false)
          .map(_ => ur.copy(paused = false))
      case Some(ur) => DBIO.successful(ur)
      case None     => insert(UserRoute(0, routeId, userId, completed = false, discarded = false))
    }
  }

  /**
   * Get the active audit_task for the given UserRoute. If there is none, create a new task and return it.
   * TODO this isn't a simple CRUD operation, so it should probably go in a Service file.
   *
   * @param currRoute
   * @param missionId
   */
  def getRouteTask(currRoute: UserRoute, missionId: Int): DBIO[Option[NewTask]] = {
    val possibleTask: DBIO[Option[NewTask]] = auditTaskTable
      .resumableRouteTask(currRoute.userRouteId)
      .flatMap {
        case Some((currTaskId, currRouteStreetId, currPosition)) =>
          auditTaskTable.selectTaskFromTaskId(currTaskId, Some(currRouteStreetId), Some(currPosition))
        case None => DBIO.successful(None)
      }

    possibleTask.flatMap {
      case Some(task) => DBIO.successful(Some(task))
      case None       =>
        // Get the next street in the route: the earliest street in walking order that hasn't been audited.
        val userTasks = auditTaskUserRoutes.filter(_.userRouteId === currRoute.userRouteId)
        routeStreets
          .joinLeft(userTasks)
          .on(_.routeStreetId === _.routeStreetId)
          .filter(x => x._1.routeId === currRoute.routeId && x._2.isEmpty)
          .sortBy(_._1.position)
          .map(x => (x._1.streetEdgeId, x._1.routeStreetId, x._1.reverse, x._1.position))
          .result
          .headOption
          .flatMap {
            case Some((nextStreetId, routeStreetId, reversed, position)) =>
              auditTaskTable
                .selectANewTask(nextStreetId, missionId, reversed, Some(routeStreetId), Some(position))
                .map(Some(_))
            case None => DBIO.successful(None)
          }
    }
  }

  /**
   * Check if the given user route has been finished based on the audit_task table. Mark as complete if so.
   *
   * A street the labeler reported as imagery-less during this walk counts as done. It stays incomplete on purpose
   * (#4922), so requiring a completed audit for every street would leave the walk active forever: the route is
   * resumed ahead of any region assignment, and with nothing left to hand out the labeler gets the finished-region
   * overlay on every visit instead of new work (#5008).
   *
   * @param userRouteId
   */
  def updateCompleteness(userRouteId: Int): DBIO[Boolean] = {
    // Get the completed audit_tasks that are a part of this user_route.
    val userAudits = auditTaskUserRoutes
      .join(completedTasks)
      .on(_.auditTaskId === _.auditTaskId)
      .filter(_._1.userRouteId === userRouteId)
    val reportedStreets = auditTaskTable.streetsReportedNoImageryDuringRoute(userRouteId)

    // Check if all streets in the route have a completed audit using an outer join. If so, mark as complete in db.
    userRoutes
      .join(routeStreets)
      .on(_.routeId === _.routeId)
      .joinLeft(userAudits)
      .on(_._2.routeStreetId === _._1.routeStreetId)
      .filter(x => x._1._1.userRouteId === userRouteId && x._2.isEmpty && !(x._1._2.streetEdgeId in reportedStreets))
      .exists
      .result
      .flatMap {
        case true  => DBIO.successful(false)
        case false => userRoutes.filter(_.userRouteId === userRouteId).map(_.completed).update(true).map(_ => true)
      }
  }

  def insert(newUserRoute: UserRoute): DBIO[UserRoute] = {
    (userRoutes returning userRoutes) += newUserRoute
  }
}
