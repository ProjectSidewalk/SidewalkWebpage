package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Public pages must render for cookie-less requests WITHOUT minting an anonymous account (issue #4643).
 *
 * Historically every public page was a `SecuredAction`, so a cookie-less visit (every crawler hit, every first-time
 * visitor) 303-bounced through /anonSignUp and created a DB user + authenticator per hit. These specs pin the new
 * contract for the converted pages and the data endpoints they call on load: a bare GET (no cookies at all) returns
 * the page's normal status and sets no Silhouette authenticator cookie. Mirrors the /label/:id assertions in
 * ShareControllerSpec.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class SessionlessPagesSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  implicit lazy val mat: Materializer = app.materializer

  /** The Silhouette authenticator cookie name ("test-authenticator" here); setting it means a session was minted. */
  private lazy val authCookieName: String = app.configuration.get[String]("silhouette.authenticator.cookieName")

  /** A representative set of the converted pages: landing, static/docs pages, and the JS-app pages. */
  private val publicPages: Seq[String] = Seq(
    "/", "/help", "/about", "/api", "/terms", "/cities", "/leaderboard", "/gallery", "/labelMap", "/routeBuilder",
    "/mobileLanding", "/labelingGuide", "/labelingGuide/curbRamps", "/v3/api-docs/rawLabels"
  )

  "Converted public pages" should {
    "render 200 for a cookie-less GET without setting the authenticator cookie" in {
      publicPages.foreach { path =>
        val resp = route(app, FakeRequest(GET, path)).get
        withClue(s"GET $path (cookie-less): ") {
          status(resp) mustBe OK
          cookies(resp).get(authCookieName) mustBe None
        }
      }
    }

    "redirect a cookie-less mobile visitor from / to /mobileLanding without setting the authenticator cookie" in {
      val mobileUa = "User-Agent" -> "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
      val resp     = route(app, FakeRequest(GET, "/").withHeaders(mobileUa)).get
      status(resp) mustBe SEE_OTHER
      redirectLocation(resp).value mustBe "/mobileLanding"
      cookies(resp).get(authCookieName) mustBe None
    }

    "redirect a mobile visitor away from /labelMap without minting a session" in {
      val mobileUa = "User-Agent" -> "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
      val resp     = route(app, FakeRequest(GET, "/labelMap").withHeaders(mobileUa)).get
      status(resp) mustBe SEE_OTHER
      redirectLocation(resp).value mustBe "/mobileLanding"
      cookies(resp).get(authCookieName) mustBe None
    }
  }

  "Data endpoints the public pages call on load" should {
    "serve /neighborhoods to a cookie-less request without setting the authenticator cookie" in {
      val resp = route(app, FakeRequest(GET, "/neighborhoods")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")
      (contentAsJson(resp) \ "type").as[String] mustBe "FeatureCollection"
      cookies(resp).get(authCookieName) mustBe None
    }

    "serve the gallery/landing-grid label read (POST /label/labels) to a cookie-less request" in {
      val body = Json.obj(
        "n"                  -> 5,
        "loaded_labels"      -> Json.arr(),
        "validation_options" -> Json.arr("unvalidated", "unsure")
      )
      val resp = route(app, FakeRequest(POST, "/label/labels").withJsonBody(body).withCSRFToken).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "labelsOfType").toOption mustBe defined
      cookies(resp).get(authCookieName) mustBe None
    }

    "accept a cookie-less activity beacon (POST /userapi/logWebpageActivity) without setting the authenticator" in {
      val resp = route(
        app,
        FakeRequest(POST, "/userapi/logWebpageActivity")
          .withJsonBody(Json.toJson("Test_SessionlessBeacon"))
          .withCSRFToken
      ).get
      status(resp) mustBe OK
      cookies(resp).get(authCookieName) mustBe None
    }
  }

  "A cookie-less request to an endpoint that still requires an account" should {
    "answer a write with 401 rather than a bounce, so the submission isn't swallowed" in {
      // Following a bounce turns the write into a GET and lands it on a 200 HTML page, so the caller reads success
      // while nothing was submitted. A 401 lets the client mint a session and retry it (util.lazyIdentityFetch,
      // #4442). FakeRequest sends no Sec-Fetch-Mode, which is the case the method has to decide.
      val resp = route(app, FakeRequest(POST, "/labelmap/validate").withJsonBody(Json.obj()).withCSRFToken).get
      status(resp) mustBe UNAUTHORIZED
      header(LOCATION, resp) mustBe empty
    }

    "still bounce a navigation through /anonSignUp, which is what the flow is for" in {
      val resp = route(app, FakeRequest(GET, "/explore")).get
      status(resp) mustBe SEE_OTHER
      redirectLocation(resp).value must startWith("/anonSignUp")
    }
  }

  "The anonymous-signup flow itself" should {
    // Control test: proves the cookie assertions above are falsifiable (the cookie machinery does mint one here).
    "still mint an authenticator cookie, for the pages that still require an account" in {
      val resp = route(app, FakeRequest(GET, "/anonSignUp?url=%2F")).get
      status(resp) mustBe SEE_OTHER
      cookies(resp).get(authCookieName) mustBe defined
    }
  }
}
