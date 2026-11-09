package service

import com.google.inject.ImplementedBy
import formats.json.HealthFormats.{FleetCityHealth, FleetHealth, HealthStatus, given}
import play.api.cache.AsyncCacheApi
import play.api.{Configuration, Logger}
import play.api.i18n.Lang
import play.api.libs.json.Json
import play.api.libs.ws.WSClient

import java.time.OffsetDateTime
import javax.inject.*
import scala.concurrent.duration.*
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/**
 * Every city instance's `/health` for the Health dashboard (#4548). Over HTTP, not the database: which binary an
 * instance runs lives only in that JVM, and whether it is serving at all is not a database fact either.
 */
@ImplementedBy(classOf[FleetHealthServiceImpl])
trait FleetHealthService {

  /** Cached briefly so several open dashboards don't each probe the fleet. */
  def getFleetHealth: Future[FleetHealth]
}

object FleetHealthService {

  /**
   * A 503 still carries a body (up, but its database isn't), so only an unparsable body is an `error`. So is a body
   * from a different city: the URL then points at the wrong instance, which must not read as that city being healthy.
   */
  def parse(cityId: String, cityName: String, url: String, httpStatus: Int, body: String): FleetCityHealth = {
    val health = Try(Json.parse(body).as[HealthStatus]).toOption
    val error  = health match {
      case None                          => Some("not a health response")
      case Some(h) if h.cityId != cityId => Some(s"answered as ${h.cityId}")
      case _                             => None
    }
    FleetCityHealth(cityId, cityName, url, Some(httpStatus), health, error)
  }

  /**
   * The build of the most recently started instance that answered as itself, or None when nothing did. Every start on
   * a stage, deploy or crash recovery alike, runs the binary staged last, so the newest start is on the newest build;
   * a rollback stages the older tag and the same rule follows it. A row in `error` status still reports its build.
   */
  def latestBuild(rows: Seq[FleetCityHealth]): Option[String] =
    rows
      .filter(_.error.isEmpty)
      .flatMap(_.health)
      .filter(_.gitSha.isDefined)
      .maxByOption(_.appStartedAt)
      .flatMap(_.gitSha)
}

@Singleton
class FleetHealthServiceImpl @Inject() (
    ws: WSClient,
    cacheApi: AsyncCacheApi,
    config: Configuration,
    configService: ConfigService
)(using ec: ExecutionContext)
    extends FleetHealthService {
  private val logger = Logger(this.getClass)

  // Cities with no instance on this stage (`city-params.not-deployed`), reported as absent rather than probed.
  private val notDeployed: Set[String] = config
    .getOptional[Seq[String]](s"city-params.not-deployed.${config.get[String]("environment-type")}")
    .getOrElse(Seq.empty)
    .toSet

  // Under the page's 20s poll, so a second tab reuses the answer but a release still shows within one poll.
  private val cacheTtl: Duration = 15.seconds
  // The table is one payload, so a slow city delays every row; past this it counts as down.
  private val requestTimeout: FiniteDuration = 5.seconds

  def getFleetHealth: Future[FleetHealth] = cacheApi.getOrElseUpdate[FleetHealth]("fleetHealth", cacheTtl) {
    // Admin-only, English-only surface, so city names need no viewer language.
    val cities = configService.getAllCityInfo(Lang("en")).filterNot(c => notDeployed.contains(c.cityId))
    Future.traverse(cities)(city => probe(city.cityId, city.cityNameFormatted, city.URL.stripSuffix("/"))).map { rows =>
      FleetHealth(OffsetDateTime.now(), configService.getCityId, FleetHealthService.latestBuild(rows), rows,
        notDeployed.toSeq.sorted)
    }
  }

  /** Never fails: one unreachable city must not take the rest of the table down with it. */
  private def probe(cityId: String, cityName: String, url: String): Future[FleetCityHealth] =
    Future
      .fromTry(Try(ws.url(s"$url/health"))) // A malformed URL throws here, not inside the request's Future.
      .flatMap(_.withRequestTimeout(requestTimeout).get())
      .map(resp => FleetHealthService.parse(cityId, cityName, url, resp.status, resp.body))
      .recover { case e: Exception =>
        // Debug, not warn: during an outage this fires for every city on every poll, and the table already says so.
        logger.debug(s"Fleet health: $cityId unreachable at $url: ${e.getMessage}")
        FleetCityHealth(cityId, cityName, url, None, None, Some(e.getClass.getSimpleName))
      }
}
