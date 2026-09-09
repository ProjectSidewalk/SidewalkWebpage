package models.street

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.LineString
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsValue, Json}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/**
 * Cached data about an OSM way, refreshed periodically from the Overpass API (#4654).
 *
 * @param osmWayId  OSM way identifier.
 * @param tags      The way's full OSM tag map, so future features can read name/sidewalk/surface/etc. without
 *                  re-fetching.
 * @param maxspeed  Raw OSM `maxspeed` tag (e.g. "25 mph", "30"); None if the way carries no maxspeed tag.
 * @param geom      Way geometry, present only on rows discovered by the on-demand point lookup (batch rows are located
 *                  via street_edge geometry instead).
 * @param source       How the row was written: "batch" (nightly refresh) or "on_demand" (point-lookup fallback).
 * @param updatedAt    When the way was last fetched from Overpass; drives the staleness-based refresh.
 * @param missingSince When the refresh first found the way absent from OSM (deleted or merged away); None while it is
 *                     present. The tags of a missing way are its last known ones, kept because they still describe
 *                     the street geometry we imported (#5244).
 */
case class OsmWay(
    osmWayId: Long,
    tags: JsValue,
    maxspeed: Option[String],
    geom: Option[LineString],
    source: String,
    updatedAt: OffsetDateTime,
    missingSince: Option[OffsetDateTime]
)

class OsmWayTableDef(tag: Tag) extends Table[OsmWay](tag, "osm_way") {
  def osmWayId: Rep[Long]           = column[Long]("osm_way_id", O.PrimaryKey)
  def tags: Rep[JsValue]            = column[JsValue]("tags", O.Default(Json.obj()))
  def maxspeed: Rep[Option[String]] = column[Option[String]]("maxspeed")
  def geom: Rep[Option[LineString]] = column[Option[LineString]]("geom")
  // CHECK (source IN ('batch', 'on_demand')) in the DB (no Slick DSL for CHECK constraints).
  def source: Rep[String]                       = column[String]("source")
  def updatedAt: Rep[OffsetDateTime]            = column[OffsetDateTime]("updated_at")
  def missingSince: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("missing_since")

  def * = (osmWayId, tags, maxspeed, geom, source, updatedAt, missingSince) <> ((OsmWay.apply _).tupled, OsmWay.unapply)
}

@ImplementedBy(classOf[OsmWayTable])
trait OsmWayTableRepository {}

/**
 * Queries over the cached OSM way data: per-street maxspeed lookups for the Explore/Validate payloads, the
 * missing-or-stale scan that drives the nightly refresh, and the point lookup behind the on-demand fallback.
 */
@Singleton
class OsmWayTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    streetEdgeTable: StreetEdgeTable
)(implicit ec: ExecutionContext)
    extends OsmWayTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val osmWays           = TableQuery[OsmWayTableDef]
  val osmWayStreetEdges = TableQuery[OsmWayStreetEdgeTableDef]

  /**
   * Sub query with columns (street_edge_id, maxspeed): (Int, Option[String]).
   *
   * Left-joined over all streets (like AuditTaskTable.streetCompletedByAnyUser) so consumers can inner-join it as a
   * plain generator without dropping streets that have no osm_way row yet. That guarantee is load-bearing: the
   * NewTask queries in AuditTaskTable all consume this in inner-join position, so removing the left-join wrapper
   * would silently drop every street that lacks a cached OSM way from task selection.
   */
  def streetMaxSpeeds: Query[(Rep[Int], Rep[Option[String]]), (Int, Option[String]), Seq] = {
    val speedByStreet = osmWayStreetEdges
      .join(osmWays)
      .on(_.osmWayId === _.osmWayId)
      .map(x => (x._1.streetEdgeId, x._2.maxspeed))

    streetEdgeTable.streetsWithTutorial.joinLeft(speedByStreet).on(_.streetEdgeId === _._1).map { case (_edge, _sp) =>
      (_edge.streetEdgeId, _sp.flatMap(_._2))
    }
  }

  /**
   * Gets the maxspeed for each of the given streets, keyed by street_edge_id.
   *
   * @return Map from street_edge_id to raw maxspeed tag; streets with no cached way or no maxspeed tag are absent.
   */
  def getMaxSpeeds(streetEdgeIds: Seq[Int]): DBIO[Map[Int, String]] = {
    osmWayStreetEdges
      .filter(_.streetEdgeId inSetBind streetEdgeIds)
      .join(osmWays)
      .on(_.osmWayId === _.osmWayId)
      .map(x => (x._1.streetEdgeId, x._2.maxspeed))
      .result
      .map(_.collect { case (streetEdgeId, Some(maxspeed)) => streetEdgeId -> maxspeed }.toMap)
  }

  /**
   * Gets the distinct way ids from osm_way_street_edge whose osm_way row is missing or last fetched before `cutoff`.
   *
   * Ways marked `missing_since` are included once they go stale like any other: re-asking Overpass for a few hundred
   * dead ids a month is one extra request, and it is what clears the mark if a way comes back.
   */
  def getWayIdsMissingOrStale(cutoff: OffsetDateTime): DBIO[Seq[Long]] = {
    osmWayStreetEdges
      .map(_.osmWayId)
      .distinct
      .joinLeft(osmWays)
      .on(_ === _.osmWayId)
      .filter { case (_, way) => way.map(_.updatedAt < cutoff).getOrElse(true) }
      .map(_._1)
      .result
  }

  /**
   * Finds the nearest way with stored geometry within `radiusM` meters of the given point.
   */
  def getNearestWithGeom(lat: Double, lng: Double, radiusM: Double): DBIO[Option[OsmWay]] = {
    osmWays
      .filter(_.geom.isDefined)
      .map(way => (way, way.geom.distanceSphereD(makePoint(lng.bind, lat.bind).setSRID(4326))))
      .filter(_._2 < radiusM)
      .sortBy(_._2)
      .map(_._1)
      .result
      .headOption
  }

  /**
   * Inserts or updates a single way, including its geometry. Used by the on-demand point-lookup path.
   */
  def upsert(way: OsmWay): DBIO[Int] = osmWays.insertOrUpdate(way)

  /**
   * Records one refresh chunk: the ways Overpass returned, as (osm_way_id, tags, maxspeed) triples written with source
   * 'batch', and the requested ids it did not return, which are marked missing.
   *
   * A found way takes the new tags and loses any `missing_since` mark. A missing way keeps its tags, maxspeed, and
   * source untouched -- the last known tags still describe the geometry we imported, and blanking them silently turned
   * every bridge on a dead way id into a surface street (#5244) -- and gets `missing_since` stamped on the first miss
   * only, so the column dates the disappearance. A missing way never seen before is inserted with empty tags so it is
   * not re-queued nightly. Both paths bump `updated_at`, which is what drives the staleness scan.
   *
   * Raw SQL rather than Slick's insertOrUpdate so that an existing row's geom survives: the nightly batch fetches tags
   * only, and overwriting geom with NULL would throw away the geometry an earlier on-demand lookup stored.
   *
   * @return Number of rows written, found and missing together.
   */
  def upsertBatch(
      found: Seq[(Long, JsValue, Option[String])],
      missingWayIds: Seq[Long],
      timestamp: OffsetDateTime
  ): DBIO[Int] = {
    val foundActions = found.map { case (wayId, tags, maxspeed) =>
      sqlu"""
        INSERT INTO osm_way (osm_way_id, tags, maxspeed, source, updated_at, missing_since)
        VALUES ($wayId, ${Json.stringify(tags)}::jsonb, $maxspeed, 'batch', $timestamp, NULL)
        ON CONFLICT (osm_way_id) DO UPDATE
        SET tags = EXCLUDED.tags, maxspeed = EXCLUDED.maxspeed, source = 'batch', updated_at = EXCLUDED.updated_at,
            missing_since = NULL
      """
    }
    val missingActions = missingWayIds.map { wayId =>
      sqlu"""
        INSERT INTO osm_way (osm_way_id, tags, maxspeed, source, updated_at, missing_since)
        VALUES ($wayId, '{}'::jsonb, NULL, 'batch', $timestamp, $timestamp)
        ON CONFLICT (osm_way_id) DO UPDATE
        SET updated_at = EXCLUDED.updated_at, missing_since = COALESCE(osm_way.missing_since, EXCLUDED.missing_since)
      """
    }
    val actions = foundActions ++ missingActions
    if (actions.isEmpty) DBIO.successful(0)
    else {
      // One transaction per chunk: a single commit instead of one per row, and a failed chunk leaves no partial rows.
      DBIO.sequence(actions).map(_.sum).transactionally
    }
  }
}
