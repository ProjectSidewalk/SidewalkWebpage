package controllers

import models.user.Role
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._
import play.api.{Application, Configuration, Environment}
import slick.dbio.DBIO
import util.{AnonSession, RoleSession}

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Functional tests for the Mapillary source endpoints (#5407): the admin Imagery page's list of creators a deployment
 * favours, and the mode that says whether it prefers them or uses nothing else.
 *
 * Adding a creator or changing the mode changes which imagery every labeler is shown, so the guard is pinned first: a signed-in non-admin
 * is refused by role (RouteAuthPostureSpec already pins the anonymous posture for every /adminapi route). The rest
 * pins the contract the page reads -- what the list carries, that a removal is idempotent, and every refusal an add
 * can earn before Mapillary is consulted. No test here reaches Mapillary: the one path that does (a plausible
 * username on a Mapillary deployment) is left to the manual QA checklist, since its answer is Mapillary's to give.
 *
 * The suite's app is configured as a Mapillary deployment whatever city the connected database is, because on any
 * other provider an add is refused outright; that refusal is pinned against a second, GSV-configured app.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the
 * scheduling actors are disabled.
 */
class MapillarySourcesAdminSpec extends PlaySpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  /** The deployment's city id, read the way the app reads it, so the provider override lands on the right key. */
  private val cityId: String = Configuration.load(Environment.simple()).get[String]("city-id")

  private def appWithProvider(provider: String): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // AnonSession mints one session per call and the limiter is per-IP; every suite in a run shares loopback.
      .configure("rate-limit.anon-signup.enabled" -> false, s"city-params.pano-viewer-type.$cityId" -> provider)
      .build()

  override def fakeApplication(): Application = appWithProvider("mapillary")

  implicit lazy val mat: Materializer = app.materializer

  private val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  private lazy val visitorCookies: Seq[Cookie] = sessionAs(Role.Registered)
  private lazy val adminCookies: Seq[Cookie]   = sessionAs(Role.Administrator)

  /** A username no real deployment would list, so the suite can insert and delete it without touching real rows. */
  private val TestCreator = "spec-5407-creator"

  private val SourcesUrl  = "/adminapi/mapillarySources"
  private val CreatorsUrl = s"$SourcesUrl/creators"
  private val ModeUrl     = s"$SourcesUrl/mode"

  /** The connected city's mode, read straight from the DB so a test can restore what it found. */
  private def currentMode(): String = run(sql"SELECT mapillary_source_mode FROM config".as[String].head)

  private def request(method: String, path: String, cookies: Seq[Cookie], body: Option[JsValue] = None) = {
    val base = FakeRequest(method, path).withHeaders(XHR).withCookies(cookies: _*)
    body match {
      case Some(json) => route(app, base.withJsonBody(json)).get
      case None       => route(app, base).get
    }
  }

  private def seedTestCreator(): Unit = {
    val _ = run(sqlu"""INSERT INTO mapillary_source (source_type, source_value)
                       VALUES ('creator', $TestCreator) ON CONFLICT DO NOTHING""")
  }

  private def deleteTestCreator(): Unit = {
    val _ = run(sqlu"DELETE FROM mapillary_source WHERE source_value = $TestCreator")
  }

  "the Mapillary source endpoints" should {
    "refuse a signed-in visitor by role" in {
      Seq(
        (GET, SourcesUrl, None),
        (POST, CreatorsUrl, Some(Json.obj("username" -> TestCreator))),
        (DELETE, s"$CreatorsUrl/$TestCreator", None),
        (PUT, ModeUrl, Some(Json.obj("mode" -> "restrict")))
      ).foreach { case (method, path, body) =>
        val resp = request(method, path, visitorCookies, body)
        status(resp) mustBe FORBIDDEN
        contentAsString(resp) must include("Administrator")
      }
    }
  }

  "GET /adminapi/mapillarySources" should {
    "name the provider and the mode, and list each source, with no adder for one added by hand in SQL" in {
      seedTestCreator()
      try {
        val resp = request(GET, SourcesUrl, adminCookies)
        status(resp) mustBe OK
        val json = contentAsJson(resp)
        (json \ "provider").as[String] mustBe "mapillary"
        (json \ "mode").as[String] mustBe currentMode()
        val row = (json \ "sources").as[Seq[JsObject]].find(s => (s \ "source_value").as[String] == TestCreator)
        row.map(s => (s \ "source_type").as[String]) mustBe Some("creator")
        row.flatMap(s => (s \ "added_by").asOpt[String]) mustBe None
        row.flatMap(s => (s \ "added_at").asOpt[String]) must not be empty
      } finally deleteTestCreator()
    }
  }

  "POST /adminapi/mapillarySources/creators" should {
    "answer 400 for a body without a username" in {
      status(request(POST, CreatorsUrl, adminCookies, Some(Json.obj("name" -> "x")))) mustBe BAD_REQUEST
    }

    "answer 400, without consulting Mapillary, for text that can't be a username" in {
      Seq("", "   ", "two words", "a/b", "x" * 61).foreach { username =>
        val resp = request(POST, CreatorsUrl, adminCookies, Some(Json.obj("username" -> username)))
        status(resp) mustBe BAD_REQUEST
        (contentAsJson(resp) \ "message").as[String] must include("can't be a Mapillary username")
      }
    }

    "answer 409 on a deployment whose provider isn't Mapillary, and list nothing" in {
      val gsvApp = appWithProvider("gsv")
      try {
        val req = FakeRequest(POST, CreatorsUrl)
          .withHeaders(XHR)
          .withCookies(adminCookies: _*)
          .withJsonBody(Json.obj("username" -> TestCreator))
        val resp = route(gsvApp, req).get
        status(resp) mustBe CONFLICT
        (contentAsJson(resp) \ "message").as[String] must include("not mapillary")
        run(sql"SELECT COUNT(*) FROM mapillary_source WHERE source_value = $TestCreator".as[Int].head) mustBe 0
      } finally {
        val _ = Await.result(gsvApp.stop(), 60.seconds)
      }
    }
  }

  "DELETE /adminapi/mapillarySources/creators/:username" should {
    "remove a listed creator, then keep succeeding once there is nothing left to remove" in {
      seedTestCreator()
      try {
        val first = request(DELETE, s"$CreatorsUrl/$TestCreator", adminCookies)
        status(first) mustBe OK
        contentAsJson(first) mustBe Json.obj("status" -> "success", "username" -> TestCreator, "removed" -> 1)

        val second = request(DELETE, s"$CreatorsUrl/$TestCreator", adminCookies)
        status(second) mustBe OK
        (contentAsJson(second) \ "removed").as[Int] mustBe 0
      } finally deleteTestCreator()
    }
  }

  "PUT /adminapi/mapillarySources/mode" should {
    "set each mode, show it on the GET, and be restored after" in {
      val original = currentMode()
      try {
        Seq("restrict", "prefer").foreach { mode =>
          val resp = request(PUT, ModeUrl, adminCookies, Some(Json.obj("mode" -> mode)))
          status(resp) mustBe OK
          contentAsJson(resp) mustBe Json.obj("status" -> "success", "mode" -> mode)
          (contentAsJson(request(GET, SourcesUrl, adminCookies)) \ "mode").as[String] mustBe mode
        }
      } finally {
        val _ = run(sqlu"UPDATE config SET mapillary_source_mode = $original")
      }
    }

    "answer 400 for an unknown or missing mode, and change nothing" in {
      val before = currentMode()
      Seq(Json.obj("mode" -> "exclusive"), Json.obj("mode" -> "Prefer"), Json.obj("x" -> 1)).foreach { body =>
        val resp = request(PUT, ModeUrl, adminCookies, Some(body))
        status(resp) mustBe BAD_REQUEST
        (contentAsJson(resp) \ "message").as[String] must include("'prefer' or 'restrict'")
      }
      currentMode() mustBe before
    }
  }
}
