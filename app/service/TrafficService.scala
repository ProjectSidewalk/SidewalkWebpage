package service

import com.google.inject.ImplementedBy
import play.api.cache.AsyncCacheApi
import play.api.libs.json._
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}

import java.nio.charset.StandardCharsets
import java.security.spec.PKCS8EncodedKeySpec
import java.security.{KeyFactory, PrivateKey, Signature}
import java.time.format.DateTimeFormatter
import java.time.{Instant, LocalDate, OffsetDateTime, ZoneOffset}
import java.util.Base64
import javax.inject._
import scala.concurrent.duration.{Duration, FiniteDuration}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal
import scala.util.{Failure, Success, Try}

/**
 * One city's web-traffic summary from the GA4 Data API: rolling 7-day windows (level + week-over-week delta), a
 * trailing weekly sessions series (sparkline + anomaly baseline), and a 28-day device split.
 *
 * @param cityId             The deployment's city id (cities sharing a GA property each get a row).
 * @param sessions7d         Sessions in the trailing 7 days (including today, partial).
 * @param sessionsPrior7d    Sessions in the 7 days before that.
 * @param activeUsers7d      Distinct active users in the trailing 7 days (deduplicated by GA within the window).
 * @param activeUsersPrior7d Distinct active users in the 7 days before that.
 * @param engagedSessions7d  GA "engaged" sessions (10s+, a conversion, or 2+ pageviews) in the trailing 7 days.
 * @param engagementRate7d   `engagedSessions7d / sessions7d`; 0 when there were no sessions.
 * @param mobileShare28d     Share of the last 28 days' sessions from mobile or tablet devices.
 * @param weeklySessions     Trailing 7-day session buckets, oldest first, aligned to the newest reported day.
 * @param anomaly            "traffic_spike" or "traffic_drop" when the current week is an outlier vs the city's own
 *                           baseline ([[TrafficService.trafficAnomaly]]); None otherwise.
 */
case class CityTraffic(
    cityId: String,
    sessions7d: Int,
    sessionsPrior7d: Int,
    activeUsers7d: Int,
    activeUsersPrior7d: Int,
    engagedSessions7d: Int,
    engagementRate7d: Double,
    mobileShare28d: Double,
    weeklySessions: Seq[Int],
    anomaly: Option[String]
)

/** Every fetched city's [[CityTraffic]] plus when the fan-out ran, so the page can show a "data as of" label. */
case class TrafficSnapshot(fetchedAt: OffsetDateTime, cities: Seq[CityTraffic])

/**
 * Constants, the service-account JWT assembly, and the (pure) traffic math for the GA traffic reporting, so the
 * bucketing and anomaly rules are unit-testable without any network.
 */
object TrafficService {

  /** Google's OAuth2 token endpoint; also the JWT `aud` claim. */
  val TokenUrl: String = "https://oauth2.googleapis.com/token"

  /** Read-only Analytics scope — all this service ever does is run reports. */
  val Scope: String = "https://www.googleapis.com/auth/analytics.readonly"

  /** Google access tokens live 60 minutes; caching for 50 leaves headroom for a request in flight. */
  val TokenCacheTtl: Duration = Duration(50, "minutes")

  /**
   * Age beyond which a served traffic snapshot is refreshed in the background. Longer than the DB-backed cross-city
   * reads' 10 minutes because this fan-out leaves the building (one API call per GA property) and traffic numbers
   * feed an overview, not an operational view.
   */
  val TrafficFreshFor: FiniteDuration = Duration(1, "hours")

  /** How long a traffic snapshot may be served at all; past this a request blocks on refetching. */
  val TrafficMaxAge: FiniteDuration = Duration(24, "hours")

  /** Concurrent GA property fetches; the rest queue behind them so ~56 properties never fire at once. */
  val FanOutParallelism: Int = 8

  val RequestTimeout: FiniteDuration = Duration(10, "seconds")

  /** Trailing 7-day buckets fetched per city: the current week plus [[BaselineWeeks]] and sparkline context. */
  val TrendWeeks: Int = 13

  /** How many prior weekly buckets form the anomaly baseline (Planning#8: "trailing 8-week baseline"). */
  val BaselineWeeks: Int = 8

  /** Current week at or beyond this multiple of the baseline median flags a spike; at or below 1/multiple, a drop. */
  val AnomalyMultiple: Double = 3.0

  /** Baseline medians below this many sessions/week are too noisy to flag in either direction. */
  val MinBaselineWeeklySessions: Double = 50.0

  /** The parsed service-account identity: who to claim to be (`iss`) and the key that proves it. */
  case class GaCredentials(clientEmail: String, privateKey: PrivateKey)

  // Hand-written rather than JsonNaming.SnakeCase: the macro renders `sessions7d`, not the page convention's
  // `sessions_7d` — it only breaks words before uppercase letters, never before digits.
  implicit val cityTrafficWrites: Writes[CityTraffic] = (t: CityTraffic) =>
    Json.obj(
      "city_id"               -> t.cityId,
      "sessions_7d"           -> t.sessions7d,
      "sessions_prior_7d"     -> t.sessionsPrior7d,
      "active_users_7d"       -> t.activeUsers7d,
      "active_users_prior_7d" -> t.activeUsersPrior7d,
      "engaged_sessions_7d"   -> t.engagedSessions7d,
      "engagement_rate_7d"    -> t.engagementRate7d,
      "mobile_share_28d"      -> t.mobileShare28d,
      "weekly_sessions"       -> t.weeklySessions,
      "anomaly"               -> t.anomaly
    )

  /**
   * Extracts the client email and RSA private key from a Google service-account key JSON blob.
   *
   * @return Failure when the blob isn't the expected JSON or the PEM inside it doesn't parse.
   */
  def parseServiceAccountKey(raw: String): Try[GaCredentials] = Try {
    val json = Json.parse(raw)
    val pem  = (json \ "private_key").as[String]
    // The PEM body is MIME base64 (line-wrapped); the MIME decoder ignores the newlines.
    val der = Base64.getMimeDecoder.decode(
      pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "")
    )
    val key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der))
    GaCredentials((json \ "client_email").as[String], key)
  }

  /**
   * Assembles and signs the RS256 service-account JWT that Google's token endpoint exchanges for an access token.
   * Hand-rolled with JDK crypto rather than a Google auth library — the protocol is a stable, three-field ritual and
   * this is the repo's only use of it (decided with Jon on Planning#8, 2026-08-22).
   *
   * @param creds The service-account identity to claim.
   * @param now   Claim time; the token endpoint rejects assertions dated in the future or expired.
   * @return      `base64url(header).base64url(claims).base64url(signature)`.
   */
  def buildJwt(creds: GaCredentials, now: Instant): String = {
    val enc                        = Base64.getUrlEncoder.withoutPadding
    def b64(json: JsValue): String = enc.encodeToString(Json.stringify(json).getBytes(StandardCharsets.UTF_8))
    val header                     = b64(Json.obj("alg" -> "RS256", "typ" -> "JWT"))
    val claims                     = b64(
      Json.obj(
        "iss"   -> creds.clientEmail,
        "scope" -> Scope,
        "aud"   -> TokenUrl,
        "iat"   -> now.getEpochSecond,
        "exp"   -> now.plusSeconds(3600).getEpochSecond
      )
    )
    val signingInput = s"$header.$claims"
    val signer       = Signature.getInstance("SHA256withRSA")
    signer.initSign(creds.privateKey)
    signer.update(signingInput.getBytes(StandardCharsets.US_ASCII))
    s"$signingInput.${enc.encodeToString(signer.sign())}"
  }

  /**
   * Sums a daily sessions series into trailing 7-day buckets, oldest first.
   *
   * Buckets are anchored on the newest day present rather than the server's clock: GA reports dates in each
   * property's own timezone, so "today" by the server can be a day the property hasn't reported yet, which would
   * shift every bucket by a day for some cities and not others.
   *
   * @param sessionsByDate Daily session counts; days with no sessions may simply be absent.
   * @param weeks          How many buckets to produce.
   * @return               `weeks` bucket sums, oldest first; all zeros when the series is empty.
   */
  def weeklyBuckets(sessionsByDate: Map[LocalDate, Int], weeks: Int): Seq[Int] = {
    val anchor = sessionsByDate.keys.maxOption.getOrElse(LocalDate.now(ZoneOffset.UTC))
    (weeks - 1).to(0, -1).map { weeksBack =>
      val end = anchor.minusDays(7L * weeksBack)
      0.to(6).map(d => sessionsByDate.getOrElse(end.minusDays(d.toLong), 0)).sum
    }
  }

  /**
   * Flags the current week as an outlier against the city's own trailing baseline (Planning#8).
   *
   * The baseline is the *median* of the [[BaselineWeeks]] buckets before the current one, so a single earlier spike
   * can't drag the baseline up and mask a real change. Quiet cities (baseline median below
   * [[MinBaselineWeeklySessions]]) are never flagged: at that volume a school assignment doubles "traffic".
   *
   * @param weeklySessions Weekly session buckets, oldest first; the last is the current (possibly partial) week.
   * @return               Some("traffic_spike") / Some("traffic_drop") for an outlier, None otherwise.
   */
  def trafficAnomaly(weeklySessions: Seq[Int]): Option[String] = {
    if (weeklySessions.length < BaselineWeeks + 1) None
    else {
      val current  = weeklySessions.last
      val baseline = weeklySessions.takeRight(BaselineWeeks + 1).dropRight(1)
      val med      = median(baseline)
      if (med < MinBaselineWeeklySessions) None
      else if (current >= med * AnomalyMultiple) Some("traffic_spike")
      else if (current <= med / AnomalyMultiple) Some("traffic_drop")
      else None
    }
  }

  private def median(values: Seq[Int]): Double = {
    val sorted = values.sorted
    val n      = sorted.length
    if (n == 0) 0.0
    else if (n % 2 == 1) sorted(n / 2).toDouble
    else (sorted(n / 2 - 1) + sorted(n / 2)) / 2.0
  }
}

@ImplementedBy(classOf[TrafficServiceImpl])
trait TrafficService {

  /**
   * Returns every configured city's GA traffic summary, from cache when warm ([[TrafficService.TrafficFreshFor]]).
   *
   * @return None when traffic reporting isn't configured on this deployment (no usable service-account key, or no
   *         property ids); a failed future when a fetch was attempted and every property failed (auth/quota/outage),
   *         so callers degrade rather than cache emptiness.
   */
  def getCityTraffic(): Future[Option[TrafficSnapshot]]
}

@Singleton
class TrafficServiceImpl @Inject() (
    config: Configuration,
    cacheApi: AsyncCacheApi,
    swrCache: SwrCache,
    ws: WSClient
)(implicit val ec: ExecutionContext)
    extends TrafficService {
  import TrafficService._

  private val logger  = Logger(this.getClass)
  private val envType = config.get[String]("environment-type")

  /** Parsed once: a dev/CI dummy value fails the parse and cleanly disables the feature. */
  private lazy val credentials: Option[GaCredentials] =
    config.getOptional[String]("ga-service-account-key").flatMap { raw =>
      parseServiceAccountKey(raw) match {
        case Success(creds) => Some(creds)
        case Failure(e)     =>
          logger.warn(s"GA service-account key is set but unusable; traffic reporting disabled: ${e.getMessage}")
          None
      }
    }

  /**
   * cityId → numeric GA4 property id for this environment. Cities without an entry are skipped ("staging" always —
   * it aliases a real city's property and has no scorecard row to join to).
   */
  private def propertyIdsByCity: Map[String, String] =
    config
      .get[Seq[String]]("city-params.city-ids")
      .filterNot(_ == "staging")
      .flatMap { cityId =>
        config.getOptional[String](s"city-params.google-analytics-property-id.$envType.$cityId").map(cityId -> _)
      }
      .toMap

  def getCityTraffic(): Future[Option[TrafficSnapshot]] = credentials match {
    case None        => Future.successful(None)
    case Some(creds) =>
      val byCity = propertyIdsByCity
      if (byCity.isEmpty) Future.successful(None)
      else {
        swrCache
          .staleWhileRevalidate[TrafficSnapshot]("getCityTraffic", TrafficFreshFor, TrafficMaxAge) {
            fetchSnapshot(creds, byCity)
          }
          .map(Some(_))
      }
  }

  /** Runs the full fan-out: one token, then one batched report call per distinct GA property. */
  private def fetchSnapshot(creds: GaCredentials, byCity: Map[String, String]): Future[TrafficSnapshot] =
    accessToken(creds).flatMap { token =>
      // Cities can share a property (e.g. zurich / zurich-infra3d): fetch each property once, row every city.
      val properties = byCity.toSeq.groupMap(_._2)(_._1).toSeq.sortBy(_._1)
      inBatches(properties, FanOutParallelism) { case (propertyId, cityIds) =>
        fetchProperty(token, propertyId)
          .map(traffic => cityIds.sorted.map(cityId => traffic.copy(cityId = cityId)))
          .recover { case NonFatal(e) =>
            logger.warn(
              s"GA traffic fetch failed for property $propertyId (${cityIds.mkString(", ")}): ${e.getMessage}"
            )
            Seq.empty
          }
      }.map { perProperty =>
        val cities = perProperty.flatten
        // Every property failing signals a systemic problem (auth, quota, outage): fail the refresh so nothing is
        // cached and the next request retries, instead of pinning an empty snapshot for the whole fresh window.
        if (cities.isEmpty) throw new RuntimeException(s"All ${properties.size} GA property fetches failed")
        TrafficSnapshot(OffsetDateTime.now(), cities.sortBy(_.cityId))
      }
    }

  /** A cached OAuth access token for the service account (the getInfra3dToken pattern). */
  private def accessToken(creds: GaCredentials): Future[String] =
    cacheApi.getOrElseUpdate[String]("getGaAccessToken", TokenCacheTtl) {
      ws.url(TokenUrl)
        .withRequestTimeout(RequestTimeout)
        .post(
          Map(
            "grant_type" -> Seq("urn:ietf:params:oauth:grant-type:jwt-bearer"),
            "assertion"  -> Seq(buildJwt(creds, Instant.now()))
          )
        )
        .map { response =>
          if (response.status == 200) (response.json \ "access_token").as[String]
          else throw new RuntimeException(s"GA token request failed (${response.status}): ${response.body.take(300)}")
        }
    }

  /**
   * Fetches one GA property's three reports in a single `batchRunReports` call and assembles a [[CityTraffic]]
   * (with a placeholder cityId — the caller stamps the real one, since properties can serve several cities).
   */
  private def fetchProperty(token: String, propertyId: String): Future[CityTraffic] = {
    val body = Json.obj(
      "requests" -> Json.arr(
        // 91 trailing days of sessions — the weekly sparkline and the anomaly baseline.
        Json.obj(
          "dateRanges" -> Json.arr(Json.obj("startDate" -> "90daysAgo", "endDate" -> "today")),
          "dimensions" -> Json.arr(Json.obj("name" -> "date")),
          "metrics"    -> Json.arr(Json.obj("name" -> "sessions"))
        ),
        // Exact rolling windows (trailing 7 days vs the 7 before), so activeUsers is deduplicated per window by GA.
        Json.obj(
          "dateRanges" -> Json.arr(
            Json.obj("startDate" -> "6daysAgo", "endDate"  -> "today"),
            Json.obj("startDate" -> "13daysAgo", "endDate" -> "7daysAgo")
          ),
          "metrics" -> Json.arr(
            Json.obj("name" -> "sessions"),
            Json.obj("name" -> "activeUsers"),
            Json.obj("name" -> "engagedSessions")
          )
        ),
        // 28-day device split.
        Json.obj(
          "dateRanges" -> Json.arr(Json.obj("startDate" -> "27daysAgo", "endDate" -> "today")),
          "dimensions" -> Json.arr(Json.obj("name" -> "deviceCategory")),
          "metrics"    -> Json.arr(Json.obj("name" -> "sessions"))
        )
      )
    )
    ws.url(s"https://analyticsdata.googleapis.com/v1beta/properties/$propertyId:batchRunReports")
      .addHttpHeaders("Authorization" -> s"Bearer $token")
      .withRequestTimeout(RequestTimeout)
      .post(body)
      .map { response =>
        if (response.status != 200)
          throw new RuntimeException(s"batchRunReports failed (${response.status}): ${response.body.take(300)}")
        val reports                 = (response.json \ "reports").asOpt[Seq[JsValue]].getOrElse(Seq.empty)
        def report(i: Int): JsValue = reports.lift(i).getOrElse(JsNull)

        val sessionsByDate: Map[LocalDate, Int] = rows(report(0)).flatMap { row =>
          Try(LocalDate.parse(dimValue(row, 0), DateTimeFormatter.BASIC_ISO_DATE)).toOption
            .map(_ -> metricValue(row, 0).toInt)
        }.toMap
        val weekly = weeklyBuckets(sessionsByDate, TrendWeeks)

        // Two date ranges and no dimensions, so GA adds an implicit dateRange dimension: "date_range_0" is current.
        val windowRows                              = rows(report(1)).map(row => dimValue(row, 0) -> row).toMap
        def window(range: String, metric: Int): Int =
          windowRows.get(range).map(row => metricValue(row, metric).toInt).getOrElse(0)
        val sessions7d = window("date_range_0", 0)

        val deviceRows    = rows(report(2)).map(row => dimValue(row, 0) -> metricValue(row, 0)).toMap
        val totalSessions = deviceRows.values.sum
        val mobileShare   =
          if (totalSessions > 0)
            (deviceRows.getOrElse("mobile", 0L) + deviceRows.getOrElse("tablet", 0L)).toDouble / totalSessions
          else 0.0

        CityTraffic(
          cityId = "",
          sessions7d = sessions7d,
          sessionsPrior7d = window("date_range_1", 0),
          activeUsers7d = window("date_range_0", 1),
          activeUsersPrior7d = window("date_range_1", 1),
          engagedSessions7d = window("date_range_0", 2),
          engagementRate7d = if (sessions7d > 0) window("date_range_0", 2).toDouble / sessions7d else 0.0,
          mobileShare28d = mobileShare,
          weeklySessions = weekly,
          anomaly = trafficAnomaly(weekly)
        )
      }
  }

  private def rows(report: JsValue): Seq[JsValue] = (report \ "rows").asOpt[Seq[JsValue]].getOrElse(Seq.empty)

  private def dimValue(row: JsValue, i: Int): String =
    (row \ "dimensionValues" \ i \ "value").asOpt[String].getOrElse("")

  private def metricValue(row: JsValue, i: Int): Long =
    (row \ "metricValues" \ i \ "value").asOpt[String].flatMap(v => Try(v.toLong).toOption).getOrElse(0L)

  /** Runs `f` over `items` at most `parallelism` at a time, preserving order. */
  private def inBatches[A, B](items: Seq[A], parallelism: Int)(f: A => Future[B]): Future[Seq[B]] =
    items.grouped(parallelism).foldLeft(Future.successful(Vector.empty[B])) { (accF, batch) =>
      accF.flatMap(acc => Future.sequence(batch.map(f)).map(acc ++ _))
    }
}
