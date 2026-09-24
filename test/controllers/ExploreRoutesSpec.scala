package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._
import models.user.UserAccountStateTable
import models.utils.MyPostgresProfile
import play.api.db.slick.DatabaseConfigProvider
import play.api.mvc.Cookie
import util.{AnonSession, RoleSession}

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Route-wiring smoke tests for the Explore page's address-drop-in entry (#4451). Boots the real app and hits
 * /explore?lat&lng unauthenticated: the page is a SecuredAction, so the contract is a redirect to /anonSignUp that
 * preserves the lat/lng query params — that round-trip is what lets a brand-new visitor coming from the LabelMap's
 * "Explore the sidewalks here" button land at their searched address after the anonymous account is minted.
 */
class ExploreRoutesSpec extends PlaySpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private lazy val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  /** Marks a session's user as past the tutorial, so /explore hands them a real audit mission. */
  private def completeTutorial(cookies: Seq[Cookie]): Unit = {
    val table = app.injector.instanceOf[UserAccountStateTable]
    val _     = Await.result(dbConfig.db.run(table.markExploreTutorialCompleted(userIdOf(cookies))), 30.seconds)
  }

  "GET /explore with a live URL's missionId (#5480)" should {
    "resume the owner's own mission with the pano seed, dropping seed values that are not finite" in {
      val cookies = freshAnonSession()
      completeTutorial(cookies)
      val first = route(app, FakeRequest(GET, "/explore").withCookies(cookies: _*)).get
      status(first) mustBe OK
      val firstHtml = contentAsString(first)
      firstHtml must include(""""mission_type":"audit"""")
      val missionId = """"mission_id":(\d+)""".r.findFirstMatchIn(firstHtml).value.group(1)

      val own = route(
        app,
        FakeRequest(
          GET,
          s"/explore?lat=47.615&lng=-122.332&panoId=abc-123&heading=NaN&pitch=1&zoom=Infinity&missionId=$missionId"
        ).withCookies(cookies: _*)
      ).get
      status(own) mustBe OK
      val html = contentAsString(own)
      // The same mission as the bare visit, not a drop-in, and the seed rode along.
      html must include(s""""mission_id":$missionId""")
      html must include(""""mission_type":"audit"""")
      html must include("mainParam.startPanoId = \"abc-123\"")
      html must include("mainParam.startLat = 47.615")
      // A POV whose heading is not a number is no POV.
      html must not include "mainParam.startPov"

      // With a real heading, the non-finite refinements fall back to their defaults instead of reaching the page.
      val refined = route(
        app,
        FakeRequest(GET, s"/explore?lat=47.615&lng=-122.332&heading=90&pitch=NaN&zoom=Infinity&missionId=$missionId")
          .withCookies(cookies: _*)
      ).get
      status(refined) mustBe OK
      contentAsString(refined) must include("mainParam.startPov = { heading: 90.0, pitch: 0.0, zoom: 1.0 }")
    }

    "treat another user's missionId as inert: the recipient never enters that mission" in {
      val owner = freshAnonSession()
      completeTutorial(owner)
      val ownerPage = contentAsString(route(app, FakeRequest(GET, "/explore").withCookies(owner: _*)).get)
      val missionId = """"mission_id":(\d+)""".r.findFirstMatchIn(ownerPage).value.group(1)

      val recipient = freshAnonSession()
      val result    = route(
        app,
        FakeRequest(GET, s"/explore?lat=47.615&lng=-122.332&panoId=abc-123&missionId=$missionId")
          .withCookies(recipient: _*)
      ).get
      status(result) mustBe OK
      val html = contentAsString(result)
      html must not include s""""mission_id":$missionId"""
      // The seed is rendered only for the drop-in mission (when a street is near enough) — never as a resumed one.
      if (html.contains("mainParam.startPanoId")) html must include(""""mission_type":"exploreAddress"""")
    }

    "never seed the tutorial, even for the owner of its onboarding mission" in {
      val cookies = freshAnonSession()
      val first   = contentAsString(route(app, FakeRequest(GET, "/explore").withCookies(cookies: _*)).get)
      first must include(""""mission_type":"auditOnboarding"""")
      val missionId = """"mission_id":(\d+)""".r.findFirstMatchIn(first).value.group(1)

      val result = route(
        app,
        FakeRequest(GET, s"/explore?lat=47.615&lng=-122.332&panoId=abc-123&heading=90&missionId=$missionId")
          .withCookies(cookies: _*)
      ).get
      status(result) mustBe OK
      val html = contentAsString(result)
      html must include(s""""mission_id":$missionId""")
      html must not include "mainParam.startPanoId"
      html must not include "mainParam.startPov"
    }
  }

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

    "preserve a pano + POV seed through the anonSignUp redirect so the label card's hop survives sign-up (#4637)" in {
      val result = route(
        app,
        FakeRequest(GET, "/explore?lat=47.615&lng=-122.332&panoId=abc-123&heading=182.5&pitch=-10.2&zoom=2")
      ).get
      status(result) must (be >= 300 and be < 400)

      val location = redirectLocation(result).value
      location must include("panoId")
      location must include("heading")
      location must include("pitch")
      location must include("zoom")
    }

    "bind a fractional zoom, since the live URL writes the wheel's continuous value (#5480)" in {
      val result =
        route(app, FakeRequest(GET, "/explore?lat=47.615&lng=-122.332&panoId=abc-123&heading=90&zoom=1.75")).get
      // An Int binder would answer 400 here before any redirect.
      status(result) must (be >= 300 and be < 400)
      redirectLocation(result).value must include("zoom=1.75")
    }
  }
}
