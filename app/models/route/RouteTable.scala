package models.route

import com.google.inject.ImplementedBy
import models.region.RegionTableDef
import models.street.StreetEdgeTableDef
import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.LineString
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.lifted.Case

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class Route(
    routeId: Int,
    userId: String,
    regionId: Int,
    name: String,
    slug: String,
    description: Option[String],
    public: Boolean,
    deleted: Boolean,
    createdAt: OffsetDateTime
)

object Route {

  /** Maximum length of a user-supplied route name; shared by the API validation and the UI's input maxlength. */
  val MaxNameLength: Int = 100

  /** Maximum length of a route's optional public description; shared by validation and the UI's maxlength. */
  val MaxDescriptionLength: Int = 500
}

/**
 * A user-created route with the display stats shown in route listings (e.g. the dashboard's "My Routes").
 *
 * @param routeId        ID of the route.
 * @param regionId       ID of the region (neighborhood) the route is in.
 * @param regionName     Name of that region.
 * @param name           User-supplied route name.
 * @param slug           URL slug for the route's /r/<slug> share link.
 * @param description    Optional public description of why the route matters.
 * @param distanceMeters Total length of the route's streets in meters.
 * @param streetCount    Number of streets in the route.
 * @param createdAt      When the route was saved.
 */
case class RouteWithStats(
    routeId: Int,
    regionId: Int,
    regionName: String,
    name: String,
    slug: String,
    description: Option[String],
    distanceMeters: Double,
    streetCount: Int,
    createdAt: OffsetDateTime,
    startedCount: Int = 0,       // Users who opened the route in Explore (a user_route row exists).
    completedCount: Int = 0,     // Of those, users who finished it (user_route.completed).
    encodedPolyline: String = "" // The route's (decimated) geometry for static-map thumbnails.
)

class RouteTableDef(tag: slick.lifted.Tag) extends Table[Route](tag, "route") {
  def routeId: Rep[Int]                = column[Int]("route_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String]              = column[String]("user_id")
  def regionId: Rep[Int]               = column[Int]("region_id")
  def name: Rep[String]                = column[String]("name")
  def slug: Rep[String]                = column[String]("slug")
  def description: Rep[Option[String]] = column[Option[String]]("description")
  def public: Rep[Boolean]             = column[Boolean]("public")
  def deleted: Rep[Boolean]            = column[Boolean]("deleted")
  def createdAt: Rep[OffsetDateTime]   = column[OffsetDateTime]("created_at")

  def * = (routeId, userId, regionId, name, slug, description, public, deleted, createdAt) <> (
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
  val userRoutes   = TableQuery[UserRouteTableDef]

  def getRoute(routeId: Int): DBIO[Option[Route]] = {
    routes.filter(r => r.routeId === routeId && r.deleted === false).result.headOption
  }

  def insert(newRoute: Route): DBIO[Int] = {
    (routes returning routes.map(_.routeId)) += newRoute
  }

  /**
   * Total length of the route's streets in meters (0 if the route has no streets).
   */
  def getRouteDistance(routeId: Int): DBIO[Double] = {
    routeStreets
      .filter(_.routeId === routeId)
      .join(streetEdges)
      .on(_.streetEdgeId === _.streetEdgeId)
      .map { case (_, streetEdge) => streetEdge.geom.transform(26918).lengthD }
      .sum
      .getOrElse(0d)
      .result
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
        (route.routeId, route.regionId, region.name, route.name, route.slug, route.description, route.createdAt)
      }
      .map { case ((routeId, regionId, regionName, name, slug, description, createdAt), group) =>
        (
          routeId,
          regionId,
          regionName,
          name,
          slug,
          description,
          group.map { case (_, streetEdge) => streetEdge.geom.transform(26918).lengthD }.sum.getOrElse(0d),
          group.length,
          createdAt
        )
      }
      .sortBy(_._9.desc) // Newest first (createdAt).
      .result
      .map(_.map {
        case (routeId, regionId, regionName, name, slug, description, distanceMeters, streetCount, createdAt) =>
          RouteWithStats(routeId, regionId, regionName, name, slug, description, distanceMeters, streetCount, createdAt)
      })
  }

  /**
   * Counts, per route, how many users started exploring it (a non-discarded user_route row) and how many of those
   * completed it. Routes nobody has explored are absent from the map.
   */
  def getUsageCounts(routeIds: Seq[Int]): DBIO[Map[Int, (Int, Int)]] = {
    userRoutes
      .filter(ur => (ur.routeId inSet routeIds) && !ur.discarded)
      .groupBy(_.routeId)
      .map { case (routeId, group) =>
        (routeId, group.length, group.map(ur => Case.If(ur.completed).Then(1).Else(0)).sum.getOrElse(0))
      }
      .result
      .map(_.map { case (routeId, started, completed) => routeId -> (started, completed) }.toMap)
  }

  /**
   * Gets the street geometries for a set of routes, in walking order with each street's traversal direction, for
   * assembling per-route path geometry (e.g. thumbnail polylines).
   *
   * @return (routeId, reverse, geom) tuples ordered by route position.
   */
  def getStreetGeometries(routeIds: Seq[Int]): DBIO[Seq[(Int, Boolean, LineString)]] = {
    routeStreets
      .filter(_.routeId inSet routeIds)
      .join(streetEdges)
      .on(_.streetEdgeId === _.streetEdgeId)
      .sortBy { case (routeStreet, _) => routeStreet.position }
      .map { case (routeStreet, streetEdge) => (routeStreet.routeId, routeStreet.reverse, streetEdge.geom) }
      .result
  }

  /**
   * Gets a non-deleted route only if it is owned by the given user.
   */
  def getRouteOwned(routeId: Int, userId: String): DBIO[Option[Route]] = {
    routes.filter(r => r.routeId === routeId && r.userId === userId && r.deleted === false).result.headOption
  }

  /**
   * Sets a route's name and slug together (a rename regenerates the slug). The WHERE clause enforces ownership,
   * so a non-owner's rename updates 0 rows.
   *
   * @return Number of rows updated (0 if the route doesn't exist, is deleted, or isn't owned by userId).
   */
  def updateNameAndSlug(routeId: Int, userId: String, newName: String, newSlug: String): DBIO[Int] = {
    routes
      .filter(r => r.routeId === routeId && r.userId === userId && r.deleted === false)
      .map(r => (r.name, r.slug))
      .update((newName, newSlug))
  }

  /** Sets a route's slug without touching the name (used when an unnamed route gets its id-based default). */
  def updateSlug(routeId: Int, newSlug: String): DBIO[Int] = {
    routes.filter(_.routeId === routeId).map(_.slug).update(newSlug)
  }

  /**
   * Sets a route's public description. The WHERE clause enforces ownership.
   *
   * @return Number of rows updated (0 if the route doesn't exist, is deleted, or isn't owned by userId).
   */
  def updateDescription(routeId: Int, userId: String, description: Option[String]): DBIO[Int] = {
    routes
      .filter(r => r.routeId === routeId && r.userId === userId && r.deleted === false)
      .map(_.description)
      .update(description)
  }

  /** Gets the id of the non-deleted route with the given slug, if any. */
  def getRouteIdBySlug(slug: String): DBIO[Option[Int]] = {
    routes.filter(r => r.slug === slug && r.deleted === false).map(_.routeId).result.headOption
  }

  /**
   * Gets slugs (with their route ids) equal to the given base or starting with "<base>-" — the candidate set the
   * slug uniquifier must avoid. Includes deleted routes: their slugs stay reserved so a recycled slug can't make
   * an old share link point at someone else's route.
   */
  def slugsStartingWith(base: String): DBIO[Seq[(String, Int)]] = {
    routes.filter(r => r.slug === base || r.slug.startsWith(base + "-")).map(r => (r.slug, r.routeId)).result
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
