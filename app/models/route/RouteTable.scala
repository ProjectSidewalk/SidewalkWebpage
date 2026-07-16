package models.route

import com.google.inject.ImplementedBy
import models.region.RegionTableDef
import models.street.StreetEdgeTableDef
import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class Route(
    routeId: Int,
    userId: String,
    regionId: Int,
    name: String,
    public: Boolean,
    deleted: Boolean,
    createdAt: OffsetDateTime
)

object Route {

  /** Maximum length of a user-supplied route name; shared by the API validation and the UI's input maxlength. */
  val MaxNameLength: Int = 100
}

/**
 * A user-created route with the display stats shown in route listings (e.g. the dashboard's "My Routes").
 *
 * @param routeId        ID of the route.
 * @param regionId       ID of the region (neighborhood) the route is in.
 * @param regionName     Name of that region.
 * @param name           User-supplied route name.
 * @param distanceMeters Total length of the route's streets in meters.
 * @param streetCount    Number of streets in the route.
 * @param createdAt      When the route was saved.
 */
case class RouteWithStats(
    routeId: Int,
    regionId: Int,
    regionName: String,
    name: String,
    distanceMeters: Double,
    streetCount: Int,
    createdAt: OffsetDateTime
)

class RouteTableDef(tag: slick.lifted.Tag) extends Table[Route](tag, "route") {
  def routeId: Rep[Int]              = column[Int]("route_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String]            = column[String]("user_id")
  def regionId: Rep[Int]             = column[Int]("region_id")
  def name: Rep[String]              = column[String]("name")
  def public: Rep[Boolean]           = column[Boolean]("public")
  def deleted: Rep[Boolean]          = column[Boolean]("deleted")
  def createdAt: Rep[OffsetDateTime] = column[OffsetDateTime]("created_at")

  def * = (routeId, userId, regionId, name, public, deleted, createdAt) <> (
    (Route.apply _).tupled,
    Route.unapply
  )

  def user   = foreignKey("route_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def region = foreignKey("route_region_id_fkey", regionId, TableQuery[RegionTableDef])(_.regionId)
}

@ImplementedBy(classOf[RouteTable])
trait RouteTableRepository {}

@Singleton
class RouteTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends RouteTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val routes       = TableQuery[RouteTableDef]
  val routeStreets = TableQuery[RouteStreetTableDef]
  val regions      = TableQuery[RegionTableDef]
  val streetEdges  = TableQuery[StreetEdgeTableDef]

  def getRoute(routeId: Int): DBIO[Option[Route]] = {
    routes.filter(r => r.routeId === routeId && r.deleted === false).result.headOption
  }

  def insert(newRoute: Route): DBIO[Int] = {
    (routes returning routes.map(_.routeId)) += newRoute
  }

  /**
   * Gets a user's routes (newest first) with the region name and distance/street-count stats for display.
   *
   * @param userId ID of the user whose routes to fetch; soft-deleted routes are excluded.
   */
  def getRoutesForUser(userId: String): DBIO[Seq[RouteWithStats]] = {
    routes
      .filter(r => r.userId === userId && r.deleted === false)
      .join(regions)
      .on(_.regionId === _.regionId)
      .join(routeStreets)
      .on { case ((route, _), routeStreet) => route.routeId === routeStreet.routeId }
      .join(streetEdges)
      .on { case ((_, routeStreet), streetEdge) => routeStreet.streetEdgeId === streetEdge.streetEdgeId }
      .groupBy { case (((route, region), _), _) =>
        (route.routeId, route.regionId, region.name, route.name, route.createdAt)
      }
      .map { case ((routeId, regionId, regionName, name, createdAt), group) =>
        (
          routeId,
          regionId,
          regionName,
          name,
          group.map { case (_, streetEdge) => streetEdge.geom.transform(26918).lengthD }.sum.getOrElse(0d),
          group.length,
          createdAt
        )
      }
      .sortBy(_._7.desc)
      .result
      .map(_.map(RouteWithStats.tupled))
  }

  /**
   * Renames a route. The WHERE clause enforces ownership, so a non-owner's rename updates 0 rows.
   *
   * @return Number of rows updated (0 if the route doesn't exist, is deleted, or isn't owned by userId).
   */
  def rename(routeId: Int, userId: String, newName: String): DBIO[Int] = {
    routes
      .filter(r => r.routeId === routeId && r.userId === userId && r.deleted === false)
      .map(_.name)
      .update(newName)
  }

  /**
   * Soft-deletes a route. The WHERE clause enforces ownership, so a non-owner's delete updates 0 rows.
   *
   * @return Number of rows updated (0 if the route doesn't exist, is already deleted, or isn't owned by userId).
   */
  def softDelete(routeId: Int, userId: String): DBIO[Int] = {
    routes
      .filter(r => r.routeId === routeId && r.userId === userId && r.deleted === false)
      .map(_.deleted)
      .update(true)
  }
}
