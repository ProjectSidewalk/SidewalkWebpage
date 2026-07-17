package models.route

import com.google.inject.ImplementedBy
import models.street.StreetEdgeTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class RouteStreet(routeStreetId: Int, routeId: Int, streetEdgeId: Int, reverse: Boolean)

class RouteStreetTableDef(tag: slick.lifted.Tag) extends Table[RouteStreet](tag, "route_street") {
  def routeStreetId: Rep[Int] = column[Int]("route_street_id", O.PrimaryKey, O.AutoInc)
  def routeId: Rep[Int]       = column[Int]("route_id")
  def streetEdgeId: Rep[Int]  = column[Int]("street_edge_id")
  def reverse: Rep[Boolean]   = column[Boolean]("reverse")

  def * = (routeStreetId, routeId, streetEdgeId, reverse) <> ((RouteStreet.apply _).tupled, RouteStreet.unapply)

  def route      = foreignKey("route_street_route_id_fkey", routeId, TableQuery[RouteTableDef])(_.routeId)
  def streetEdge =
    foreignKey("route_street_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
  def routeStreetUnique = index("route_street_route_id_street_edge_id_key", (routeId, streetEdgeId), unique = true)
}

@ImplementedBy(classOf[RouteStreetTable])
trait RouteStreetTableRepository {}

@Singleton
class RouteStreetTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends RouteStreetTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val routeStreets = TableQuery[RouteStreetTableDef]

  def insert(newRouteStreet: RouteStreet): DBIO[Int] = {
    (routeStreets returning routeStreets.map(_.routeStreetId)) += newRouteStreet
  }

  /**
   * Gets a route's streets in walking order (the serial route_street_id preserves the insertion sequence).
   */
  def getRouteStreets(routeId: Int): DBIO[Seq[RouteStreet]] = {
    routeStreets.filter(_.routeId === routeId).sortBy(_.routeStreetId).result
  }

  /**
   * Inserts a sequence of new route_streets, presumably representing a complete route.
   */
  def insertMultiple(newRouteStreets: Seq[RouteStreet]): DBIO[Seq[Int]] = {
    (routeStreets returning routeStreets.map(_.routeStreetId)) ++= newRouteStreets
  }
}
