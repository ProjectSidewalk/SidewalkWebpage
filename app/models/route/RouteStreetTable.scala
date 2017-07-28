package models.route

/**
  * Created by manaswi on 5/5/17.
  */
import models.region.{Region, RegionTable}
import models.street.{StreetEdge, StreetEdgeTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class RouteStreet(routeStreetId: Int, length: Double,
                       routeId: Int, regionId: Int,
                       current_street_edge_id : Int, next_street_edge_id: Int,
                       isStartEdge: Boolean, isEndEdge: Boolean)
/**
  *
  */
class RouteStreetTable(tag: Tag) extends Table[RouteStreet](tag, Some("sidewalk"), "route_street") {
  def routeStreetId = column[Int]("route_street_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def length = column[Double]("length_mi", O.NotNull)
  def routeId = column[Int]("route_id", O.NotNull)
  def regionId = column[Int]("region_id", O.NotNull)
  def current_street_edge_id = column[Int]("current_street_edge_id", O.NotNull)
  def next_street_edge_id = column[Int]("next_street_edge_id", O.NotNull)
  def isStartEdge = column[Boolean]("route_start_edge", O.NotNull)
  def isEndEdge = column[Boolean]("route_end_edge", O.NotNull)

  def * = (routeStreetId, length, routeId, regionId,
    current_street_edge_id, next_street_edge_id, isStartEdge, isEndEdge) <> ((RouteStreet.apply _).tupled, RouteStreet.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] =
    foreignKey("route_street_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)

  def region: ForeignKeyQuery[RegionTable, Region] =
    foreignKey("route_street_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)

  def currentStreetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] =
    foreignKey("route_street_current_street_edge_id_fkey", current_street_edge_id, TableQuery[StreetEdgeTable])(_.streetEdgeId)

}

/**
  * Data access object for the RouteStreet table
  */
object RouteStreetTable{
  val db = play.api.db.slick.DB
  val routesStreets = TableQuery[RouteStreetTable]
  val streetEdges = TableQuery[StreetEdgeTable]

  def getRouteStreets(routeId: Int): List[RouteStreet] = db.withSession { implicit session =>
    val routeStreet = routesStreets.filter(_.routeId === routeId).list
    routeStreet
  }

  def selectStreetsOnRoutes: List[StreetEdge] = db.withSession { implicit session =>
    val _streetEdges = (for {
      (_routesStreets, _streetEdges) <- routesStreets.innerJoin(streetEdges).on(_.current_street_edge_id === _.streetEdgeId)
    } yield _streetEdges).filter(edge => edge.deleted === false)
    _streetEdges.list.groupBy(_.streetEdgeId).map(_._2.head).toList  // Filter out the duplicated street edge
  }

  /**
    * Returns a list of all the street edges
    *
    * @return A list of StreetEdge objects.
    */
  def all: List[RouteStreet] = db.withSession { implicit session =>
    routesStreets.list
  }

  def getFirstRouteStreetId(routeId: Int): Option[Int] = db.withSession { implicit session =>
    val routeStreet = routesStreets.filter(_.routeId === routeId).filter(_.isStartEdge === true).list.headOption
    routeStreet match {
      case Some(route) => Some(route.current_street_edge_id)
      case _ => None
    }
  }

  def save(routeStreetId: RouteStreet): Int = db.withTransaction { implicit session =>
    val rId: Int =
      (routesStreets returning routesStreets.map(_.routeId)) += routeStreetId
    rId
  }
}