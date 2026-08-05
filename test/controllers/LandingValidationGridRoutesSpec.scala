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
 * Route-wiring smoke test for the two endpoints the landing-page validation grid (#1638) depends on: each must exist,
 * i.e. never answer 404, which is what a routes regression looks like. The label read is user-aware (cookie-less
 * landing visitors have to see the grid) so it reaches the controller; the validation write is a SecuredAction, so an
 * unauthenticated POST bounces into the anonymous-signup flow. Both are asserted only as "not 404" — the exact status
 * belongs to the body-validation and auth contracts, which have their own coverage (GalleryFormatsSpec,
 * LabelServiceSpec, SessionlessPagesSpec) and would otherwise make this spec fail for reasons that aren't its subject.
 */
class LandingValidationGridRoutesSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  "The validation grid's endpoints" should {
    Seq("/label/labels", "/labelmap/validate").foreach { path =>
      s"exist for an unauthenticated POST $path (anything but 404)" in {
        status(route(app, FakeRequest(POST, path).withJsonBody(Json.obj())).get) must not be NOT_FOUND
      }
    }
  }
}
