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
import scala.util.{Failure, Success}

/**
 * What one run of the OSM way refresh did.
 *
 * @param waysRefreshed     Ways whose row was written, present in OSM or not (0 when everything was fresh).
 * @param waysMissing       Of those, ways the OSM API reports gone: deleted or merged away in OSM since our import.
 *                          Their last known tags are kept and `osm_way.missing_since` is stamped (#5244).
 * @param tagsRecovered     Gone ways whose lost tags were recovered from the OSM history in this run.
 * @param tagsUnrecoverable Gone ways looked up in the OSM history this run that had nothing usable there. Marked so
 *                          they are not asked about again.
 */
case class OsmWayRefreshResult(waysRefreshed: Int, waysMissing: Int, tagsRecovered: Int, tagsUnrecoverable: Int) {
  def +(other: OsmWayRefreshResult): OsmWayRefreshResult = OsmWayRefreshResult(
    waysRefreshed + other.waysRefreshed,
    waysMissing + other.waysMissing,
    tagsRecovered + other.tagsRecovered,
    tagsUnrecoverable + other.tagsUnrecoverable
  )
}

object OsmWayRefreshResult {
  val empty: OsmWayRefreshResult = OsmWayRefreshResult(0, 0, 0, 0)
}

@ImplementedBy(classOf[OsmWayServiceImpl])
trait OsmWayService {

  /**
   * Refreshes cached way data for every mapped way whose row is missing or older than `STALENESS_PERIOD`, then
   * recovers the tags of gone ways that lost them.
   *
   * The refresh fetches tags from the main OSM API by id, in chunks of `BATCH_CHUNK_SIZE`, sequentially with a delay
   * between chunks. Every requested id is written, so it won't re-queue nightly: a found way takes its current tags,
   * a way the API reports deleted (or never held) keeps its last known tags and is marked `missing_since`.
   *
   * The backfill then takes every mapped way that is marked missing but still has empty tags -- blanked before the
   * refresh learned to keep them, or gone before it ever saw them -- and asks the OSM API for the way's history, one
   * id at a time with a delay between requests, storing the tags of its last visible version (#5244 step 2). A
   * deleted way's final tags describe the same geometry we imported, so a bridge comes back as a bridge; nothing is
   * matched to whatever OSM holds there now. That includes `maxspeed`: the sign then shows the last limit OSM
   * recorded for that road, which is also what the refresh keeps for a way that dies from now on. A way whose
   * history has nothing usable is marked too, so each id costs one lookup ever.
   *
   * A failed chunk or lookup fails the whole run; the next nightly tick resumes from whatever is still stale or
   * unrecovered.
   *
   * @return How many ways were written and how many of them are gone from OSM, plus how many gone ways had their
   *         tags recovered and how many turned out unrecoverable.
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
 * Two write paths. A nightly batch refresh fetches tags for every way mapped in osm_way_street_edge (monthly per way,
 * via a staleness cutoff) from the main OSM API, whose multi-fetch is built for exactly this fetch-by-id and reports
 * a deleted way as such; the shared community Overpass instance is a query engine, and asking it for ids was what
 * got ~57 deployments refused (#5237). An on-demand point lookup, used when a user wanders onto a street outside
 * our network, is the one thing that still needs Overpass (a spatial query) — checked against our DB first so each
 * unknown spot costs Overpass at most one query ever, across all users.
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
    // Either phase can fail on the network, and a failure in one must not cost the other its work: both run, and the
    // run fails afterwards if either did. The run record then carries the first failure and no counts (JobRunService
    // stores details on success only), so each phase logs its own counts, and a second failure is logged here rather
    // than lost behind the first.
    for {
      refreshed <- refreshFromOsmApi().transform(Success(_))
      recovered <- backfillMissingTags().transform(Success(_))
      result    <- (refreshed, recovered) match {
        case (Failure(first), Failure(second)) =>
          logger.error("The OSM history backfill failed too, behind the refresh's own failure.", second)
          Future.failed(first)
        case _ =>
          Future.fromTry(for {
            r <- refreshed
            b <- recovered
          } yield r + b)
      }
    } yield result
  }

  /**
   * Phase one: re-fetches every stale mapped way's tags from the main OSM API, chunked and paced, marking the ways
   * it reports deleted (or never held) as missing.
   */
  private def refreshFromOsmApi(): Future[OsmWayRefreshResult] = {
    db.run(osmWayTable.getWayIdsMissingOrStale(OffsetDateTime.now.minusDays(STALENESS_PERIOD_DAYS))).flatMap { wayIds =>
      if (wayIds.isEmpty) { Future.successful(OsmWayRefreshResult.empty) }
      else {
        logger.info(s"Refreshing OSM way data for ${wayIds.size} ways.")
        wayIds
          .grouped(BATCH_CHUNK_SIZE)
          .zipWithIndex
          .foldLeft(Future.successful(OsmWayRefreshResult.empty)) { case (accFuture, (chunk, chunkIdx)) =>
            for {
              acc <- accFuture
              // Space out requests to the shared API; no delay before the first chunk.
              _ <- if (chunkIdx == 0) Future.unit else after(BATCH_CHUNK_DELAY, actorSystem.scheduler)(Future.unit)
              fetched <- fetchSplittingOnNotFound(chunk)(
                fetchTagsForWaysWithRetry(_),
                () => after(BATCH_CHUNK_DELAY, actorSystem.scheduler)(Future.unit)
              )
              // Every id in a multi-id chunk answering 404 is an API that is not itself (a maintenance page, a
              // proxy), not a chunk of ids that never existed; treating it as the latter would mark a whole city
              // missing in one night. A lone bad id is a real data defect and is named.
              _ = if (chunk.size > 1 && fetched.neverHeld.size == chunk.size) {
                throw new RuntimeException(
                  s"The OSM API answered 404 for every one of ${chunk.size} ways in a chunk; treating the API as down."
                )
              }
              _ = if (fetched.neverHeld.nonEmpty) {
                logger.warn(
                  s"The OSM API has never held mapped way ids ${fetched.neverHeld.mkString(", ")}; marked missing."
                )
              }
              split = chunk.partition(fetched.live.contains)
              rows  = split._1.map { wayId =>
                val tags = fetched.live(wayId)
                (wayId, tags: JsValue, maxspeedFrom(tags))
              }
              n <- db.run(osmWayTable.upsertBatch(rows, split._2, OffsetDateTime.now))
            } yield acc + OsmWayRefreshResult(n, split._2.size, 0, 0)
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

  /**
   * Phase two: recovers the tags of gone ways that have none, from the OSM API's way history (#5244 step 2).
   *
   * One request per way, sequential, with `HISTORY_REQUEST_DELAY` between them: the main OSM API is not built for
   * bulk reads, and the candidate set is a few hundred ids per city once, then whatever dies before its first fetch.
   * Each way is written as soon as its history is read, so a failure partway keeps what was recovered and the next
   * run resumes from the rest.
   */
  private def backfillMissingTags(): Future[OsmWayRefreshResult] = {
    db.run(osmWayTable.getWayIdsToBackfill).flatMap { wayIds =>
      if (wayIds.isEmpty) { Future.successful(OsmWayRefreshResult.empty) }
      else {
        logger.info(s"Recovering tags for ${wayIds.size} OSM ways that are gone from OSM, from their history.")
        wayIds.zipWithIndex
          .foldLeft(Future.successful(OsmWayRefreshResult.empty)) { case (accFuture, (wayId, idx)) =>
            for {
              acc     <- accFuture
              _       <- if (idx == 0) Future.unit else after(HISTORY_REQUEST_DELAY, actorSystem.scheduler)(Future.unit)
              history <- fetchWayHistoryWithRetry(wayId)
              tags = history.flatMap(lastVisibleTags)
              written <- db.run(osmWayTable.recordHistoryTags(wayId, tags, tags.flatMap(maxspeedFrom)))
            } yield {
              if (written == 0) {
                // Another run's refresh got to the row first (the way came back, or its history was already read).
                logger.info(s"OSM way $wayId was no longer waiting for its history by the time it was read; skipped.")
                acc
              } else {
                if (tags.isEmpty) {
                  logger.warn(s"OSM way $wayId is gone from OSM and its history holds no tags; nothing to recover.")
                }
                acc + OsmWayRefreshResult(0, 0, if (tags.isDefined) 1 else 0, if (tags.isEmpty) 1 else 0)
              }
            }
          }
          .map { result =>
            logger.info(
              s"Recovered tags for ${result.tagsRecovered} gone OSM ways from their history; " +
                s"${result.tagsUnrecoverable} had nothing to recover."
            )
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
   * Fetches a chunk's tags, retrying transient failures (a 429, a 5xx, a timeout) so one bad response doesn't sink a
   * whole run. Waits BATCH_RETRY_DELAY x attempt between tries to give a loaded server breathing room. A 404 is an
   * answer, not a failure, and is passed through for the caller to split on.
   */
  private def fetchTagsForWaysWithRetry(wayIds: Seq[Long], attempt: Int = 1): Future[Option[Map[Long, JsObject]]] = {
    fetchTagsForWays(wayIds).recoverWith {
      case NonFatal(e) if attempt < BATCH_MAX_ATTEMPTS =>
        logger.warn(s"OSM API batch attempt $attempt/$BATCH_MAX_ATTEMPTS failed (${e.getMessage}); retrying.")
        after(BATCH_RETRY_DELAY * attempt.toLong, actorSystem.scheduler)(fetchTagsForWaysWithRetry(wayIds, attempt + 1))
    }
  }

  /**
   * Fetches the current version of each given way from the main OSM API's multi-fetch, keyed by way id.
   *
   * A way that has been deleted comes back with `visible: false` and no tags, and is left out of the returned map,
   * which is how the caller learns it is gone. A way id the API has never held makes the whole request a 404 without
   * saying which id (measured 2026-09-09: one bad id among live ones, 404), so that is reported as None for
   * `fetchSplittingOnNotFound` to narrow down rather than treated as an error.
   *
   * @return The live ways' tag maps, or None when some requested id has never existed.
   */
  private def fetchTagsForWays(wayIds: Seq[Long]): Future[Option[Map[Long, JsObject]]] = {
    ws.url(s"$OSM_API_URL/ways.json?ways=${wayIds.mkString(",")}")
      .addHttpHeaders("User-Agent" -> OutboundHttp.UserAgent)
      .withRequestTimeout(1.minute)
      .get()
      .map { response =>
        response.status match {
          case 200   => Some(parseWaysResponse(Json.parse(response.body)))
          case 404   => None
          case other => throw new RuntimeException(s"OSM API batch query failed with status $other.")
        }
      }
  }

  /**
   * Fetches a way's history, retrying transient failures with the same budget and spacing as the batch chunks.
   * A 404 is an answer (the id never existed), not a failure, and is not retried.
   */
  private def fetchWayHistoryWithRetry(wayId: Long, attempt: Int = 1): Future[Option[JsValue]] = {
    fetchWayHistory(wayId).recoverWith {
      case NonFatal(e) if attempt < BATCH_MAX_ATTEMPTS =>
        logger.warn(
          s"OSM history attempt $attempt/$BATCH_MAX_ATTEMPTS for way $wayId failed (${e.getMessage}); retrying."
        )
        after(BATCH_RETRY_DELAY * attempt.toLong, actorSystem.scheduler)(fetchWayHistoryWithRetry(wayId, attempt + 1))
    }
  }

  /**
   * Fetches every version of a way from the main OSM API, deleted versions included.
   *
   * A 200 whose body is not a history document (no `elements` array: a gateway page, a truncated body) is a failure
   * to retry, not an empty history. Reading it as "nothing to recover" would mark the way checked and never ask
   * again, which is the one outcome of this phase that no later run corrects.
   *
   * @return The history document, or None when the API has never held a way with this id (404).
   */
  private def fetchWayHistory(wayId: Long): Future[Option[JsValue]] = {
    ws.url(s"$OSM_API_URL/way/$wayId/history.json")
      .addHttpHeaders("User-Agent" -> OutboundHttp.UserAgent)
      .withRequestTimeout(30.seconds)
      .get()
      .map { response =>
        response.status match {
          case 200 =>
            val json = Json.parse(response.body)
            if ((json \ "elements").asOpt[Seq[JsValue]].isEmpty) {
              throw new RuntimeException(s"OSM history response for way $wayId has no elements array.")
            }
            Some(json)
          case 404   => None
          case other => throw new RuntimeException(s"OSM history query for way $wayId failed with status $other.")
        }
      }
  }

  /**
   * Queries Overpass for roads within `SEARCH_RADIUS_M` of the point, stores the nearest one (with geometry, so later
   * lookups nearby hit our DB), and returns its maxspeed tag.
   */
  private def queryAndStoreNearestRoad(lat: Double, lng: Double): Future[Option[String]] = {
    val query = s"[out:json][timeout:10];way['highway'](around:$SEARCH_RADIUS_M,$lat,$lng);out geom;"
    ws.url(OVERPASS_URL)
      .addHttpHeaders("User-Agent" -> OutboundHttp.UserAgent)
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
 * Pure parsing/selection logic for OSM API and Overpass responses, kept free of I/O so it can be unit-tested directly.
 */
object OsmWayService {
  val OVERPASS_URL = "https://overpass-api.de/api/interpreter"

  /** How close (meters) a road must be to a queried point to count as "here"; also the DB point-lookup radius. */
  val SEARCH_RADIUS_M: Double = 15.0

  /** Refresh each way monthly; OSM speed limits change slowly. */
  val STALENESS_PERIOD_DAYS: Long = 30

  /** Way ids per OSM API multi-fetch request, and the pause between consecutive requests. */
  val BATCH_CHUNK_SIZE: Int             = 300
  val BATCH_CHUNK_DELAY: FiniteDuration = 2.seconds

  /** Retry budget for one chunk's fetch, with a delay that grows linearly per attempt. */
  val BATCH_MAX_ATTEMPTS: Int           = 3
  val BATCH_RETRY_DELAY: FiniteDuration = 15.seconds

  /** Per-coordinate cache TTL for the on-demand point lookup (doubles as a negative cache for "no road here"). */
  val POINT_CACHE_TTL: FiniteDuration = 10.minutes

  /** The main OSM API (not Overpass): the one place a deleted way's history can still be read (#5244). */
  val OSM_API_URL = "https://api.openstreetmap.org/api/0.6"

  /** Pause between consecutive history requests; they go one way at a time to an API not meant for bulk reads. */
  val HISTORY_REQUEST_DELAY: FiniteDuration = 500.millis

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
   * Parses an OSM API multi-fetch (`/ways.json?ways=…`) response into a map from way id to its tag map, for the
   * ways that still exist. A deleted way is returned with `visible: false` and no tags; it is left out, so absence
   * from the result means "gone from OSM". A live way with no `tags` field maps to an empty tag map.
   *
   * A body with no `elements` array is not a multi-fetch response (a gateway page, a truncated body) and throws, so
   * the caller retries rather than reading every requested way as gone.
   */
  def parseWaysResponse(json: JsValue): Map[Long, JsObject] = {
    (json \ "elements")
      .asOpt[Seq[JsObject]]
      .getOrElse(throw new RuntimeException("OSM API multi-fetch response has no elements array."))
      .filter { el => (el \ "type").asOpt[String].contains("way") && (el \ "visible").asOpt[Boolean].getOrElse(true) }
      .flatMap { el => (el \ "id").asOpt[Long].map { id => id -> (el \ "tags").asOpt[JsObject].getOrElse(Json.obj()) } }
      .toMap
  }

  /**
   * What a chunk fetch settled: the live ways' tags, and the ids the API has never held.
   *
   * A way that is neither live nor never-held was deleted (returned with `visible: false`). The caller marks both
   * kinds missing, but only the never-held ones are worth a warning and the whole-chunk sanity check.
   */
  case class ChunkFetch(live: Map[Long, JsObject], neverHeld: Seq[Long])

  /**
   * Fetches a chunk of way ids, narrowing down any id the API has never held.
   *
   * The multi-fetch answers 404 for the whole request when one requested id has never existed, without naming it. A
   * chunk that comes back None is split in two and each half fetched in turn, with `pause` before each of those
   * extra requests, down to a single id whose 404 names it. A bad id costs about 2·log2(chunk size) extra requests
   * (both halves at each level are fetched); once its row is marked, `getWayIdsMissingOrStale` stops re-asking.
   *
   * @param wayIds The chunk to fetch.
   * @param fetch  One request: the live ways' tags by id, or None when the API answered 404.
   * @param pause  Run before every request after the first, so a narrowing is paced like the chunks are.
   * @return       The live ways' tags for every id the API holds, and the ids it has never held.
   */
  def fetchSplittingOnNotFound(wayIds: Seq[Long])(
      fetch: Seq[Long] => Future[Option[Map[Long, JsObject]]],
      pause: () => Future[Unit] = () => Future.unit
  )(implicit ec: ExecutionContext): Future[ChunkFetch] = {
    fetch(wayIds).flatMap {
      case Some(found)              => Future.successful(ChunkFetch(found, Nil))
      case None if wayIds.size <= 1 => Future.successful(ChunkFetch(Map.empty, wayIds))
      case None                     =>
        val (left, right) = wayIds.splitAt(wayIds.size / 2)
        for {
          _ <- pause()
          l <- fetchSplittingOnNotFound(left)(fetch, pause)
          _ <- pause()
          r <- fetchSplittingOnNotFound(right)(fetch, pause)
        } yield ChunkFetch(l.live ++ r.live, l.neverHeld ++ r.neverHeld)
    }
  }

  /**
   * Picks, from an OSM API way-history document, the tags that best describe the way as it was last mapped.
   *
   * A deleted version carries `visible: false` and no tags, and a live one omits `visible`. Of the visible versions
   * with tags, the highest-numbered one that still carries `highway` wins, so a way retagged out of the road network
   * just before deletion is read as the road it was (our street is still one); failing that, the highest-numbered one
   * with any tags at all.
   *
   * @return The chosen version's tag map, or None when no visible version carried tags.
   */
  def lastVisibleTags(history: JsValue): Option[JsObject] = {
    val tagged = (history \ "elements")
      .asOpt[Seq[JsObject]]
      .getOrElse(Seq.empty)
      .filter { el => (el \ "type").asOpt[String].contains("way") && (el \ "visible").asOpt[Boolean].getOrElse(true) }
      .flatMap { el =>
        for {
          version <- (el \ "version").asOpt[Long]
          tags    <- (el \ "tags").asOpt[JsObject] if tags.keys.nonEmpty
        } yield (version, tags)
      }
    val roads = tagged.filter { case (_, tags) => tags.keys.contains("highway") }
    (if (roads.nonEmpty) roads else tagged).maxByOption(_._1).map(_._2)
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
