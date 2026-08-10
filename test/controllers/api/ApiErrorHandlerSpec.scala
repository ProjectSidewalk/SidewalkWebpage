package controllers.api

import modules.CustomErrorHandler
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.{Application, Mode}
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Verifies that framework-level errors (unknown route, malformed typed param, unhandled exception) on the public
 * `/v3/api` surface are rendered as RFC 7807 `application/problem+json` by `CustomErrorHandler` — consistent with
 * the controller-level errors (#3931) — while non-API routes render the branded HTML error pages (#3954).
 *
 * These exercise the error handler directly: Play's `route()` test helper returns `None` for an unmatched path
 * (it never invokes the error handler), so an unknown-route 404 can't be asserted through `route()`.
 */
class ApiErrorHandlerSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer     = app.materializer
  private def handler: CustomErrorHandler = app.injector.instanceOf[CustomErrorHandler]

  "CustomErrorHandler.onClientError" should {
    "render a 404 on an unknown /v3/api path as RFC 7807 problem+json" in {
      val resp = handler.onClientError(FakeRequest(GET, "/v3/api/doesNotExist"), NOT_FOUND, "")
      status(resp) mustBe NOT_FOUND
      contentType(resp) mustBe Some("application/problem+json")
      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "about:blank"
      (json \ "title").as[String] mustBe "Not Found"
      (json \ "status").as[Int] mustBe 404
      (json \ "code").as[String] mustBe "NOT_FOUND"
      (json \ "detail").asOpt[String] mustBe defined
    }

    "render a 400 on a /v3/api path (e.g. malformed typed route param) as problem+json" in {
      val resp = handler.onClientError(FakeRequest(GET, "/v3/api/streets"), BAD_REQUEST, "Cannot parse parameter")
      status(resp) mustBe BAD_REQUEST
      contentType(resp) mustBe Some("application/problem+json")
      (contentAsJson(resp) \ "code").as[String] mustBe "BAD_REQUEST"
    }

    "NOT match /v3/api-docs paths (those are HTML doc pages)" in {
      val resp = handler.onClientError(FakeRequest(GET, "/v3/api-docs/nope"), NOT_FOUND, "")
      contentType(resp) mustBe Some("text/html")
    }

    "render the branded 404 page with the requested path for non-API paths" in {
      val resp = handler.onClientError(FakeRequest(GET, "/some-web-page"), NOT_FOUND, "")
      status(resp) mustBe NOT_FOUND
      contentType(resp) mustBe Some("text/html")
      val body = contentAsString(resp)
      body must include("404")
      body must include("Page not found")
      body must include("/some-web-page")
    }
  }

  "CustomErrorHandler.onServerError" should {
    "render a 500 on a /v3/api path as problem+json without leaking the exception detail" in {
      val resp =
        handler.onServerError(FakeRequest(GET, "/v3/api/streets"), new RuntimeException("secret-internal-detail"))
      status(resp) mustBe INTERNAL_SERVER_ERROR
      contentType(resp) mustBe Some("application/problem+json")
      val json = contentAsJson(resp)
      (json \ "code").as[String] mustBe "INTERNAL_SERVER_ERROR"
      (json \ "detail").as[String] must not include "secret-internal-detail"
    }

    "render the branded 500 page with an error id for non-API paths in prod mode" in {
      // The branded 500 only dispatches in prod (dev/test show Play's stack-trace page), so this needs its own
      // prod-mode app. Prod refuses the default application secret, so one is set explicitly; evolutions are
      // disabled because the handler renders without touching the schema.
      val prodApp = new GuiceApplicationBuilder()
        .in(Mode.Prod)
        .configure(
          "play.http.secret.key"    -> "prod-mode-test-secret-0123456789abcdef0123456789abcdef0123456789",
          "play.evolutions.enabled" -> false
        )
        .disable[modules.ActorModule]
        .build()
      try {
        val resp = prodApp.injector
          .instanceOf[CustomErrorHandler]
          .onServerError(FakeRequest(GET, "/some-web-page"), new RuntimeException("secret-internal-detail"))
        status(resp) mustBe INTERNAL_SERVER_ERROR
        contentType(resp) mustBe Some("text/html")
        val body = contentAsString(resp)
        body must include("500")
        body must include("Something went wrong")
        body must include("Error ID:")
        body must not include "secret-internal-detail"
      } finally { await(prodApp.stop()); () }
    }
  }
}
