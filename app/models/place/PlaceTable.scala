package models.place

import com.google.inject.ImplementedBy
import models.api.{PlaceFiltersForApi, PlaceForApi}
import models.utils.MyPostgresProfile.api._
import models.utils.{LatLngBBox, MyPostgresProfile}
import org.locationtech.jts.geom.Point
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsValue, Json}
import slick.jdbc.GetResult
import slick.sql.SqlStreamingAction

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/**
 * One place (#5311): a destination people need to reach, as a point, filed under a [[PlaceCategory]].
 *
 * @param placeId                Stable across refreshes: an OSM place keeps its id as long as OSM keeps the object.
 * @param category               A [[PlaceCategory]] id (a CHECK in the DB, held to the catalog by PlaceTableSpec).
 * @param name                   The place's name, or None when OSM has none (the tool then shows the category).
 * @param source                 `osm` for a row the refresh owns, `city` for one a city supplied (never refreshed).
 * @param osmType                `node`, `way`, or `relation`; set exactly when `source` is `osm` (a CHECK).
 * @param osmId                  The OSM object id, unique with `osmType`.
 * @param tags                   The object's whole OSM tag map, for features that want more than the name.
 * @param geom                   The place as a point: the node, or the way's or relation's center.
 * @param regionId               The region containing the point, or None just outside every region.
 * @param nearestStreetEdgeId    The nearest open street within 250 m (the tutorial street excluded), for the place
 *                               card; the same streets the AccessScore feed scores.
 * @param nearestStreetDistanceM Geodesic meters to it; set exactly when the street is (a CHECK).
 * @param fetchedAt              When the refresh last saw the object.
 */
case class Place(
    placeId: Int,
    category: String,
    name: Option[String],
    source: String,
    osmType: Option[String],
    osmId: Option[Long],
    tags: JsValue,
    geom: Point,
    regionId: Option[Int],
    nearestStreetEdgeId: Option[Int],
    nearestStreetDistanceM: Option[Double],
    fetchedAt: OffsetDateTime
)

/**
 * One OSM object as the refresh fetched it, before it is merged into `place`.
 *
 * @param category The [[PlaceCategory]] id its tags resolved to.
 * @param name     Its `name` tag, trimmed, or None.
 * @param osmType  `node`, `way`, or `relation`.
 * @param osmId    The OSM object id.
 * @param tags     Its whole tag map.
 * @param geom     Its point: the node, or the center Overpass computed for a way or relation.
 */
case class FetchedPlace(
    category: String,
    name: Option[String],
    osmType: String,
    osmId: Long,
    tags: JsValue,
    geom: Point
)

/**
 * What a refresh did to the `place` table.
 *
 * @param fetched  Objects Overpass returned that resolved to a category.
 * @param dropped  Of those, the ones farther than 250 m from every region, left out as outside the city.
 * @param total    Rows in the table afterwards, city-supplied ones included.
 * @param inserted OSM places seen for the first time.
 * @param updated  OSM places whose category, name, tags, position, region, or nearest street changed.
 * @param deleted  OSM places absent from the fetch.
 */
case class PlaceRefreshCounts(fetched: Int, dropped: Int, total: Int, inserted: Int, updated: Int, deleted: Int)

class PlaceTableDef(tag: Tag) extends Table[Place](tag, "place") {
  def placeId: Rep[Int]            = column[Int]("place_id", O.PrimaryKey, O.AutoInc)
  def category: Rep[String]        = column[String]("category")         // CHECK (IN PlaceCategory.ids)
  def name: Rep[Option[String]]    = column[Option[String]]("name")
  def source: Rep[String]          = column[String]("source")           // CHECK (IN ('osm', 'city'))
  def osmType: Rep[Option[String]] = column[Option[String]]("osm_type") // CHECK (IN ('node', 'way', 'relation'))
  def osmId: Rep[Option[Long]]     = column[Option[Long]]("osm_id")
  def tags: Rep[JsValue]         = column[JsValue]("tags", O.Default(Json.obj())) // CHECK (jsonb_typeof = 'object')
  def geom: Rep[Point]           = column[Point]("geom")
  def regionId: Rep[Option[Int]] = column[Option[Int]]("region_id")
  def nearestStreetEdgeId: Rep[Option[Int]]       = column[Option[Int]]("nearest_street_edge_id")
  def nearestStreetDistanceM: Rep[Option[Double]] = column[Option[Double]]("nearest_street_distance_m") // CHECK (>= 0)
  def fetchedAt: Rep[OffsetDateTime]              = column[OffsetDateTime]("fetched_at")
  // Cross-column CHECKs in the DB (396.sql), which Slick can't express: an OSM reference is present exactly when
  // source is 'osm', and the street distance exactly when the street is.

  def * = (
    placeId, category, name, source, osmType, osmId, tags, geom, regionId, nearestStreetEdgeId, nearestStreetDistanceM,
    fetchedAt
  ) <> ((Place.apply _).tupled, Place.unapply)

  def osmKey = index("place_osm_key", (osmType, osmId), unique = true)

  def region = foreignKey("place_region_id_fkey", regionId, TableQuery[models.region.RegionTableDef])(_.regionId.?)

  def nearestStreet = foreignKey(
    "place_nearest_street_edge_id_fkey",
    nearestStreetEdgeId,
    TableQuery[models.street.StreetEdgeTableDef]
  )(_.streetEdgeId.?, onDelete = ForeignKeyAction.SetNull)
}

/**
 * The refresh's staging table: a session temp table with the fetched objects' columns, so the merge into `place` is
 * plain SQL over two tables rather than a statement per row. [[PlaceTable.replaceOsmPlaces]] creates it.
 */
class FetchedPlaceTableDef(tag: Tag) extends Table[FetchedPlace](tag, "fetched_place") {
  def category: Rep[String]     = column[String]("category")
  def name: Rep[Option[String]] = column[Option[String]]("name")
  def osmType: Rep[String]      = column[String]("osm_type")
  def osmId: Rep[Long]          = column[Long]("osm_id")
  def tags: Rep[JsValue]        = column[JsValue]("tags")
  def geom: Rep[Point]          = column[Point]("geom")

  def * = (category, name, osmType, osmId, tags, geom) <> ((FetchedPlace.apply _).tupled, FetchedPlace.unapply)
}

@ImplementedBy(classOf[PlaceTable])
trait PlaceTableRepository {

  /**
   * Replaces the OSM-sourced places with a fresh fetch, touching only the rows that changed.
   *
   * Compose inside a transaction (the staging table it uses drops on commit). A fetched object already in the table
   * keeps its `place_id` and is updated in place when anything about it changed; a new one is inserted; an OSM place
   * absent from the fetch is deleted. City-supplied rows are left alone. Objects farther than 250 m from every
   * region are dropped first: the fetch covers the city's bounding box, and the corners of that box are not the city.
   *
   * @param fetched   The objects, as [[service.PlacesService.parseOverpass]] produced them.
   * @param fetchedAt When they were fetched; stamped on every row the fetch returned.
   */
  def replaceOsmPlaces(fetched: Seq[FetchedPlace], fetchedAt: OffsetDateTime): DBIO[PlaceRefreshCounts]

  /** When the refresh last saw any OSM place, or None before the first successful refresh. */
  def newestFetchedAt: DBIO[Option[OffsetDateTime]]

  /**
   * The bounding box of the city's live regions: what the refresh asks Overpass for. The configured map bounds are
   * for panning and can cover a metro area (Teaneck's fetched 42k objects and kept 175), while every kept place has
   * to sit within 250 m of a region anyway.
   *
   * @return The box, or None for a schema with no regions.
   */
  def regionsExtent: DBIO[Option[LatLngBBox]]

  /** How many OSM-sourced places the table holds. */
  def osmPlaceCount: DBIO[Int]

  /**
   * The places the public API returns, with the region name joined on, designed for streaming.
   *
   * @param filters The filters to apply.
   * @return        A streaming action yielding one row per place, in category order then by id.
   */
  def getPlacesForApi(filters: PlaceFiltersForApi): SqlStreamingAction[Vector[PlaceForApi], PlaceForApi, Effect.Read]
}

/**
 * The `place` table (#5311) and the merge that keeps it current from OpenStreetMap.
 */
@Singleton
class PlaceTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends PlaceTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val places: TableQuery[PlaceTableDef]               = TableQuery[PlaceTableDef]
  val fetchedPlaces: TableQuery[FetchedPlaceTableDef] = TableQuery[FetchedPlaceTableDef]

  def replaceOsmPlaces(fetched: Seq[FetchedPlace], fetchedAt: OffsetDateTime): DBIO[PlaceRefreshCounts] = {
    for {
      // A second refresh in one transaction (a spec's, or a retry) must not trip over the first one's staging table.
      _ <- sqlu"""DROP TABLE IF EXISTS fetched_place"""
      _ <- sqlu"""CREATE TEMP TABLE fetched_place (
                      category TEXT NOT NULL,
                      name TEXT,
                      osm_type TEXT NOT NULL,
                      osm_id BIGINT NOT NULL,
                      tags JSONB NOT NULL,
                      geom geometry(Point, 4326) NOT NULL,
                      region_id INTEGER,
                      nearest_street_edge_id INTEGER,
                      nearest_street_distance_m DOUBLE PRECISION,
                      PRIMARY KEY (osm_type, osm_id)
                  ) ON COMMIT DROP"""
      _ <- fetchedPlaces ++= fetched
      // Outside-the-city noise from the bounding-box query. The degree box is the index prefilter and must contain
      // the geodesic radius anywhere a city sits: 0.005 deg covers 250 m up to ~63 deg latitude.
      dropped <- sqlu"""DELETE FROM fetched_place
                        WHERE NOT EXISTS (
                            SELECT 1 FROM region
                            WHERE NOT region.deleted
                              AND ST_DWithin(region.geom, fetched_place.geom, 0.005)
                              AND ST_DWithin(region.geom::geography, fetched_place.geom::geography, 250)
                        )"""
      // The lowest region id wins where regions overlap, so the answer is the same on every refresh.
      _ <- sqlu"""UPDATE fetched_place
                  SET region_id = (
                      SELECT region.region_id FROM region
                      WHERE NOT region.deleted AND ST_Within(fetched_place.geom, region.geom)
                      ORDER BY region.region_id
                      LIMIT 1
                  )"""
      _ <- sqlu"""UPDATE fetched_place
                  SET nearest_street_edge_id = nearest.street_edge_id,
                      nearest_street_distance_m = nearest.distance_m
                  FROM (
                      SELECT fetched_place.osm_type, fetched_place.osm_id, candidate.street_edge_id,
                             candidate.distance_m
                      FROM fetched_place
                      LEFT JOIN LATERAL (
                          SELECT street_edge.street_edge_id,
                                 ST_Distance(street_edge.geom::geography, fetched_place.geom::geography) AS distance_m
                          FROM street_edge
                          WHERE street_edge.status = 'open'
                            AND street_edge.street_edge_id IS DISTINCT FROM (SELECT tutorial_street_edge_id FROM config)
                            AND ST_DWithin(street_edge.geom, fetched_place.geom, 0.005)
                            AND ST_DWithin(street_edge.geom::geography, fetched_place.geom::geography, 250)
                          ORDER BY ST_Distance(street_edge.geom::geography, fetched_place.geom::geography)
                          LIMIT 1
                      ) candidate ON TRUE
                  ) nearest
                  WHERE fetched_place.osm_type = nearest.osm_type AND fetched_place.osm_id = nearest.osm_id"""
      updated <- sqlu"""UPDATE place
                        SET category = fetched_place.category,
                            name = fetched_place.name,
                            tags = fetched_place.tags,
                            geom = fetched_place.geom,
                            region_id = fetched_place.region_id,
                            nearest_street_edge_id = fetched_place.nearest_street_edge_id,
                            nearest_street_distance_m = fetched_place.nearest_street_distance_m,
                            fetched_at = $fetchedAt
                        FROM fetched_place
                        WHERE place.source = 'osm'
                          AND place.osm_type = fetched_place.osm_type AND place.osm_id = fetched_place.osm_id
                          AND (place.category <> fetched_place.category
                               OR place.name IS DISTINCT FROM fetched_place.name
                               OR place.tags <> fetched_place.tags
                               OR NOT ST_Equals(place.geom, fetched_place.geom)
                               OR place.region_id IS DISTINCT FROM fetched_place.region_id
                               OR place.nearest_street_edge_id IS DISTINCT FROM fetched_place.nearest_street_edge_id
                               OR place.nearest_street_distance_m
                                  IS DISTINCT FROM fetched_place.nearest_street_distance_m)"""
      // The unchanged ones were seen too; only their timestamp moves, which is not an update worth counting.
      _ <- sqlu"""UPDATE place
                  SET fetched_at = $fetchedAt
                  FROM fetched_place
                  WHERE place.source = 'osm'
                    AND place.osm_type = fetched_place.osm_type AND place.osm_id = fetched_place.osm_id
                    AND place.fetched_at < $fetchedAt"""
      deleted <- sqlu"""DELETE FROM place
                        WHERE place.source = 'osm'
                          AND NOT EXISTS (
                              SELECT 1 FROM fetched_place
                              WHERE fetched_place.osm_type = place.osm_type AND fetched_place.osm_id = place.osm_id
                          )"""
      inserted <- sqlu"""INSERT INTO place (category, name, source, osm_type, osm_id, tags, geom, region_id,
                                            nearest_street_edge_id, nearest_street_distance_m, fetched_at)
                         SELECT category, name, 'osm', osm_type, osm_id, tags, geom, region_id,
                                nearest_street_edge_id, nearest_street_distance_m, $fetchedAt
                         FROM fetched_place
                         WHERE NOT EXISTS (
                             SELECT 1 FROM place
                             WHERE place.osm_type = fetched_place.osm_type AND place.osm_id = fetched_place.osm_id
                         )"""
      total <- places.length.result
    } yield PlaceRefreshCounts(
      fetched = fetched.size, dropped = dropped, total = total, inserted = inserted, updated = updated,
      deleted = deleted
    )
  }

  def newestFetchedAt: DBIO[Option[OffsetDateTime]] =
    places.filter(_.source === "osm").map(_.fetchedAt).max.result

  def regionsExtent: DBIO[Option[LatLngBBox]] =
    sql"""SELECT ST_XMin(extent.box), ST_YMin(extent.box), ST_XMax(extent.box), ST_YMax(extent.box)
          FROM (SELECT ST_Extent(region.geom) AS box FROM region WHERE NOT region.deleted) extent
          WHERE extent.box IS NOT NULL"""
      .as[(Double, Double, Double, Double)]
      .headOption
      .map(_.map { case (minLng, minLat, maxLng, maxLat) => LatLngBBox(minLat, minLng, maxLat, maxLng) })

  def osmPlaceCount: DBIO[Int] = places.filter(_.source === "osm").length.result

  def getPlacesForApi(
      filters: PlaceFiltersForApi
  ): SqlStreamingAction[Vector[PlaceForApi], PlaceForApi, Effect.Read] = {
    val bboxFilter = filters.bbox
      .map { bbox =>
        s"AND ST_Intersects(place.geom, " +
          s"ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
      }
      .getOrElse("")
    val regionIdFilter   = filters.regionId.map(id => s"AND place.region_id = $id").getOrElse("")
    val regionNameFilter = filters.regionName
      .map(name => s"AND LOWER(region.name) = LOWER('${name.replace("'", "''")}')")
      .getOrElse("")
    // Categories are allowlisted against PlaceCategory in the controller, so the literals are catalog ids.
    val categoryFilter = filters.categories
      .map(cs => s"AND place.category IN (${cs.map(c => s"'${c.replace("'", "''")}'").mkString(", ")})")
      .getOrElse("")

    // The region is joined for its name; a place just outside every region (region_id NULL) is still returned unless
    // a region filter asks for one. Numeric filters are safe and the name is single-quote-escaped (see #2756 for
    // moving these to bound parameters).
    val queryStr = s"""
      SELECT place.place_id, place.category, place.name, place.source, place.osm_type, place.osm_id,
             place.region_id, region.name, place.nearest_street_edge_id, place.nearest_street_distance_m,
             place.fetched_at, place.geom
      FROM place
      LEFT JOIN region ON place.region_id = region.region_id
      WHERE TRUE
        $bboxFilter
        $regionIdFilter
        $regionNameFilter
        $categoryFilter
      ORDER BY place.category, place.place_id
    """

    implicit val getPlaceForApi: GetResult[PlaceForApi] = GetResult { r =>
      PlaceForApi(
        placeId = r.nextInt(),
        category = r.nextString(),
        name = r.nextStringOption(),
        source = r.nextString(),
        osmType = r.nextStringOption(),
        osmId = r.nextLongOption(),
        regionId = r.nextIntOption(),
        regionName = r.nextStringOption(),
        nearestStreetEdgeId = r.nextIntOption(),
        nearestStreetDistanceM = r.nextDoubleOption(),
        fetchedAt = OffsetDateTime.ofInstant(r.nextTimestamp().toInstant, ZoneOffset.UTC),
        geometry = r.nextGeometry[Point]()
      )
    }

    sql"""#$queryStr""".as[PlaceForApi]
  }
}
