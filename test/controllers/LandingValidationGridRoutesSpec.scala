package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Route-wiring smoke test for the two endpoints the landing-page validation grid (#1638) depends on — never a 404,
 * which would mean a routes regression. The label read is user-aware since #4643 (cookie-less landing visitors must
 * see the grid), so an empty unauthenticated POST reaches its JSON validation (400); the validation write is still a
 * SecuredAction, so its unauthenticated contract remains a redirect into the anonymous-signup flow (3xx). The grid's
 * real behavior is covered by GalleryFormatsSpec/LabelServiceSpec, and the cookie-less read by SessionlessPagesSpec.
 */
class LandingValidationGridRoutesSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  "The validation grid's endpoints" should {
    "exist and let an unauthenticated POST /label/labels through to JSON validation (400, not 404/3xx)" in {
      status(route(app, FakeRequest(POST, "/label/labels").withJsonBody(Json.obj())).get) mustBe BAD_REQUEST
    }

    "exist and redirect an unauthenticated POST /labelmap/validate (3xx, not 404)" in {
      val sc = status(route(app, FakeRequest(POST, "/labelmap/validate").withJsonBody(Json.obj())).get)
      (sc >= 300 && sc < 400) mustBe true
    }
  }
}
