package controllers.api

import modules.CustomErrorHandler
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Verifies that framework-level errors (unknown route, malformed typed param, unhandled exception) on the public
 * `/v3/api` surface are rendered as RFC 7807 `application/problem+json` by `CustomErrorHandler` — consistent with
 * the controller-level errors — while non-API routes keep the site's HTML error handling (#3931).
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

    "keep HTML error handling for non-API paths" in {
      val resp = handler.onClientError(FakeRequest(GET, "/some-web-page"), NOT_FOUND, "")
      status(resp) mustBe NOT_FOUND
      contentType(resp) mustBe Some("text/html")
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
  }
}
