package service

import com.google.inject.ImplementedBy
import models.street.{OsmWay, OsmWayTable, WayType}
import models.utils.MyPostgresProfile
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.pattern.after
import org.locationtech.jts.geom.{Coordinate, GeometryFactory, LineString, PrecisionModel}
import play.api.Logger
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.libs.ws.WSClient

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/**
 * What one run of the OSM way refresh did.
 *
 * @param waysRefreshed Ways whose row was written, present in OSM or not (0 when everything was fresh).
 * @param waysMissing   Of those, ways Overpass did not return: deleted or merged away in OSM since our import. Their
 *                      last known tags are kept and `osm_way.missing_since` is stamped (#5244).
 */
case class OsmWayRefreshResult(waysRefreshed: Int, waysMissing: Int)

@ImplementedBy(classOf[OsmWayServiceImpl])
trait OsmWayService {

  /**
   * Refreshes cached way data for every mapped way whose row is missing or older than `STALENESS_PERIOD`.
   *
   * Fetches tags in chunks of `BATCH_CHUNK_SIZE` ids, sequentially with a delay between chunks. Every requested id is
   * written even when absent from the response, so it won't re-queue nightly: a found way takes its current tags, a
   * missing one keeps its last known tags and is marked `missing_since`. A failed chunk fails the whole run; the next
   * nightly tick retries from whatever is still stale.
   *
   * @return How many ways were written, and how many of them are gone from OSM.
   */
  def refreshOsmWayData(): Future[OsmWayRefreshResult]

  /**
   * Gets the speed limit at a point, for positions not on our street network (the /speedLimit fallback).
   *
   * Checks ways already stored in our DB first; only on a miss does it query Overpass for the nearest road,
   * storing the result (with geometry) so the next lookup nearby is served from the DB. Results — including "no road
   * here" — are cached for a few minutes per rounded coordinate so repeated pano moves at the same spot are free.
   *
   * @return The raw maxspeed tag of the nearest road within `SEARCH_RADIUS_M`; None if no road or no tag, and on any
   *         Overpass failure (this method never propagates an error).
   */
  def getSpeedLimitAtPoint(lat: Double, lng: Double): Future[Option[String]]

  /**
   * Gets the maxspeed for each of the given streets, keyed by street_edge_id. Streets with no known speed are absent.
   */
  def getMaxSpeedsForStreets(streetEdgeIds: Seq[Int]): Future[Map[Int, String]]
}

/**
 * Maintains the cached OSM way data (osm_way table) that backs the speed-limit sign (#4654).
 *
 * Two write paths, both polite to the shared community Overpass instance: a nightly batch refresh that bulk-fetches
 * tags for every way mapped in osm_way_street_edge (monthly per way, via a staleness cutoff), and an on-demand point
 * lookup used when a user wanders onto a street outside our network — checked against our DB first so each unknown
 * spot costs Overpass at most one query ever, across all users.
 */
@Singleton
class OsmWayServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    ws: WSClient,
    cacheApi: AsyncCacheApi,
    actorSystem: ActorSystem,
    osmWayTable: OsmWayTable
)(implicit ec: ExecutionContext)
    extends OsmWayService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  import OsmWayService._

  private val logger = Logger(this.getClass)

  def refreshOsmWayData(): Future[OsmWayRefreshResult] = {
    db.run(osmWayTable.getWayIdsMissingOrStale(OffsetDateTime.now.minusDays(STALENESS_PERIOD_DAYS))).flatMap { wayIds =>
      if (wayIds.isEmpty) { Future.successful(OsmWayRefreshResult(0, 0)) }
      else {
        logger.info(s"Refreshing OSM way data for ${wayIds.size} ways.")
        wayIds
          .grouped(BATCH_CHUNK_SIZE)
          .zipWithIndex
          .foldLeft(Future.successful(OsmWayRefreshResult(0, 0))) { case (accFuture, (chunk, chunkIdx)) =>
            for {
              acc <- accFuture
              // Space out requests to the shared Overpass instance; no delay before the first chunk.
              _ <- if (chunkIdx == 0) Future.unit else after(BATCH_CHUNK_DELAY, actorSystem.scheduler)(Future.unit)
              fetched <- fetchTagsForWaysWithRetry(chunk)
              split = chunk.partition(fetched.contains)
              rows  = split._1.map { wayId =>
                val tags = fetched(wayId)
                (wayId, tags: JsValue, maxspeedFrom(tags))
              }
              n <- db.run(osmWayTable.upsertBatch(rows, split._2, OffsetDateTime.now))
            } yield OsmWayRefreshResult(acc.waysRefreshed + n, acc.waysMissing + split._2.size)
          }
          .map { result =>
            // A dead way id is normal OSM churn, but a jump in this count means a re-match (#5244) is overdue.
            if (result.waysMissing > 0) {
              logger.warn(
                s"${result.waysMissing} of ${result.waysRefreshed} refreshed OSM ways no longer exist in OSM " +
                  "(deleted or merged away); kept their last known tags and marked them missing."
              )
            }
            result
          }
      }
    }
  }

  def getSpeedLimitAtPoint(lat: Double, lng: Double): Future[Option[String]] = {
    val cacheKey = f"speedLimitAtPoint:$lat%.4f,$lng%.4f"
    cacheApi.getOrElseUpdate[Option[String]](cacheKey, POINT_CACHE_TTL) {
      db.run(osmWayTable.getNearestWithGeom(lat, lng, SEARCH_RADIUS_M))
        .flatMap {
          case Some(way) => Future.successful(way.maxspeed)
          case None      => queryAndStoreNearestRoad(lat, lng)
        }
        .recover { case NonFatal(e) =>
          logger.warn(s"Speed limit lookup failed for ($lat, $lng); returning no speed limit.", e)
          None
        }
    }
  }

  def getMaxSpeedsForStreets(streetEdgeIds: Seq[Int]): Future[Map[Int, String]] = {
    db.run(osmWayTable.getMaxSpeeds(streetEdgeIds))
  }

  /**
   * Fetches a chunk's tags, retrying transient failures — the shared Overpass instance sheds load with 429s/504s
   * routinely, so one bad response shouldn't sink a whole run. Waits BATCH_RETRY_DELAY x attempt between tries to
   * give a loaded server breathing room.
   */
  private def fetchTagsForWaysWithRetry(wayIds: Seq[Long], attempt: Int = 1): Future[Map[Long, JsObject]] = {
    fetchTagsForWays(wayIds).recoverWith {
      case NonFatal(e) if attempt < BATCH_MAX_ATTEMPTS =>
        logger.warn(s"Overpass batch attempt $attempt/$BATCH_MAX_ATTEMPTS failed (${e.getMessage}); retrying.")
        after(BATCH_RETRY_DELAY * attempt.toLong, actorSystem.scheduler)(fetchTagsForWaysWithRetry(wayIds, attempt + 1))
    }
  }

  /**
   * Fetches the full tag map for the given way ids from Overpass, keyed by way id.
   *
   * Ways absent from a complete response are gone from OSM (deleted or merged away) and are simply missing from the
   * returned map. A cut-short response is a failure, not a list of dead ways: Overpass reports a query that timed out
   * or ran out of memory as HTTP 200 with whatever elements it had reached plus a top-level `remark` (measured: a
   * 1-second-budget query came back `200`, zero elements, `remark: runtime error: Query timed out ...`), and reading
   * that as "every requested way is missing" would stamp a whole chunk `missing_since` in one bad night.
   */
  private def fetchTagsForWays(wayIds: Seq[Long]): Future[Map[Long, JsObject]] = {
    val query = s"[out:json][timeout:180];way(id:${wayIds.mkString(",")});out tags;"
    ws.url(OVERPASS_URL)
      .withRequestTimeout(3.minutes)
      .post(Map("data" -> Seq(query)))
      .map { response =>
        if (response.status != 200) {
          throw new RuntimeException(s"Overpass batch query failed with status ${response.status}.")
        }
        val json: JsValue = Json.parse(response.body)
        truncationRemark(json).foreach { remark =>
          throw new RuntimeException(s"Overpass batch query was cut short: $remark")
        }
        parseBatchResponse(json)
      }
  }

  /**
   * Queries Overpass for roads within `SEARCH_RADIUS_M` of the point, stores the nearest one (with geometry, so later
   * lookups nearby hit our DB), and returns its maxspeed tag.
   */
  private def queryAndStoreNearestRoad(lat: Double, lng: Double): Future[Option[String]] = {
    val query = s"[out:json][timeout:10];way['highway'](around:$SEARCH_RADIUS_M,$lat,$lng);out geom;"
    ws.url(OVERPASS_URL)
      .withRequestTimeout(15.seconds)
      .post(Map("data" -> Seq(query)))
      .flatMap { response =>
        if (response.status != 200) {
          throw new RuntimeException(s"Overpass point query failed with status ${response.status}.")
        }
        pickNearestRoad(Json.parse(response.body), lat, lng) match {
          case Some((wayId, tags, geom)) =>
            val maxspeed = maxspeedFrom(tags)
            db.run(osmWayTable.upsert(OsmWay(wayId, tags, maxspeed, Some(geom), "on_demand", OffsetDateTime.now, None)))
              .map(_ => maxspeed)
          case None => Future.successful(None)
        }
      }
  }
}

/**
 * Pure parsing/selection logic for Overpass API responses, kept free of I/O so it can be unit-tested directly.
 */
object OsmWayService {
  val OVERPASS_URL = "https://overpass-api.de/api/interpreter"

  /** How close (meters) a road must be to a queried point to count as "here"; also the DB point-lookup radius. */
  val SEARCH_RADIUS_M: Double = 15.0

  /** Refresh each way monthly; OSM speed limits change slowly. */
  val STALENESS_PERIOD_DAYS: Long = 30

  /** Way ids per Overpass batch request, and the pause between consecutive requests. */
  val BATCH_CHUNK_SIZE: Int             = 300
  val BATCH_CHUNK_DELAY: FiniteDuration = 2.seconds

  /** Retry budget for one chunk's fetch, with a delay that grows linearly per attempt. */
  val BATCH_MAX_ATTEMPTS: Int           = 3
  val BATCH_RETRY_DELAY: FiniteDuration = 15.seconds

  /** Per-coordinate cache TTL for the on-demand point lookup (doubles as a negative cache for "no road here"). */
  val POINT_CACHE_TTL: FiniteDuration = 10.minutes

  /**
   * OSM highway values that count as drivable roads for the speed-limit sign; footpaths/cycleways etc. are excluded.
   */
  val ROAD_HIGHWAY_TYPES: Set[String] = Set(
    WayType.Motorway, WayType.Trunk, WayType.Primary, WayType.Secondary, WayType.Tertiary, WayType.Unclassified,
    WayType.Residential, WayType.MotorwayLink, WayType.TrunkLink, WayType.PrimaryLink, WayType.SecondaryLink,
    WayType.TertiaryLink, WayType.LivingStreet, WayType.Road
  ).map(_.toString)

  private val geometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
   * The `remark` Overpass attaches to a response it could not complete (a timeout or memory limit hit mid-query), or
   * None for a complete one. Its presence means the element list is partial, so absence from it proves nothing.
   */
  def truncationRemark(json: JsValue): Option[String] = (json \ "remark").asOpt[String].filter(_.nonEmpty)

  /**
   * Parses a batch `out tags;` Overpass response into a map from way id to its tag map.
   */
  def parseBatchResponse(json: JsValue): Map[Long, JsObject] = {
    (json \ "elements")
      .asOpt[Seq[JsObject]]
      .getOrElse(Seq.empty)
      .filter(el => (el \ "type").asOpt[String].contains("way"))
      .flatMap { el => (el \ "id").asOpt[Long].map { id => id -> (el \ "tags").asOpt[JsObject].getOrElse(Json.obj()) } }
      .toMap
  }

  /**
   * Extracts the raw maxspeed tag from a way's tag map. The single extraction point for both write paths, so the
   * maxspeed column can never drift from the stored tags.
   */
  def maxspeedFrom(tags: JsObject): Option[String] = (tags \ "maxspeed").asOpt[String]

  /**
   * Picks the road nearest to (lat, lng) from an `out geom;` Overpass response.
   *
   * Only ways whose `highway` tag is in `ROAD_HIGHWAY_TYPES` are considered, and ways need at least two geometry
   * points. Distance is compared in degrees, which is fine for ranking candidates within a few dozen meters.
   *
   * @return The nearest road's (way id, tag map, geometry), or None if the response has no qualifying road.
   */
  def pickNearestRoad(json: JsValue, lat: Double, lng: Double): Option[(Long, JsObject, LineString)] = {
    val point = geometryFactory.createPoint(new Coordinate(lng, lat))

    val roads = (json \ "elements")
      .asOpt[Seq[JsObject]]
      .getOrElse(Seq.empty)
      .filter { el =>
        (el \ "type").asOpt[String].contains("way") &&
        (el \ "tags" \ "highway").asOpt[String].exists(ROAD_HIGHWAY_TYPES.contains)
      }
      .flatMap { el =>
        for {
          id     <- (el \ "id").asOpt[Long]
          coords <- (el \ "geometry").asOpt[Seq[JsObject]]
          points = coords.flatMap { c =>
            for {
              pLat <- (c \ "lat").asOpt[Double]
              pLng <- (c \ "lon").asOpt[Double]
            } yield new Coordinate(
              pLng,
              pLat
            )
          }
          if points.size >= 2
        } yield {
          val tags = (el \ "tags").asOpt[JsObject].getOrElse(Json.obj())
          (id, tags, geometryFactory.createLineString(points.toArray))
        }
      }

    if (roads.isEmpty) None else Some(roads.minBy(_._3.distance(point)))
  }
}
