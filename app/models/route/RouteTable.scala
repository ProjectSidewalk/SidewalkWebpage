package models.route

/**
  * Created by manaswi on 5/5/17.
  */
import models.region.{Region, RegionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class Route(routeId: Int, regionId: Int, streetCount: Int,
                 route_length_mi: Double,
                 mean_street_length_mi : Double,
                 std_street_length_mi: Double)
/**
  *
  */
class RouteTable(tag: Tag) extends Table[Route](tag, Some("sidewalk"), "route") {
  def routeId = column[Int]("route_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def regionId = column[Int]("region_id", O.NotNull)
  def streetCount = column[Int]("street_count", O.NotNull)
  def route_length_mi = column[Double]("route_length_mi", O.NotNull)
  def mean_street_length_mi = column[Double]("mean_street_length_mi", O.NotNull)
  def std_street_length_mi = column[Double]("std_street_length_mi", O.Nullable)

  def * = (routeId, regionId, streetCount, route_length_mi,
    mean_street_length_mi, std_street_length_mi) <> ((Route.apply _).tupled, Route.unapply)

  def region: ForeignKeyQuery[RegionTable, Region] =
    foreignKey("route_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)

}

/**
  * Data access object for the Route table
  */
object RouteTable{
  val db = play.api.db.slick.DB
  val routes = TableQuery[RouteTable]

  def getRoute(routeId: Option[Int]): Option[Route] = db.withSession { implicit session =>
    val route = routes.filter(_.routeId === routeId).list
    route.headOption
  }
  def all: List[Route] = db.withSession { implicit session =>
    routes.list
  }

  def save(route: Route): Int = db.withTransaction { implicit session =>
    val rId: Int =
      (routes returning routes.map(_.routeId)) += route
    rId
  }
}