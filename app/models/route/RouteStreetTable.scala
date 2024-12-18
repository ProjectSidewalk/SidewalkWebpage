package models.route

import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class RouteStreet(routeStreetId: Int, routeId: Int, streetEdgeId: Int, reverse: Boolean)

class RouteStreetTableDef(tag: slick.lifted.Tag) extends Table[RouteStreet](tag, "route_street") {
  def routeStreetId: Rep[Int] = column[Int]("route_street_id", O.PrimaryKey, O.AutoInc)
  def routeId: Rep[Int] = column[Int]("route_id")
  def streetEdgeId: Rep[Int] = column[Int]("street_edge_id")
  def reverse: Rep[Boolean] = column[Boolean]("reverse")

  def * = (routeStreetId, routeId, streetEdgeId, reverse) <> ((RouteStreet.apply _).tupled, RouteStreet.unapply)

//  def route: ForeignKeyQuery[RouteTable, Route] = foreignKey("route_street_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)
//  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] = foreignKey("route_street_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTable])(_.streetEdgeId)
}

@ImplementedBy(classOf[RouteStreetTable])
trait RouteStreetTableRepository {
}

@Singleton
class RouteStreetTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends RouteStreetTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._

  val routeStreets = TableQuery[RouteStreetTableDef]

  /**
   * Saves a new route_street.
   */
//  def save(newRouteStreet: RouteStreet): Int = db.withSession { implicit session =>
//    (routeStreets returning routeStreets.map(_.routeStreetId)) += newRouteStreet
//  }

  /**
   * Inserts a sequence of new route_streets, presumably representing a complete route.
   */
//  def saveMultiple(newRouteStreets: Seq[RouteStreet]): Seq[Int] = db.withSession { implicit session =>
//    (routeStreets returning routeStreets.map(_.routeStreetId)) ++= newRouteStreets
//  }
}
