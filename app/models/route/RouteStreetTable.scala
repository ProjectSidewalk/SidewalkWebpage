package models.route

import models.street.{StreetEdge, StreetEdgeTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class RouteStreet(routeStreetId: Int, routeId: Int, streetEdgeId: Int, firstStreet: Boolean)

class RouteStreetTable(tag: slick.lifted.Tag) extends Table[RouteStreet](tag, Some("sidewalk"), "route_street") {
  def routeStreetId: Column[Int] = column[Int]("route_street_id", O.PrimaryKey, O.AutoInc)
  def routeId: Column[Int] = column[Int]("route_id", O.NotNull)
  def streetEdgeId: Column[Int] = column[Int]("street_edge_id", O.NotNull)
  def firstStreet: Column[Boolean] = column[Boolean]("first_street", O.NotNull)

  def * = (routeStreetId, routeId, streetEdgeId, firstStreet) <> ((RouteStreet.apply _).tupled, RouteStreet.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] = foreignKey("route_street_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)
  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] = foreignKey("route_street_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTable])(_.streetEdgeId)
}

/**
 * Data access object for the route table.
 */
object RouteStreetTable {
  val db = play.api.db.slick.DB
  val routeStreets = TableQuery[RouteStreetTable]

  /**
   * Saves a new route_street.
   */
  def save(newRouteStreet: RouteStreet): Int = db.withSession { implicit session =>
    (routeStreets returning routeStreets.map(_.routeStreetId)) += newRouteStreet
  }

  /**
   * Inserts a sequence of new route_streets, presumably representing a complete route.
   */
  def saveMultiple(newRouteStreets: Seq[RouteStreet]): Seq[Int] = db.withTransaction { implicit session =>
    (routeStreets returning routeStreets.map(_.routeStreetId)) ++= newRouteStreets
  }
}
