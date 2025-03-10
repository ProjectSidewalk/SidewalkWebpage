package models.route

import com.google.inject.ImplementedBy
import models.audit.{AuditTaskTable, AuditTaskTableDef, NewTask}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class UserRoute(userRouteId: Int, routeId: Int, userId: String, completed: Boolean, discarded: Boolean)

class UserRouteTableDef(tag: slick.lifted.Tag) extends Table[UserRoute](tag, "user_route") {
  def userRouteId: Rep[Int] = column[Int]("user_route_id", O.PrimaryKey, O.AutoInc)
  def routeId: Rep[Int] = column[Int]("route_id")
  def userId: Rep[String] = column[String]("user_id")
  def completed: Rep[Boolean] = column[Boolean]("completed")
  def discarded: Rep[Boolean] = column[Boolean]("discarded")

  def * = (userRouteId, routeId, userId, completed, discarded) <> ((UserRoute.apply _).tupled, UserRoute.unapply)

//  def route: ForeignKeyQuery[RouteTable, Route] = foreignKey("user_route_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)
//  def user: ForeignKeyQuery[UserTable, DBUser] = foreignKey("user_route_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

@ImplementedBy(classOf[UserRouteTable])
trait UserRouteTableRepository {
  def insert(newUserRoute: UserRoute): DBIO[UserRoute]
}

@Singleton
class UserRouteTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                               auditTaskTable: AuditTaskTable,
                               implicit val ec: ExecutionContext
                              ) extends UserRouteTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  val userRoutes = TableQuery[UserRouteTableDef]
  val routeStreets = TableQuery[RouteStreetTableDef]
  val auditTaskUserRoutes = TableQuery[AuditTaskUserRouteTableDef]
  val auditTasks = TableQuery[AuditTaskTableDef]
  val completedTasks = auditTasks.filter(_.completed)

  val activeRoutes = userRoutes.filter(ur => !ur.completed && !ur.discarded)

  def getInProgressRoute(userId: String): DBIO[Option[UserRoute]] = {
    activeRoutes.filter(_.userId === userId).result.headOption
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

  def getActiveRouteOrCreateNew(routeId: Int, userId: String): DBIO[UserRoute] = {
    activeRoutes.filter(ar => ar.routeId === routeId && ar.userId === userId).result.headOption.flatMap {
      case Some(ur) => DBIO.successful(ur)
      case None => insert(UserRoute(0, routeId, userId, completed = false, discarded = false))
    }
  }

//  def selectTasksInRoute(userRouteId: Int): List[NewTask] = db.withSession { implicit session =>
//    val timestamp: OffsetDateTime = OffsetDateTime.now
//
//    val edgesInRoute = userRoutes
//      .filter(_.userRouteId === userRouteId)
//      .innerJoin(RouteStreetTable.routeStreets).on(_.routeId === _.routeId)
//      .innerJoin(StreetEdgeTable.streetEdgesWithoutDeleted).on(_._2.streetEdgeId === _.streetEdgeId)
//      .map{ case ((_userRoute, _routeStreet), _streetEdge) => (_streetEdge, _routeStreet) }
//
//    // Get street_edge_id, task_start, audit_task_id, current_mission_id, and current_mission_start for streets the user
//    // has audited. If there are multiple for the same street, choose most recent (one w/ the highest audit_task_id).
//    val userCompletedStreets = AuditTaskUserRouteTable.auditTaskUserRoutes
//      .filter(_.userRouteId === userRouteId)
//      .innerJoin(AuditTaskTable.completedTasks).on(_.auditTaskId === _.auditTaskId)
//      .groupBy(_._2.streetEdgeId).map(_._2.map(_._2.auditTaskId).max)
//      .innerJoin(AuditTaskTable.auditTasks).on(_ === _.auditTaskId)
//      .map(t => (t._2.streetEdgeId, t._2.taskStart, t._2.auditTaskId, t._2.currentMissionId, t._2.currentMissionStart))
//
//    val tasks = for {
//      ((_se1, _rs), ucs) <- edgesInRoute.leftJoin(userCompletedStreets).on(_._1.streetEdgeId === _._1)
//      _se2 <- StreetEdgeTable.streetEdges if _se1.streetEdgeId === _se2.streetEdgeId
//      _sep <- StreetEdgePriorityTable.streetEdgePriorities if _se2.streetEdgeId === _sep.streetEdgeId
//      _scau <- AuditTaskTable.streetCompletedByAnyUser if _sep.streetEdgeId === _scau._1
//    } yield (_se2.streetEdgeId, _se2.geom, _se2.x1, _se2.y1, _se2.wayType, _rs.reverse, ucs._2.?.getOrElse(timestamp), _scau._2, _sep.priority, ucs._1.?.isDefined, ucs._3.?, ucs._4, ucs._5, _rs.routeStreetId.?)
//
//    tasks.list.map(NewTask.tupled(_))
//  }

  /**
   * Get the active audit_task for the given UserRoute. If there is none, create a new task and return it.
   * TODO this isn't a simple CRUD operation, so it should probably go in a Service file.
   *
   * @param currRoute
   * @param missionId
   * @return
   */
  def getRouteTask(currRoute: UserRoute, missionId: Int): DBIO[Option[NewTask]] = {
    val possibleTask: DBIO[Option[NewTask]] = auditTaskUserRoutes
      .join(auditTasks).on(_.auditTaskId === _.auditTaskId)
      .filter(x => !x._2.completed && x._1.userRouteId === currRoute.userRouteId.bind)
      .map(x => (x._1.auditTaskId, x._1.routeStreetId)).result.headOption.flatMap {
        case Some((currTaskId, currRouteStreetId)) =>
          auditTaskTable.selectTaskFromTaskId(currTaskId, Some(currRouteStreetId))
      }

    possibleTask.flatMap {
      case Some(task) => DBIO.successful(Some(task))
      case None =>
        // Get the next street in the route. This is the street with the lowest route_street_id that hasn't been audited.
        val userTasks = auditTaskUserRoutes.filter(_.userRouteId === currRoute.userRouteId)
        routeStreets
          .joinLeft(userTasks).on(_.routeStreetId === _.routeStreetId)
          .filter(x => x._1.routeId === currRoute.routeId && x._2.isEmpty)
          .sortBy(_._1.routeStreetId)
          .map(x => (x._1.streetEdgeId, x._1.routeStreetId, x._1.reverse))
          .result.headOption.flatMap {
            case Some((nextStreetId, routeStreetId, reversed)) =>
              auditTaskTable.selectANewTask(nextStreetId, missionId, reversed, Some(routeStreetId)).map(Some(_))
        }
    }
  }

  /**
   * Check if the given user route has been finished based on the audit_task table. Mark as complete if so.
   *
   * @param userRouteId
   * @return
   */
  def updateCompleteness(userRouteId: Int): DBIO[Boolean] = {
    // Get the completed audit_tasks that are a part of this user_route.
    val userAudits = auditTaskUserRoutes
      .join(completedTasks).on(_.auditTaskId === _.auditTaskId)
      .filter(_._1.userRouteId === userRouteId)

    // Check if all streets in the route have a completed audit using an outer join. If so, mark as complete in db.
    userRoutes
      .join(routeStreets).on(_.routeId === _.routeId)
      .joinLeft(userAudits).on(_._2.routeStreetId === _._1.routeStreetId)
      .filter(x => x._1._1.userRouteId === userRouteId && x._2.isEmpty).exists.result
      .flatMap {
        case true => userRoutes.filter(_.userRouteId === userRouteId).map(_.completed).update(true).map(_ => true)
        case false => DBIO.successful(false)
      }
  }

  def insert(newUserRoute: UserRoute): DBIO[UserRoute] = {
    (userRoutes returning userRoutes) += newUserRoute
  }
}
