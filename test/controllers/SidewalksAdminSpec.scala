package controllers

import models.user.Role
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsObject, JsValue}
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.{AnonSession, RoleSession, SidewalkSpec}

/**
 * Functional tests for the admin Sidewalks surface (#5724): the page and the endpoint behind it.
 *
 * The guard is pinned with a real signed-in caller, as in ImageryAdminSpec, because a logged-out request is refused
 * identically whatever role the action demands. The rest pins the payload's field names: the page reads every one by
 * name, so a rename shows up as a blank column rather than an error. What the counts mean is pinned against seeded
 * labels in SidewalkPresenceTableSpec.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class SidewalksAdminSpec extends SidewalkSpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // AnonSession mints one session per call and the limiter is per-IP; every suite in a run shares loopback.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  given mat: Materializer = app.materializer

  private val XHR   = "X-Requested-With" -> "XMLHttpRequest"
  private val Paths = Seq("/admin/sidewalks", "/adminapi/sidewalkPresence")

  private lazy val visitorCookies: Seq[Cookie] = sessionAs(Role.Registered)
  private lazy val adminCookies: Seq[Cookie]   = sessionAs(Role.Administrator)

  private def asAdmin(path: String) =
    route(app, FakeRequest(GET, path).withHeaders(XHR).withCookies(adminCookies*)).get

  "the Sidewalks admin surface" should {
    "refuse a signed-in visitor, naming the role it wants" in {
      Paths.foreach { path =>
        val resp = route(app, FakeRequest(GET, path).withHeaders(XHR).withCookies(visitorCookies*)).get
        status(resp) mustBe FORBIDDEN
        contentAsString(resp) must include("Administrator")
      }
    }

    "send a logged-out caller to sign in rather than answering with a 404" in {
      Paths.foreach { path =>
        status(route(app, FakeRequest(GET, path).withHeaders("Sec-Fetch-Mode" -> "navigate")).get) mustBe SEE_OTHER
      }
    }
  }

  "GET /admin/sidewalks" should {
    "serve the page to an administrator, with the containers its client fills and the endpoint it reads" in {
      val resp = asAdmin("/admin/sidewalks")
      status(resp) mustBe OK
      val body = contentAsString(resp)
      Seq("sidewalks-map", "sidewalks-flag-table", "sidewalks-region-table", "sidewalks-basis-filters", "kpi-absent",
        "kpi-rebuilt").foreach(id => body must include(id))
      body must include("data-presence-url=\"/adminapi/sidewalkPresence\"")
    }
  }

  "GET /adminapi/sidewalkPresence" should {
    "publish every open street's two faces as snake_case JSON, with no geometry" in {
      val resp = asAdmin("/adminapi/sidewalkPresence")
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")
      val json = contentAsJson(resp).as[JsObject]
      json.keys mustBe Set("rebuilt_at", "streets")
      (json \ "streets").as[Seq[JsValue]].foreach { street =>
        street.as[JsObject].keys mustBe Set("street_edge_id", "region_id", "region_name", "way_type", "length_m",
          "audit_count", "faces")
        (street \ "faces").as[Seq[JsObject]].foreach { face =>
          face.keys mustBe Set("street_side", "presence", "presence_basis", "no_sidewalk_label_count",
            "no_sidewalk_user_count", "validated_no_sidewalk_count", "rejected_no_sidewalk_count", "label_count",
            "problem_label_count", "curb_ramp_count", "last_no_sidewalk_label_at")
        }
      }
      contentAsString(resp) must not include "coordinates"
    }
  }
}
