package models.amt

/**
  * Created by manaswi on 5/5/17.
  */

import models.route.{Route, RouteTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class AMTRouteAssignment(routeAssignmentId: Int, hitId: String, routeId: Int, assignmentCount: Int)

/**
  *
  */
class AMTRouteAssignmentTable(tag: Tag) extends Table[AMTRouteAssignment](tag, Some("sidewalk"), "amt_route_assignment") {
  def routeAssignmentId = column[Int]("amt_route_assignment_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def hitId = column[String]("hit_id", O.NotNull)
  def routeId = column[Int]("route_id", O.NotNull)
  def assignmentCount = column[Int]("assignment_count", O.NotNull)

  def * = (routeAssignmentId, hitId, routeId, assignmentCount) <> ((AMTRouteAssignment.apply _).tupled, AMTRouteAssignment.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] =
    foreignKey("amt_route_assignment_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)

  }

/**
  * Data access object for the AMTRouteAssignment table
  */
object AMTRouteAssignmentTable {
  val db = play.api.db.slick.DB
  val amtAssignments = TableQuery[AMTRouteAssignmentTable]

  def save(asg: AMTRouteAssignment): Int = db.withTransaction { implicit session =>
    val asgId: Int =
      (amtAssignments returning amtAssignments.map(_.routeAssignmentId)) += asg
    asgId
  }
}

