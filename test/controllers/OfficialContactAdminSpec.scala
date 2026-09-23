package controllers

import models.user.Role
import models.utils.OfficialContact
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsNull, JsObject, JsValue, Json}
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.ConfigService
import util.{AnonSession, RoleSession}

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Functional tests for the city's official-contact notice (#5462): the admin endpoints on /adminapi/officialContact
 * and the sentence they put under the partner logos on both landing pages.
 *
 * What's worth pinning: the notice is off unless a URL is set, a non-https URL never reaches the public page's href,
 * and a save shows up on the very next landing-page load (the cached read is invalidated). The city's own value is
 * saved in beforeAll and restored in afterAll, so a run against the shared dev DB leaves it as it found it.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class OfficialContactAdminSpec extends PlaySpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // AnonSession mints one session per call and the limiter is per-IP; every suite in a run shares loopback.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val configService = app.injector.instanceOf[ConfigService]

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  private lazy val visitorCookies: Seq[Cookie] = sessionAs(Role.Registered)
  private lazy val adminCookies: Seq[Cookie]   = sessionAs(Role.Administrator)

  private val burnaby = OfficialContact("the City of Burnaby", "https://www.burnaby.ca/our-city/contact-us")

  /** The city's value before the suite ran, put back afterwards. */
  private var original: Option[OfficialContact] = None

  override def beforeAll(): Unit = {
    super.beforeAll()
    original = Await.result(configService.getOfficialContact, 60.seconds)
    Await.result(configService.setOfficialContact(None), 60.seconds)
  }

  override def afterAll(): Unit = {
    // In a `try` because RoleSession's demotion rides super.afterAll.
    try Await.result(configService.setOfficialContact(original), 60.seconds)
    finally super.afterAll()
  }

  private def put(session: Seq[Cookie], body: JsValue) =
    route(
      app,
      FakeRequest(PUT, "/adminapi/officialContact")
        .withHeaders(XHR)
        .withCookies(session: _*)
        .withJsonBody(body)
        .withCSRFToken
    ).get

  private def getSaved: JsObject =
    contentAsJson(
      route(app, FakeRequest(GET, "/adminapi/officialContact").withHeaders(XHR).withCookies(adminCookies: _*)).get
    ).as[JsObject]

  private def body(path: String): String = {
    val resp = route(app, FakeRequest(GET, path)).get
    status(resp) mustBe OK
    contentAsString(resp)
  }

  "the official-contact endpoints" should {
    "refuse a signed-in visitor" in {
      val get = route(
        app,
        FakeRequest(GET, "/adminapi/officialContact").withHeaders(XHR).withCookies(visitorCookies: _*)
      ).get
      status(get) mustBe FORBIDDEN
      status(put(visitorCookies, Json.obj("name" -> burnaby.name, "url" -> burnaby.url))) mustBe FORBIDDEN
    }

    "report the notice as off by default" in {
      getSaved mustBe Json.obj("name" -> JsNull, "url" -> JsNull)
    }

    "save a trimmed contact that the GET then returns" in {
      val resp = put(adminCookies, Json.obj("name" -> s"  ${burnaby.name} ", "url" -> s" ${burnaby.url}  "))
      status(resp) mustBe OK
      (getSaved \ "name").as[String] mustBe burnaby.name
      (getSaved \ "url").as[String] mustBe burnaby.url
    }

    "reject what can't go in a public href, leaving the saved value alone" in {
      Seq(
        Json.obj("name" -> burnaby.name, "url" -> "http://www.burnaby.ca/contact"),
        Json.obj("name" -> burnaby.name, "url" -> "javascript:alert(1)"),
        Json.obj("name" -> burnaby.name, "url" -> "https://"),
        Json.obj("name" -> "   ", "url"        -> burnaby.url),
        Json.obj("name" -> burnaby.name)
      ).foreach { bad => status(put(adminCookies, bad)) mustBe BAD_REQUEST }
      (getSaved \ "url").as[String] mustBe burnaby.url
    }
  }

  "the landing pages" should {
    "show the saved notice under the partner logos, with the name escaped" in {
      status(put(adminCookies, Json.obj("name" -> "the City of <b>Burnaby</b>", "url" -> burnaby.url))) mustBe OK
      Seq("/", "/mobileLanding").foreach { path =>
        val html = body(path)
        html must include("partners-official-contact")
        html must include("Project Sidewalk is a research tool.")
        html must include(s"""<a href="${burnaby.url}" data-partner-source="official-contact">""")
        html must include("the City of &lt;b&gt;Burnaby&lt;/b&gt;")
        html must not include "the City of <b>Burnaby</b>"
        html.indexOf("partners-official-contact") must be < html.indexOf("creators-title")
      }
    }

    "drop the notice once an admin turns it off" in {
      val resp = put(adminCookies, Json.obj("name" -> "", "url" -> ""))
      status(resp) mustBe OK
      getSaved mustBe Json.obj("name" -> JsNull, "url" -> JsNull)
      Seq("/", "/mobileLanding").foreach(path => body(path) must not include "partners-official-contact")
    }
  }
}
