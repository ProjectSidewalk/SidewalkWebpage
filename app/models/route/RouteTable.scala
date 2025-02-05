package models.route

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class Route(routeId: Int, userId: String, regionId: Int, name: String, public: Boolean, deleted: Boolean)

class RouteTableDef(tag: slick.lifted.Tag) extends Table[Route](tag, "route") {
  def routeId: Rep[Int] = column[Int]("route_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String] = column[String]("user_id")
  def regionId: Rep[Int] = column[Int]("region_id")
  def name: Rep[String] = column[String]("name")
  def public: Rep[Boolean] = column[Boolean]("public")
  def deleted: Rep[Boolean] = column[Boolean]("deleted")

  def * = (routeId, userId, regionId, name, public, deleted) <> ((Route.apply _).tupled, Route.unapply)

//  def user: ForeignKeyQuery[UserTable, DBUser] = foreignKey("route_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
//  def region: ForeignKeyQuery[RegionTable, Region] = foreignKey("route_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)
}

@ImplementedBy(classOf[RouteTable])
trait RouteTableRepository {
  def getRoute(routeId: Int): DBIO[Option[Route]]
  def insert(newRoute: Route): DBIO[Int]
}

@Singleton
class RouteTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends RouteTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val routes = TableQuery[RouteTableDef]

  def getRoute(routeId: Int): DBIO[Option[Route]] = {
    routes.filter(r => r.routeId === routeId && r.deleted === false).result.headOption
  }

  def insert(newRoute: Route): DBIO[Int] = {
    (routes returning routes.map(_.routeId)) += newRoute
  }
}
