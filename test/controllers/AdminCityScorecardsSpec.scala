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
import service.SwrCache
import util.{AnonSession, ColdSwrCache, RoleSession, SidewalkSpec}

import scala.concurrent.Future

/**
 * The Across Cities endpoint, `GET /adminapi/cityScorecards` (#4329), on a warm and on a cold cross-city cache.
 *
 * On a cold JVM its fan-outs to every city schema can outlast Apache's 60 s proxy timeout, which the page saw as a
 * `502` (#5432). The contract pinned here is the one the AccessScore endpoints already keep (#5418): when a read the
 * page needs has not finished within its bound, the answer is `503` + `Retry-After` with a `STILL_COMPUTING` problem
 * body, which the page's retry helper waits out. The cache is replaced by one that reports chosen keys as still
 * computing, so no fan-out runs for them and the assertions hold regardless of how fast the database is.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class AdminCityScorecardsSpec extends SidewalkSpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // AnonSession mints one session per call and the limiter is per-IP; every suite in a run shares loopback.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .overrides(bind[SwrCache].to[ColdSwrCache])
      .build()

  given mat: Materializer = app.materializer

  private lazy val cache                     = app.injector.instanceOf[SwrCache].asInstanceOf[ColdSwrCache]
  private lazy val ownerCookies: Seq[Cookie] = sessionAs(Role.Owner)

  /** The cache keys of the reads the page cannot render without, plus labeling speed, which it can. */
  private val requiredKeys = Seq(
    "getCityScorecards", "getCrossCityWeeklyTrend_all", "getCrossCityDailyTrend_30", "getCrossCityActivitySummary",
    "getCrossCityStoryStats"
  )
  private val labelingSpeedKey = "getCrossCityLabelingSpeed"

  private def get(cookies: Seq[Cookie] = ownerCookies): Future[Result] =
    route(app, FakeRequest(GET, "/adminapi/cityScorecards").withCookies(cookies*)).get

  /** Runs `body` with exactly `keys` still computing, then puts the cache back to all-cold for the next test. */
  private def withCold(keys: String*)(body: => Assertion): Assertion = {
    cache.isCold = keys.toSet.contains
    try body
    finally cache.isCold = _ => true
  }

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

  "GET /adminapi/cityScorecards" should {
    "redirect an unauthenticated request rather than serve it (route wired, Owner gate intact)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/cityScorecards")).get
      status(resp) must (be >= 300 and be < 400)
    }

    "answer 503 + Retry-After when every cross-city read is still computing" in {
      mustBeStillComputing(get())
    }

    "answer 503 when any one read the page needs is still computing" in {
      requiredKeys.foreach { key => withCold(key)(withClue(s"$key cold: ")(mustBeStillComputing(get()))) }
    }

    "serve the page without labeling speeds when only that read is still computing" in {
      // The interaction-table scan is the likeliest to outlast the wait alone; the page shows a missing speed as
      // unknown, so refusing the whole page for it would only slow every retry down to the slowest metric.
      withCold(labelingSpeedKey) {
        val resp = get()
        status(resp) mustBe OK
        val json = contentAsJson(resp)
        mustBeFullAnswer(json)
        (json \ "cities")
          .as[JsArray]
          .value
          .forall(city => (city \ "seconds_per_100m").toOption.forall(_ == JsNull)) mustBe
          true
      }
    }

    "serve the full page as Owner on a warm cache, and again from the cache" in {
      withCold() {
        val first = get()
        status(first) mustBe OK
        mustBeFullAnswer(contentAsJson(first))

        val second = get()
        status(second) mustBe OK
        mustBeFullAnswer(contentAsJson(second))
      }
    }
  }
}
