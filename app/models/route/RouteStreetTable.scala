package models.route

import com.google.inject.ImplementedBy
import models.street.StreetEdgeTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class RouteStreet(routeStreetId: Int, routeId: Int, streetEdgeId: Int, reverse: Boolean, position: Int)

class RouteStreetTableDef(tag: slick.lifted.Tag) extends Table[RouteStreet](tag, "route_street") {
  def routeStreetId: Rep[Int] = column[Int]("route_street_id", O.PrimaryKey, O.AutoInc)
  def routeId: Rep[Int]       = column[Int]("route_id")
  def streetEdgeId: Rep[Int]  = column[Int]("street_edge_id")
  def reverse: Rep[Boolean]   = column[Boolean]("reverse")
  def position: Rep[Int]      = column[Int]("position")

  def * = (routeStreetId, routeId, streetEdgeId, reverse, position) <> (
    (RouteStreet.apply _).tupled,
    RouteStreet.unapply
  )

  def route      = foreignKey("route_street_route_id_fkey", routeId, TableQuery[RouteTableDef])(_.routeId)
  def streetEdge =
    foreignKey("route_street_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
  // Out-and-back routes traverse a street twice (once per direction), so the natural key is the walking-order
  // position, not the street. Mirrors the UNIQUE (route_id, position) constraint from evolution 344.
  def routeStreetUnique = index("route_street_route_id_position_key", (routeId, position), unique = true)
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
   * Gets a route's streets in walking order.
   */
  def getRouteStreets(routeId: Int): DBIO[Seq[RouteStreet]] = {
    routeStreets.filter(_.routeId === routeId).sortBy(_.position).result
  }

  /**
   * Inserts a sequence of new route_streets, presumably representing a complete route.
   */
  def insertMultiple(newRouteStreets: Seq[RouteStreet]): DBIO[Seq[Int]] = {
    (routeStreets returning routeStreets.map(_.routeStreetId)) ++= newRouteStreets
  }

  /**
   * Moves an existing route street to a new position in the walking order, updating its traversal direction.
   */
  def updatePositionAndReverse(routeStreetId: Int, position: Int, reverse: Boolean): DBIO[Int] = {
    routeStreets
      .filter(_.routeStreetId === routeStreetId)
      .map(rs => (rs.position, rs.reverse))
      .update((position, reverse))
  }

  def deleteByIds(routeStreetIds: Seq[Int]): DBIO[Int] = {
    routeStreets.filter(_.routeStreetId inSet routeStreetIds).delete
  }
}
