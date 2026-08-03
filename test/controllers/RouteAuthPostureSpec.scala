package controllers

import org.apache.pekko.stream.Materializer
import org.scalatest.Assertion
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json._
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Auth-posture tests for the routes touched by #4441: the public map-data feeds are reachable anonymously at their
 * canonical URLs, the /adminapi/ namespace uniformly redirects unauthenticated users, and retired URLs are gone.
 *
 * Boots the full application with a real DB; asserts response contract/shape only, never data values.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class RouteAuthPostureSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  implicit lazy val mat: Materializer = app.materializer

  /** Asserts that no route matches `path` (or that only a catch-all serves it a 404). */
  private def assertRouteGone(path: String): Assertion =
    route(app, FakeRequest(GET, path)) match {
      case None       => succeed
      case Some(resp) => status(resp) mustBe NOT_FOUND
    }

  "GET /labels/all" should {
    "serve the LabelMap GeoJSON feed anonymously" in {
      val resp = route(app, FakeRequest(GET, "/labels/all")).get
      status(resp) mustBe OK
      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      val features = (json \ "features").as[Seq[JsValue]]
      features.headOption.foreach { feature =>
        (feature \ "geometry" \ "type").as[String] mustBe "Point"
        val properties = (feature \ "properties").as[JsObject]
        properties.keys must contain allOf ("label_id", "label_type", "severity", "correct", "tags")
      }
    }

    "accept the region/route/AI-validation filter params" in {
      val resp = route(app, FakeRequest(GET, "/labels/all?regions=999999999&routes=&aiValidationOptions=")).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "features").as[Seq[JsValue]] mustBe empty
    }
  }

  "GET /neighborhoods/completionRate" should {
    "serve neighborhood completion rates anonymously" in {
      val resp = route(app, FakeRequest(GET, "/neighborhoods/completionRate")).get
      status(resp) mustBe OK
      val rates = contentAsJson(resp).as[Seq[JsObject]]
      rates.headOption.foreach { rate =>
        rate.keys must contain allOf ("region_id", "total_distance_m", "completed_distance_m", "rate", "name")
      }
    }

    "filter by the regions param" in {
      val resp = route(app, FakeRequest(GET, "/neighborhoods/completionRate?regions=999999999")).get
      status(resp) mustBe OK
      contentAsJson(resp).as[Seq[JsObject]] mustBe empty
    }
  }

  "the /adminapi/ namespace" should {
    "redirect unauthenticated users on /adminapi/labelTags (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/labelTags")).get
      status(resp) must (be >= 300 and be < 400)
    }

    "redirect unauthenticated users on /adminapi/recalculateStreetPriority (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/recalculateStreetPriority")).get
      status(resp) must (be >= 300 and be < 400)
    }
  }

  "the retired URLs" should {
    "no longer route /adminapi/neighborhoodCompletionRate" in {
      assertRouteGone("/adminapi/neighborhoodCompletionRate")
    }

    "no longer route /explore/recalculateStreetPriority" in {
      assertRouteGone("/explore/recalculateStreetPriority")
    }

    "no longer route the unused daily-count endpoints" in {
      assertRouteGone("/contribution/auditCounts/all")
      assertRouteGone("/userapi/labelCounts/all")
      assertRouteGone("/userapi/validationCounts/all")
    }
  }
}
