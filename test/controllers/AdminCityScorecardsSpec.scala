package controllers

import models.api.ApiError
import models.user.Role
import org.apache.pekko.stream.Materializer
import org.scalatest.Assertion
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.bind
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsArray, JsNull, JsObject, JsValue}
import play.api.mvc.{Cookie, Result}
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import service.{ConfigService, SwrCache}
import util.{AnonSession, RoleSession, SidewalkSpec, StallingSwrCache}

import scala.concurrent.Future
import scala.concurrent.duration.DurationInt

/**
 * The Across Cities endpoint, `GET /adminapi/cityScorecards` (#4329), on a warm and on a cold cross-city cache.
 *
 * On a cold JVM its fan-outs to every city schema can outlast Apache's 60 s proxy timeout, which the page saw as a
 * `502` (#5432). The contract pinned here is the one the AccessScore endpoints already keep (#5418): every read waits
 * a bounded time, and when one the page needs has not finished the answer is `503` + `Retry-After` with a
 * `STILL_COMPUTING` problem body, which the page's retry helper waits out. The cache is replaced by one that can make
 * chosen keys' computes never finish while still racing them against the real deadline, so "the request returned at
 * all" is itself an assertion: before the bound it would have hung for as long as the fan-out took.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class AdminCityScorecardsSpec extends SidewalkSpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // AnonSession mints one session per call and the limiter is per-IP; every suite in a run shares loopback.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .overrides(bind[SwrCache].to[StallingSwrCache])
      .build()

  given mat: Materializer = app.materializer

  private lazy val cache                     = app.injector.instanceOf[SwrCache].asInstanceOf[StallingSwrCache]
  private lazy val ownerCookies: Seq[Cookie] = sessionAs(Role.Owner)

  /** The cache keys of the six cross-city reads bounded by [[ConfigService.CrossCityColdWait]]. */
  private val boundedKeys = Seq(
    "getCityScorecards", "getCrossCityWeeklyTrend_all", "getCrossCityDailyTrend_30", "getCrossCityActivitySummary",
    "getCrossCityLabelingSpeed", "getCrossCityStoryStats"
  )
  private val baselineKey = "getCrossCityDailyBaseline"

  private def get(cookies: Seq[Cookie] = ownerCookies): Future[Result] =
    route(app, FakeRequest(GET, "/adminapi/cityScorecards").withCookies(cookies*)).get

  /** The whole still-computing contract, in one place so each cold case is held to the same one. */
  private def mustBeStillComputing(resp: Future[Result]): Assertion = {
    status(resp) mustBe SERVICE_UNAVAILABLE
    header(RETRY_AFTER, resp) mustBe Some(ApiError.StillComputingRetryAfterSeconds.toString)
    contentType(resp) mustBe Some(ApiError.ContentType)
    val json = contentAsJson(resp)
    (json \ "code").as[String] mustBe "STILL_COMPUTING"
    (json \ "status").as[Int] mustBe SERVICE_UNAVAILABLE
    (json \ "detail").as[String] must include("Retry-After")
  }

  /** The parts of a full answer the page cannot render without. */
  private def mustBeFullAnswer(json: JsValue): Assertion = {
    (json \ "cities").asOpt[JsArray] must not be empty
    (json \ "stories").asOpt[JsArray] must not be empty
    (json \ "summary").asOpt[JsObject] must not be empty
    (json \ "window_summary").asOpt[JsObject] must not be empty
    (json \ "over_time_all_time").asOpt[JsArray] must not be empty
    (json \ "over_time_daily").as[JsArray].value.size mustBe 30
  }

  "the cold-wait bound" should {
    "stay under the reverse proxy's 60 s timeout" in {
      // Apache's ProxyTimeout is 60 s (docs/deployment-and-stages.md); a bound at or past it re-opens the 502. The
      // reads run in parallel, so the baseline's own shorter wait does not add to this one.
      ConfigService.CrossCityColdWait must be < 60.seconds
    }
  }

  "GET /adminapi/cityScorecards" should {
    "redirect an unauthenticated request rather than serve it (route wired, Owner gate intact)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/cityScorecards")).get
      status(resp) must (be >= 300 and be < 400)
    }

    "answer 503 + Retry-After when the cross-city reads are still computing, instead of waiting on them" in {
      cache.stalledKeys = (boundedKeys :+ baselineKey).toSet
      try mustBeStillComputing(get())
      finally cache.stalledKeys = Set.empty
    }

    "answer 503 when any one read the page needs is still computing" in {
      boundedKeys.filterNot(_ == "getCrossCityLabelingSpeed").foreach { key =>
        cache.stalledKeys = Set(key)
        try withClue(s"$key stalled: ")(mustBeStillComputing(get()))
        finally cache.stalledKeys = Set.empty
      }
    }

    "serve the page without labeling speeds when only that read is still computing" in {
      // The interaction-table scan is the likeliest to outlast the wait alone; the page shows a missing speed as
      // unknown, so refusing the whole page for it would only slow every retry down to the slowest metric.
      cache.stalledKeys = Set("getCrossCityLabelingSpeed")
      try {
        val resp = get()
        status(resp) mustBe OK
        val json = contentAsJson(resp)
        mustBeFullAnswer(json)
        (json \ "cities").as[JsArray].value.foreach { city =>
          (city \ "seconds_per_100m").toOption.forall(_ == JsNull) mustBe true
        }
      } finally cache.stalledKeys = Set.empty
    }

    "bound each cross-city read by CrossCityColdWait and the baseline by its own shorter wait" in {
      status(get()) mustBe OK
      boundedKeys.foreach { key =>
        withClue(s"$key: ")(Option(cache.coldWaitByKey.get(key)) mustBe Some(ConfigService.CrossCityColdWait))
      }
      Option(cache.coldWaitByKey.get(baselineKey)) mustBe Some(ConfigService.DailyBaselineColdWait)
    }

    "serve the full page as Owner on a warm cache, and again from the cache" in {
      val first = get()
      status(first) mustBe OK
      mustBeFullAnswer(contentAsJson(first))

      val second = get()
      status(second) mustBe OK
      mustBeFullAnswer(contentAsJson(second))
    }
  }
}
