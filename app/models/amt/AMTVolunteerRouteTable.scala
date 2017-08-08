package models.amt

/**
  * Created by hmaddali on 8/6/17.
  */

import models.route.{Route, RouteTable}
import models.user.{UserRole, UserRoleTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery
import scala.language.postfixOps

case class AMTVolunteerRoute(amtVolunteerRouteId: Int, volunteerId: String, ipAddress:String, routeId: Int)

/**
  *
  */
class AMTVolunteerRouteTable(tag: Tag) extends Table[AMTVolunteerRoute](tag, Some("sidewalk"), "amt_volunteer_route") {
  def amtVolunteerRouteId = column[Int]("amt_volunteer_route_id", O.NotNull, O.PrimaryKey)
  def volunteerId = column[String]("volunteer_id", O.NotNull)
  def ipAddress = column[String]("ip_address", O.Nullable)
  def routeId = column[Int]("route_id", O.NotNull)

  def * = (amtVolunteerRouteId, volunteerId, ipAddress, routeId) <> ((AMTVolunteerRoute.apply _).tupled, AMTVolunteerRoute.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] =
    foreignKey("amt_volunteer_route_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)

}

/**
  * Data access object for the AMTVolunteerRoute table
  */
object AMTVolunteerRouteTable {
  val db = play.api.db.slick.DB
  val amtVolunteerRoutes = TableQuery[AMTVolunteerRouteTable]
  val amtAssignments = TableQuery[AMTAssignmentTable]

  def findRoutesByVolunteerId(volunteerId: String): List[Int] = db.withTransaction { implicit session =>
    val routeAsg = amtVolunteerRoutes.filter(_.volunteerId === volunteerId).map(_.routeId).list
    routeAsg
  }

  def assignRouteByConditionIdAndWorkerId(conditionId: Int, workerId: String): Option[Int] = db.withTransaction { implicit session =>
    // Find the first route in the list of routes associated with volunteerId (these are obtained using findRoutesByVolunteerId)
    // that hasnt been audited by workerId (this can be checked in the amt_assignment table)
    val volunteerId = AMTConditionTable.getVolunteerIdByConditionId(conditionId)
    val availableRoutes = findRoutesByVolunteerId(volunteerId)
    val auditedRoutes = amtAssignments.filter(_.turkerId === workerId).filter(_.completed).map(_.routeId).list.map(route => route.get)
    var assignedRoute = (availableRoutes diff auditedRoutes).headOption
    assignedRoute
  }

  def save(asg: AMTVolunteerRoute): Int = db.withTransaction { implicit session =>
    val asgId: Int =
      (amtVolunteerRoutes returning amtVolunteerRoutes.map(_.amtVolunteerRouteId)) += asg
    asgId
  }
}

