package service

import com.google.inject.ImplementedBy
import models.api.{PlaceFiltersForApi, PlaceForApi}
import models.place.{FetchedPlace, PlaceCategory, PlaceTable}
import models.utils.LatLngBBox
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.pattern.after
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink
import org.locationtech.jts.geom.{Coordinate, GeometryFactory, PrecisionModel}
import play.api.Logger
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.libs.ws.WSClient

import java.time.OffsetDateTime
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/**
 * What a run of the places refresh did (#5311).
 *
 * @param skipped   True when the table was fresh enough that nothing was fetched; the counts are then the table's.
 * @param fetched   Objects Overpass returned that resolved to a category.
 * @param dropped   Of those, the ones outside the city (farther than 250 m from every region).
 * @param total     Rows in the table afterwards.
 * @param inserted  Places seen for the first time.
 * @param updated   Places whose category, name, tags, position, region, or nearest street changed.
 * @param deleted   Places absent from the fetch.
 * @param fetchedAt When the places were fetched: this run, or the last one when skipped.
 */
case class PlacesRefreshResult(
    skipped: Boolean,
    fetched: Int,
    dropped: Int,
    total: Int,
    inserted: Int,
    updated: Int,
    deleted: Int,
    fetchedAt: Option[OffsetDateTime]
) {

  /**
   * The counts as they are stored against a `background_job_run` row.
   *
   * @return The run's `details` object.
   */
  def runDetails: JsObject = Json.obj(
    "skipped"    -> skipped,
    "fetched"    -> fetched,
    "dropped"    -> dropped,
    "total"      -> total,
    "inserted"   -> inserted,
    "updated"    -> updated,
    "deleted"    -> deleted,
    "fetched_at" -> fetchedAt
  )
}

@ImplementedBy(classOf[PlacesServiceImpl])
trait PlacesService {

  /**
   * Fetches the city's places from OpenStreetMap and merges them into the `place` table, in one transaction.
   *
   * At most one run at a time: a second call while one is in flight fails with [[IllegalStateException]].
   *
   * @param force True to fetch whatever the table's age; false (the nightly tick) skips a fetch when the newest
   *              place was fetched within [[PlacesService.RefreshAfterDays]] days.
   */
  def refresh(force: Boolean): Future[PlacesRefreshResult]

  /** Whether a refresh is in flight. */
  def isRunning: Boolean

  /**
   * Every place in the city, served from the cache the AccessScore tool's one full-city download hits.
   *
   * @param batchSize DB fetch size for the stream behind a recompute.
   */
  def getFullCityPlaces(batchSize: Int): Future[Seq[PlaceForApi]]
}

/**
 * Keeps the `place` table current from OpenStreetMap (#5311).
 *
 * One Overpass query per run covers the city's bounding box for every catalog tag, so a city needs nothing at
 * onboarding: the first nightly tick after the table exists fills it, and the weekly cadence after that is plenty
 * for data that changes by the month. Overpass is a shared, community-run service, which is why the nightly tick
 * asks it nothing when the table is fresh, and why one query with a long server-side timeout is preferred to many.
 */
@Singleton
class PlacesServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    ws: WSClient,
    cacheApi: AsyncCacheApi,
    swrCache: SwrCache,
    actorSystem: ActorSystem,
    configService: ConfigService,
    apiService: ApiService,
    placeTable: PlaceTable
)(implicit ec: ExecutionContext, mat: Materializer)
    extends PlacesService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  import PlacesService._

  private val logger  = Logger(this.getClass)
  private val running = new AtomicBoolean(false)

  def isRunning: Boolean = running.get()

  def refresh(force: Boolean): Future[PlacesRefreshResult] = {
    if (!running.compareAndSet(false, true)) {
      Future.failed(new IllegalStateException("A places refresh is already in progress."))
    } else {
      // Future.delegate so a synchronous throw while building the work still releases the guard.
      Future
        .delegate {
          db.run(placeTable.newestFetchedAt).flatMap { newest =>
            val fresh = !force && newest.exists(_.isAfter(OffsetDateTime.now.minusDays(RefreshAfterDays)))
            if (fresh) skippedResult(newest) else fetchAndMerge()
          }
        }
        .andThen { case _ => running.set(false) }
    }
  }

  def getFullCityPlaces(batchSize: Int): Future[Seq[PlaceForApi]] =
    swrCache.staleWhileRevalidate[Seq[PlaceForApi]](FullCityCacheKey, FullCityFreshFor, FullCityMaxAge) {
      apiService.getPlaces(PlaceFiltersForApi(), batchSize).runWith(Sink.seq)
    }

  /** The result of a tick that found the table fresh: the table's own counts, nothing fetched. */
  private def skippedResult(newest: Option[OffsetDateTime]): Future[PlacesRefreshResult] =
    db.run(placeTable.osmPlaceCount).map { total =>
      PlacesRefreshResult(
        skipped = true, fetched = 0, dropped = 0, total = total, inserted = 0, updated = 0, deleted = 0,
        fetchedAt = newest
      )
    }

  private def fetchAndMerge(): Future[PlacesRefreshResult] = {
    val fetchedAt = OffsetDateTime.now
    for {
      bbox <- configService.getCityMapParams.map { p =>
        LatLngBBox(
          minLat = math.min(p.lat1, p.lat2),
          minLng = math.min(p.lng1, p.lng2),
          maxLat = math.max(p.lat1, p.lat2),
          maxLng = math.max(p.lng1, p.lng2)
        )
      }
      json <- fetchWithRetry(overpassQuery(bbox))
      fetched = parseOverpass(json)
      existing <- db.run(placeTable.osmPlaceCount)
      // A query that comes back empty for a city that had places is a broken query or a truncated answer, not a
      // city whose every school closed; keeping last week's rows beats an empty map.
      _ = if (fetched.isEmpty && existing > 0)
        throw new RuntimeException(s"Overpass returned no places for a city that has $existing; keeping them.")
      counts <- db.run(placeTable.replaceOsmPlaces(fetched, fetchedAt).transactionally)
      // The cached full-city list is now last week's. A recompute already in flight can re-store the old rows for
      // one more fresh-window (SwrCache coalesces on the key); the next request past FullCityFreshFor corrects it.
      _ <- cacheApi.remove(FullCityCacheKey)
    } yield PlacesRefreshResult(
      skipped = false, fetched = counts.fetched, dropped = counts.dropped, total = counts.total,
      inserted = counts.inserted, updated = counts.updated, deleted = counts.deleted, fetchedAt = Some(fetchedAt)
    )
  }

  /**
   * Sends the Overpass query, retrying a failed attempt with a growing pause, since the public instance answers
   * 429 or 504 when it is busy and is usually fine a minute later.
   */
  private def fetchWithRetry(query: String, attempt: Int = 1): Future[JsValue] = {
    fetch(query).recoverWith {
      case NonFatal(e) if attempt < MaxAttempts =>
        logger.warn(s"Overpass places query attempt $attempt/$MaxAttempts failed (${e.getMessage}); retrying.")
        after(RetryDelay * attempt.toLong, actorSystem.scheduler)(fetchWithRetry(query, attempt + 1))
    }
  }

  private def fetch(query: String): Future[JsValue] = {
    ws.url(OutboundHttp.OverpassUrl)
      .addHttpHeaders("User-Agent" -> OutboundHttp.UserAgent)
      // Past the query's own server-side timeout, so a slow answer is Overpass giving up, never us hanging up on it.
      .withRequestTimeout(RequestTimeout)
      .post(Map("data" -> Seq(query)))
      .map { response =>
        if (response.status != 200) {
          throw new RuntimeException(s"Overpass places query failed with status ${response.status}.")
        }
        Json.parse(response.body)
      }
  }
}

/**
 * The query and the parsing behind the places refresh, kept free of I/O so they can be unit-tested directly.
 */
object PlacesService {

  /** A fetch newer than this is fresh: the nightly tick asks Overpass nothing. Places change by the month. */
  val RefreshAfterDays: Long = 7

  /** The Overpass-side budget for the query, and ours, which must outlast it. */
  val OverpassTimeoutSeconds: Int    = 180
  val RequestTimeout: FiniteDuration = 200.seconds
  val MaxAttempts: Int               = 3
  val RetryDelay: FiniteDuration     = 30.seconds

  /** The whole-city list is what the AccessScore tool downloads once per visit; a refresh clears it. */
  val FullCityCacheKey: String         = "places:full-city:v1"
  val FullCityFreshFor: FiniteDuration = 10.minutes
  val FullCityMaxAge: FiniteDuration   = 24.hours

  private val geometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
   * The Overpass QL query for every catalog place in a bounding box: one union of `nwr` selectors, one per tag
   * rule, answered with each object's tags and (for a way or relation) its center.
   *
   * @param bbox The area to cover, normally the city's configured bounds.
   * @return     The query text.
   */
  def overpassQuery(bbox: LatLngBBox): String = {
    val box   = s"(${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng})"
    val union = PlaceCategory.overpassSelectors.map(selector => s"nwr$selector$box;").mkString("\n  ")
    s"""[out:json][timeout:$OverpassTimeoutSeconds];
       |(
       |  $union
       |);
       |out tags center;""".stripMargin
  }

  /**
   * Turns an Overpass `out tags center;` response into fetched places.
   *
   * A node carries `lat`/`lon`; a way or relation carries them under `center`. An element with no position (an
   * empty relation), no tag map, or tags that resolve to no category is skipped. The name is the `name` tag,
   * trimmed, and an empty one is no name.
   *
   * @param json The parsed response.
   * @return     One place per usable element, in the response's order.
   */
  def parseOverpass(json: JsValue): Seq[FetchedPlace] = {
    (json \ "elements").asOpt[Seq[JsObject]].getOrElse(Seq.empty).flatMap { element =>
      val tags: Map[String, String]          = (element \ "tags").asOpt[Map[String, String]].getOrElse(Map.empty)
      val position: Option[(Double, Double)] = {
        val direct = for {
          lat <- (element \ "lat").asOpt[Double]
          lon <- (element \ "lon").asOpt[Double]
        } yield (lat, lon)
        direct.orElse(for {
          lat <- (element \ "center" \ "lat").asOpt[Double]
          lon <- (element \ "center" \ "lon").asOpt[Double]
        } yield (lat, lon))
      }
      for {
        osmType  <- (element \ "type").asOpt[String]
        osmId    <- (element \ "id").asOpt[Long]
        latLon   <- position
        category <- PlaceCategory.resolve(tags)
      } yield FetchedPlace(
        category = category.id,
        name = tags.get("name").map(_.trim).filter(_.nonEmpty),
        osmType = osmType,
        osmId = osmId,
        tags = Json.toJson(tags),
        geom = geometryFactory.createPoint(new Coordinate(latLon._2, latLon._1))
      )
    }
  }
}
