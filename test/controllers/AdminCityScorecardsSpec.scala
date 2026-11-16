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
 * On a cold JVM its fan-outs can outlast Apache's 60 s proxy timeout (#5432), so a read the page needs that hasn't
 * finished in time answers `503` + `Retry-After` with a `STILL_COMPUTING` body. The cache is swapped for one that
 * reports chosen keys as cold, so no fan-out runs for them and the assertions don't depend on database speed.
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

  /** The cache keys of the reads the page cannot render without, plus the two it can render without. */
  private val requiredKeys = Seq(
    "getCityScorecards", "getCrossCityWeeklyTrend_all", "getCrossCityDailyTrend_30", "getCrossCityActivitySummary",
    "getCrossCityStoryStats"
  )
  private val labelingSpeedKey     = "getCrossCityLabelingSpeed"
  private val contributorCountsKey = "getCrossCityContributorCounts"

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

    "serve the page without the deduped user counts when only that read is still computing" in {
      withCold(contributorCountsKey) {
        val resp = get()
        status(resp) mustBe OK
        val json = contentAsJson(resp)
        mustBeFullAnswer(json)
        (json \ "summary" \ "total_users").toOption.forall(_ == JsNull) mustBe true
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
