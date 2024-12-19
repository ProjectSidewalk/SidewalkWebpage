package models.route

import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

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
  def insert(newUserRoute: UserRoute): DBIO[Int]
}

@Singleton
class UserRouteTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends UserRouteTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._

  val userRoutes = TableQuery[UserRouteTableDef]
  val activeRoutes = userRoutes.filter(ur => !ur.completed && !ur.discarded)

//  def setUpPossibleUserRoute(routeId: Option[Int], userId: UUID, resumeRoute: Boolean): Option[UserRoute] = db.withSession { implicit session =>
//    // Check if the route exists and hasn't been deleted.
//    val routeExists: Boolean = routeId.flatMap(RouteTable.getRoute(_)).isDefined
//
//    (routeExists, routeId, resumeRoute) match {
//      case (true, Some(rId), true) =>
//        // Discard routes that don't match routeId, resume route with given routeId if it exists, o/w make a new one.
//        activeRoutes.filter(x => x.routeId =!= rId && x.userId === userId.toString).map(_.discarded).update(true)
//
//        Some(activeRoutes
//          .filter(ur => ur.routeId === rId && ur.userId === userId.toString)
//          .firstOption.getOrElse(save(UserRoute(0, rId, userId.toString, completed = false, discarded = false))))
//      case (true, Some(rId), false) =>
//        // Discard old routes, save a new one with given routeId.
//        activeRoutes.filter(_.userId === userId.toString).map(_.discarded).update(true)
//        Some(save(UserRoute(0, rId, userId.toString, completed = false, discarded = false)))
//      case (_, None, true) =>
//        // Get an in progress route (with any routeId) if it exists, otherwise return None.
//        activeRoutes.filter(_.userId === userId.toString).firstOption
//      case (_, _, _) =>
//        // Discard old routes, return None.
//        activeRoutes.filter(_.userId === userId.toString).map(_.discarded).update(true)
//        None
//    }
//  }
//
//  def selectTasksInRoute(userRouteId: Int): List[NewTask] = db.withSession { implicit session =>
//    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
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
//
//  /**
//   * Get the active audit_task for the given UserRoute. If there is none, create a new task and return it.
//   *
//   * @param currRoute
//   * @param missionId
//   * @return
//   */
//  def getRouteTask(currRoute: UserRoute, missionId: Int): Option[NewTask] = db.withSession { implicit session =>
//    // Check if the user has started the route. If so, just return their in-progress task.
//    val possibleTask: Option[NewTask] = (for {
//      (currTaskId, currRouteStreetId) <- AuditTaskUserRouteTable.auditTaskUserRoutes
//        .innerJoin(AuditTaskTable.auditTasks).on(_.auditTaskId === _.auditTaskId)
//        .filter(x => x._1.userRouteId === currRoute.userRouteId && x._2.completed === false)
//        .map(x => (x._1.auditTaskId, x._1.routeStreetId)).firstOption
//    } yield AuditTaskTable.selectTaskFromTaskId(currTaskId, Some(currRouteStreetId))).flatten
//
//    if (possibleTask.isDefined) {
//      possibleTask
//    } else {
//      // Get the next street in the route. This is the street with the lowest route_street_id that hasn't been audited.
//      val userTasks = AuditTaskUserRouteTable.auditTaskUserRoutes.filter(_.userRouteId === currRoute.userRouteId)
//      for {
//        (nextStreetId, routeStreetId, reversed) <- RouteStreetTable.routeStreets
//          .leftJoin(userTasks).on(_.routeStreetId === _.routeStreetId)
//          .filter(x => x._1.routeId === currRoute.routeId && x._2.auditTaskUserRouteId.?.isEmpty)
//          .sortBy(_._1.routeStreetId)
//          .map(x => (x._1.streetEdgeId, x._1.routeStreetId, x._1.reverse)).firstOption
//      } yield {
//        AuditTaskTable.selectANewTask(nextStreetId, missionId, reversed, Some(routeStreetId))
//      }
//    }
//  }
//
//  /**
//   * Check if the given user route has been finished based on the audit_task table. Mark as complete if so.
//   *
//   * @param userRouteId
//   * @return
//   */
//  def updateCompleteness(userRouteId: Int): Boolean = db.withSession { implicit session =>
//    // Get the completed audit_tasks that are a part of this user_route.
//    val userAudits = AuditTaskUserRouteTable.auditTaskUserRoutes
//      .innerJoin(AuditTaskTable.completedTasks).on(_.auditTaskId === _.auditTaskId)
//      .filter(_._1.userRouteId === userRouteId)
//
//    // Check if all streets in the route have a completed audit using an outer join. If so, mark as complete in db.
//    val complete: Boolean = userRoutes
//      .innerJoin(RouteStreetTable.routeStreets).on(_.routeId === _.routeId)
//      .leftJoin(userAudits).on(_._2.routeStreetId === _._1.routeStreetId)
//      .filter(x => x._1._1.userRouteId === userRouteId && x._2._2.auditTaskId.?.isEmpty).size.run == 0
//    if (complete) {
//      val q = for { ur <- userRoutes if ur.userRouteId === userRouteId } yield ur.completed
//      q.update(complete)
//    }
//    complete
//  }

  def insert(newUserRoute: UserRoute): DBIO[Int] = {
    (userRoutes returning userRoutes.map(_.userRouteId)) += newUserRoute
  }
}
