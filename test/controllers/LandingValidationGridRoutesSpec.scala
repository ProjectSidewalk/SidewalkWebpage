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
 * Route-wiring smoke test for the two endpoints the landing-page validation grid (#1638) depends on. Both are
 * SecuredActions, so the unauthenticated contract is a redirect to the anonymous-signup flow (3xx) — never a 404,
 * which would mean a routes regression. The grid's real behavior is covered by GalleryFormatsSpec/LabelServiceSpec.
 */
class LandingValidationGridRoutesSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  "The validation grid's endpoints" should {
    Seq("/label/labels", "/labelmap/validate").foreach { path =>
      s"exist and redirect an unauthenticated POST $path (3xx, not 404)" in {
        val sc = status(route(app, FakeRequest(POST, path).withJsonBody(Json.obj())).get)
        (sc >= 300 && sc < 400) mustBe true
      }
    }
  }
}
