package models.route

import com.google.inject.ImplementedBy
import models.region.RegionTableDef
import models.street.{StreetEdgeRegionTableDef, StreetEdgeTableDef}
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
    // The region the route STARTS in: its first street's region. A route is free to run on through other regions
    // (#3488), so this is where a walk begins and what a listing names, not a boundary the streets stay inside.
    // Derived from the streets like the two stats below, never taken from the client. See RouteTable.updateStats.
    regionId: Int,
    name: String,
    slug: String,
    description: Option[String],
    public: Boolean,
    deleted: Boolean,
    createdAt: OffsetDateTime,
    // Derived from the route's streets and rewritten whenever the street list changes, so listings don't have to
    // re-measure geometry on every request. See RouteTable.updateStats.
    distanceMeters: Double,
    streetCount: Int
)

object Route {

  /** Maximum length of a user-supplied route name; shared by the API validation and the UI's input maxlength. */
  val MaxNameLength: Int = 100

  /** Maximum length of a route's optional public description; shared by validation and the UI's maxlength. */
  val MaxDescriptionLength: Int = 500
}

/**
 * Why a route submission was refused: a Play i18n key and, for the keys about length, the limit they interpolate.
 *
 * The HTTP layer localizes it, so RouteService can enforce the content contract without knowing the request's
 * language — the same split as UserService.changeUsername's Left(i18nKey).
 */
case class RouteRejection(messageKey: String, maxLength: Int = 0)

/**
 * A route as it stands right after a save or update: its identity plus the display data its card needs.
 *
 * Returning the geometry and thumbnail here is what lets the client — including a guest, whose route list lives in
 * localStorage — keep a card in sync without a second round trip or a second polyline implementation.
 *
 * @param regionName      Name of the region the route starts in.
 * @param regionCount     How many regions the route's streets run through (1 when it never leaves the first).
 * @param encodedPolyline The route geometry, Google-encoded, for a static-map thumbnail.
 * @param thumbnailUrl    Ready static-map URL for that geometry; "" when the route has no streets.
 */
case class SavedRoute(
    routeId: Int,
    name: String,
    slug: String,
    regionName: String,
    regionCount: Int,
    distanceMeters: Double,
    encodedPolyline: String,
    thumbnailUrl: String
)

/**
 * A user-created route with the display stats shown in route listings (e.g. the dashboard's "My Routes").
 *
 * @param routeId        ID of the route.
 * @param regionId       ID of the region the route starts in.
 * @param regionName     Name of that region.
 * @param regionCount    How many regions the route's streets run through (1 when it never leaves the first).
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
    regionCount: Int,
    name: String,
    slug: String,
    description: Option[String],
    distanceMeters: Double,
    streetCount: Int,
    createdAt: OffsetDateTime,
    startedCount: Int = 0,        // Users who opened the route in Explore (a user_route row exists).
    completedCount: Int = 0,      // Of those, users who finished it (user_route.completed).
    encodedPolyline: String = "", // The route's (decimated) geometry for static-map thumbnails.
    thumbnailUrl: String = ""     // Ready static-map URL for that geometry; "" when the route has no streets.
)

class RouteTableDef(tag: slick.lifted.Tag) extends Table[Route](tag, "route") {
  def routeId: Rep[Int]                = column[Int]("route_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String]              = column[String]("user_id")
  def regionId: Rep[Int]               = column[Int]("region_id")
  def name: Rep[String]                = column[String]("name")
  def slug: Rep[String]                = column[String]("slug")
  def description: Rep[Option[String]] = column[Option[String]]("description")
  def public: Rep[Boolean]             = column[Boolean]("public", O.Default(true))
  def deleted: Rep[Boolean]            = column[Boolean]("deleted", O.Default(false))
  // DEFAULT now() in the DB (O.Default holds a value, not an expression).
  def createdAt: Rep[OffsetDateTime] = column[OffsetDateTime]("created_at")
  def distanceMeters: Rep[Double]    = column[Double]("distance_meters")
  def streetCount: Rep[Int]          = column[Int]("street_count")

  def * =
    (routeId, userId, regionId, name, slug, description, public, deleted, createdAt, distanceMeters, streetCount) <> (
      (Route.apply _).tupled,
      Route.unapply
    )

  def user   = foreignKey("route_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def region = foreignKey("route_region_id_fkey", regionId, TableQuery[RegionTableDef])(_.regionId)
  // Share links resolve a route by slug, so slugs are unique city-wide. Mirrors route_slug_idx (evolution 344).
  def slugUnique = index("route_slug_idx", slug, unique = true)
}

@ImplementedBy(classOf[RouteTable])
trait RouteTableRepository {}

@Singleton
class RouteTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends RouteTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val routes            = TableQuery[RouteTableDef]
  val routeStreets      = TableQuery[RouteStreetTableDef]
  val regions           = TableQuery[RegionTableDef]
  val streetEdges       = TableQuery[StreetEdgeTableDef]
  val userRoutes        = TableQuery[UserRouteTableDef]
  val streetEdgeRegions = TableQuery[StreetEdgeRegionTableDef]

  def getRoute(routeId: Int): DBIO[Option[Route]] = {
    routes.filter(r => r.routeId === routeId && r.deleted === false).result.headOption
  }

  def insert(newRoute: Route): DBIO[Int] = {
    (routes returning routes.map(_.routeId)) += newRoute
  }

  /**
   * Gets one non-deleted route as its listing row, for describing a route right after it is saved.
   */
  def getRouteWithStats(routeId: Int): DBIO[Option[RouteWithStats]] = {
    routesWithStats(routes.filter(r => r.routeId === routeId && r.deleted === false)).map(_.headOption)
  }

  /**
   * The region a street belongs to, which is the start region of a route whose first street it is.
   *
   * @return None when no such street exists.
   */
  def getRegionIdOfStreet(streetEdgeId: Int): DBIO[Option[Int]] = {
    streetEdgeRegions.filter(_.streetEdgeId === streetEdgeId).map(_.regionId).result.headOption
  }

  /**
   * Counts how many of the given street ids are real streets, i.e. filed under a region. A route submitted with any
   * id this doesn't count would otherwise fail its route_street foreign key as a 500.
   */
  def countKnownStreets(streetEdgeIds: Set[Int]): DBIO[Int] = {
    streetEdgeRegions.filter(_.streetEdgeId inSet streetEdgeIds).length.result
  }

  /**
   * Counts, per route, the distinct regions its streets run through. Routes with no streets are absent from the map.
   */
  def getRegionCounts(routeIds: Seq[Int]): DBIO[Map[Int, Int]] = {
    routeStreets
      .filter(_.routeId inSet routeIds)
      .join(streetEdgeRegions)
      .on(_.streetEdgeId === _.streetEdgeId)
      .groupBy { case (routeStreet, _) => routeStreet.routeId }
      .map { case (routeId, group) => (routeId, group.map(_._2.regionId).countDistinct) }
      .result
      .map(_.toMap)
  }

  /**
   * Total length of the route's streets in meters (0 if the route has no streets).
   */
  def getRouteDistance(routeId: Int): DBIO[Double] = {
    routeStreets
      .filter(_.routeId === routeId)
      .join(streetEdges)
      .on(_.streetEdgeId === _.streetEdgeId)
      .map { case (_, streetEdge) => streetEdge.geom.lengthGeodesic }
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
    routesWithStats(routes.filter(r => r.userId === userId && r.deleted === false))
  }

  /**
   * Gets the city's routes (newest first, capped at n) with the region name and distance/street-count stats, for the
   * public /routes listing page (#4688). Every non-deleted route is included regardless of creator: routes are
   * shareable by bare id/slug already, so the listing exposes nothing a share link doesn't.
   */
  def getRoutesForCity(n: Int): DBIO[Seq[RouteWithStats]] = {
    routesWithStats(routes.filter(_.deleted === false), limit = Some(n))
  }

  /**
   * Projects a filtered route query to newest-first `RouteWithStats` rows, each with the name of the region it starts
   * in and the number of regions it runs through.
   */
  private def routesWithStats(
      filteredRoutes: Query[RouteTableDef, Route, Seq],
      limit: Option[Int] = None
  ): DBIO[Seq[RouteWithStats]] = {
    val sorted = filteredRoutes
      .join(regions)
      .on(_.regionId === _.regionId)
      .sortBy { case (route, _) => route.createdAt.desc } // Newest first.
    limit
      .map(sorted.take)
      .getOrElse(sorted)
      .map { case (route, region) =>
        (route.routeId, route.regionId, region.name, route.name, route.slug, route.description, route.distanceMeters,
          route.streetCount, route.createdAt)
      }
      .result
      .flatMap { rows =>
        getRegionCounts(rows.map(_._1)).map { regionCounts =>
          rows.map {
            case (routeId, regionId, regionName, name, slug, description, distanceMeters, streetCount, createdAt) =>
              RouteWithStats(
                routeId,
                regionId,
                regionName,
                regionCounts.getOrElse(routeId, 1),
                name,
                slug,
                description,
                distanceMeters,
                streetCount,
                createdAt
              )
          }
        }
      }
  }

  /**
   * Recomputes what a route row caches about its streets: distance, street count, and the start region.
   *
   * Called whenever the street list changes, so listings can read the stats straight off the route row instead of
   * re-measuring every street's geometry per request. Distance is in geodesic meters; a route with no streets gets
   * zeroes. The start region follows the first street, so editing a route's beginning into another region moves it;
   * a route left with no streets keeps the region it had, since region_id is NOT NULL.
   */
  def updateStats(routeId: Int): DBIO[Int] = {
    sqlu"""
      UPDATE route
      SET distance_meters = COALESCE(stats.distance_meters, 0),
          street_count = COALESCE(stats.street_count, 0),
          region_id = COALESCE(
              (
                  SELECT street_edge_region.region_id
                  FROM route_street
                  INNER JOIN street_edge_region ON route_street.street_edge_id = street_edge_region.street_edge_id
                  WHERE route_street.route_id = $routeId
                  ORDER BY route_street.position
                  LIMIT 1
              ),
              route.region_id
          )
      FROM (
          SELECT SUM(ST_Length(street_edge.geom::geography)) AS distance_meters,
                 COUNT(*) AS street_count
          FROM route_street
          INNER JOIN street_edge ON route_street.street_edge_id = street_edge.street_edge_id
          WHERE route_street.route_id = $routeId
      ) stats
      WHERE route.route_id = $routeId
    """
  }

  /**
   * Counts, per route, how many users started exploring it (a non-discarded user_route row) and how many of those
   * completed it. Routes nobody has explored are absent from the map.
   */
  def getUsageCounts(routeIds: Seq[Int]): DBIO[Map[Int, (Int, Int)]] = {
    // Distinct users, not rows: getActiveRouteOrCreateNew only reuses an unfinished user_route, so every repeat
    // walk by the same person inserts another row. The UI copy promises people ("how many people have started
    // exploring this route"), so counting rows would report one person as two.
    userRoutes
      .filter(ur => (ur.routeId inSet routeIds) && !ur.discarded)
      .groupBy(_.routeId)
      .map { case (routeId, group) =>
        (
          routeId,
          group.map(_.userId).countDistinct,
          group.map(ur => Case.If(ur.completed).Then(ur.userId.?).Else(None: Option[String])).countDistinct
        )
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

  /**
   * Gets the (slug, route id) pairs of the non-deleted routes carrying any of the given slugs.
   *
   * Plural so one `slug IN (...)` covers every spelling a share link is tried under (#5150) and still serves from
   * route_slug_idx, where a probe per spelling would be a round trip each. The caller decides which spelling wins.
   */
  def getRouteIdsBySlugs(slugs: Seq[String]): DBIO[Seq[(String, Int)]] = {
    routes.filter(r => r.slug.inSet(slugs) && r.deleted === false).map(r => (r.slug, r.routeId)).result
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
