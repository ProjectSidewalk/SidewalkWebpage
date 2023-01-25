package models.route

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class UserRoute(userRouteId: Int, routeId: Int, userId: String, completed: Boolean)

class UserRouteTable(tag: slick.lifted.Tag) extends Table[UserRoute](tag, Some("sidewalk"), "user_route") {
  def userRouteId: Column[Int] = column[Int]("user_route_id", O.PrimaryKey, O.AutoInc)
  def routeId: Column[Int] = column[Int]("route_id", O.NotNull)
  def userId: Column[String] = column[String]("user_id", O.NotNull)
  def completed: Column[Boolean] = column[Boolean]("completed", O.NotNull)

  def * = (userRouteId, routeId, userId, completed) <> ((UserRoute.apply _).tupled, UserRoute.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] = foreignKey("user_route_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)
  def user: ForeignKeyQuery[UserTable, DBUser] = foreignKey("user_route_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

/**
 * Data access object for the route table.
 */
object UserRouteTable {
  val db = play.api.db.slick.DB
  val userRoutes = TableQuery[UserRouteTable]

  /**
   * Saves a new route.
   */
  def save(newUserRoute: UserRoute): Int = db.withSession { implicit session =>
    userRoutes.insertOrUpdate(newUserRoute)
  }
}
