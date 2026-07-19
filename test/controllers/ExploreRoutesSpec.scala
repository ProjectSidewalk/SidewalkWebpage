package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Route-wiring smoke tests for the Explore page's address-drop-in entry (#4451). Boots the real app and hits
 * /explore?lat&lng unauthenticated: the page is a SecuredAction, so the contract is a redirect to /anonSignUp that
 * preserves the lat/lng query params — that round-trip is what lets a brand-new visitor coming from the LabelMap's
 * "Explore the sidewalks here" button land at their searched address after the anonymous account is minted.
 */
class ExploreRoutesSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  "GET /explore?lat&lng" should {
    "redirect an unauthenticated visitor to /anonSignUp with the address params and return url preserved" in {
      val result = route(app, FakeRequest(GET, "/explore?lat=47.615&lng=-122.332")).get
      status(result) must (be >= 300 and be < 400)

      val location = redirectLocation(result).value
      location must startWith("/anonSignUp")
      location must include("lat=47.615")
      location must include("lng=-122.332")
      location must include("url=%2Fexplore")
    }

    "preserve placeName through the anonSignUp redirect so the drop-in greeting can still name the place" in {
      val result = route(app, FakeRequest(GET, "/explore?lat=47.615&lng=-122.332&placeName=Town%20Hall")).get
      status(result) must (be >= 300 and be < 400)
      redirectLocation(result).value must include("placeName")
    }
  }
}
