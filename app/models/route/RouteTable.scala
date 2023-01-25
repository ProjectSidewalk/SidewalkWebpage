package models.route

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class Route(routeId: Int, userId: String, name: String, public: Boolean, deleted: Boolean)

class RouteTable(tag: slick.lifted.Tag) extends Table[Route](tag, Some("sidewalk"), "route") {
  def routeId: Column[Int] = column[Int]("route_id", O.PrimaryKey, O.AutoInc)
  def userId: Column[String] = column[String]("user_id", O.NotNull)
  def name: Column[String] = column[String]("name", O.NotNull)
  def public: Column[Boolean] = column[Boolean]("public", O.NotNull)
  def deleted: Column[Boolean] = column[Boolean]("deleted", O.NotNull)

  def * = (routeId, userId, name, public, deleted) <> ((Route.apply _).tupled, Route.unapply)

  def user: ForeignKeyQuery[UserTable, DBUser] = foreignKey("route_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

/**
 * Data access object for the route table.
 */
object RouteTable {
  val db = play.api.db.slick.DB
  val routes = TableQuery[RouteTable]

  /**
   * Saves a new route.
   */
  def save(newRoute: Route): Int = db.withSession { implicit session =>
    (routes returning routes.map(_.routeId)) += newRoute
  }
}
