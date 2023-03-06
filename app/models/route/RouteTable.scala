package models.route

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.region.{Region, RegionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class Route(routeId: Int, userId: String, regionId: Int, name: String, public: Boolean, deleted: Boolean)

class RouteTable(tag: slick.lifted.Tag) extends Table[Route](tag, Some("sidewalk"), "route") {
  def routeId: Column[Int] = column[Int]("route_id", O.PrimaryKey, O.AutoInc)
  def userId: Column[String] = column[String]("user_id", O.NotNull)
  def regionId: Column[Int] = column[Int]("region_id", O.NotNull)
  def name: Column[String] = column[String]("name", O.NotNull)
  def public: Column[Boolean] = column[Boolean]("public", O.NotNull)
  def deleted: Column[Boolean] = column[Boolean]("deleted", O.NotNull)

  def * = (routeId, userId, regionId, name, public, deleted) <> ((Route.apply _).tupled, Route.unapply)

  def user: ForeignKeyQuery[UserTable, DBUser] = foreignKey("route_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
  def region: ForeignKeyQuery[RegionTable, Region] = foreignKey("route_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)
}

/**
 * Data access object for the route table.
 */
object RouteTable {
  val db = play.api.db.slick.DB
  val routes = TableQuery[RouteTable]

  def getRoute(routeId: Int): Option[Route] = db.withSession { implicit session =>
    routes.filter(_.routeId === routeId).firstOption
  }

  /**
   * Saves a new route.
   */
  def save(newRoute: Route): Int = db.withSession { implicit session =>
    (routes returning routes.map(_.routeId)) += newRoute
  }
}
