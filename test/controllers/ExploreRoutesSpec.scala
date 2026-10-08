package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsValue
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import models.user.UserAccountStateTable
import models.utils.MyPostgresProfile
import play.api.db.slick.DatabaseConfigProvider
import play.api.mvc.Cookie
import util.{AnonSession, RoleSession, SidewalkSpec}

import scala.concurrent.Await
import scala.concurrent.duration.*

/**
 * Route-wiring smoke tests for the Explore page's address-drop-in entry (#4451). Boots the real app and hits
 * /explore?lat&lng unauthenticated: the page is a SecuredAction, so the contract is a redirect to /anonSignUp that
 * preserves the lat/lng query params — that round-trip is what lets a brand-new visitor coming from the LabelMap's
 * "Explore the sidewalks here" button land at their searched address after the anonymous account is minted.
 *
 * The session a visit resolves to is read from /explore/session, which the page asks with the query it was opened
 * with (#5650); the page itself carries no mission, and says so with a `Cache-Control: no-store`.
 */
class ExploreRoutesSpec extends SidewalkSpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  given mat: Materializer = app.materializer

  private lazy val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  /** Marks a session's user as past the tutorial, so Explore hands them a real audit mission. */
  private def completeTutorial(cookies: Seq[Cookie]): Unit = {
    val table = app.injector.instanceOf[UserAccountStateTable]
    val _     = Await.result(dbConfig.db.run(table.markExploreTutorialCompleted(userIdOf(cookies))), 30.seconds)
  }

  /** Resolves the session an Explore visit with this query starts in, as the page asks for it. */
  private def exploreSession(cookies: Seq[Cookie], query: String): JsValue = {
    val result = route(app, FakeRequest(GET, s"/explore/session$query").withCookies(cookies*)).get
    withClue(s"/explore/session$query: ") { status(result) mustBe OK }
    contentAsJson(result)
  }

  "GET /explore/session with a live URL's missionId (#5480)" should {
    "resume the owner's own mission with the pano seed, dropping seed values that are not finite" in {
      val cookies = freshAnonSession()
      completeTutorial(cookies)
      val first = exploreSession(cookies, "")
      (first \ "mission" \ "mission_type").as[String] mustBe "audit"
      val missionId = (first \ "mission" \ "mission_id").as[Int]

      val own = exploreSession(
        cookies,
        s"?lat=47.615&lng=-122.332&panoId=abc-123&heading=NaN&pitch=1&zoom=Infinity&missionId=$missionId"
      )
      // The same mission as the bare visit, not a drop-in, and the seed rode along.
      (own \ "mission" \ "mission_id").as[Int] mustBe missionId
      (own \ "mission" \ "mission_type").as[String] mustBe "audit"
      (own \ "start_pano_id").as[String] mustBe "abc-123"
      (own \ "start_lat").as[Double] mustBe 47.615
      // A POV whose heading is not a number is no POV.
      (own \ "start_pov").toOption mustBe None

      // With a real heading, the non-finite refinements fall back to their defaults instead of reaching the page.
      val refined = exploreSession(
        cookies,
        s"?lat=47.615&lng=-122.332&heading=90&pitch=NaN&zoom=Infinity&missionId=$missionId"
      )
      (refined \ "start_pov" \ "heading").as[Double] mustBe 90.0
      (refined \ "start_pov" \ "pitch").as[Double] mustBe 0.0
      (refined \ "start_pov" \ "zoom").as[Double] mustBe 1.0
    }

    "treat another user's missionId as inert: the recipient never enters that mission" in {
      val owner = freshAnonSession()
      completeTutorial(owner)
      val missionId = (exploreSession(owner, "") \ "mission" \ "mission_id").as[Int]

      val recipient = freshAnonSession()
      val result    = exploreSession(recipient, s"?lat=47.615&lng=-122.332&panoId=abc-123&missionId=$missionId")
      (result \ "mission" \ "mission_id").as[Int] must not be missionId
      // The seed is served only for the drop-in mission (when a street is near enough) — never as a resumed one.
      if ((result \ "start_pano_id").toOption.isDefined) {
        (result \ "mission" \ "mission_type").as[String] mustBe "exploreAddress"
      }
    }

    "never seed the tutorial, even for the owner of its onboarding mission" in {
      val cookies = freshAnonSession()
      val first   = exploreSession(cookies, "")
      (first \ "mission" \ "mission_type").as[String] mustBe "auditOnboarding"
      val missionId = (first \ "mission" \ "mission_id").as[Int]

      val result = exploreSession(cookies, s"?lat=47.615&lng=-122.332&panoId=abc-123&heading=90&missionId=$missionId")
      (result \ "mission" \ "mission_id").as[Int] mustBe missionId
      (result \ "start_pano_id").toOption mustBe None
      (result \ "start_pov").toOption mustBe None
    }
  }

  "GET /explore" should {
    "carry no mission, and tell the browser never to cache the page (#5650)" in {
      val cookies = freshAnonSession()
      val result  = route(app, FakeRequest(GET, "/explore?newRegion=true").withCookies(cookies*)).get
      status(result) mustBe OK
      header(CACHE_CONTROL, result) mustBe Some("no-store")
      contentAsString(result) must not include "mission_id"
      // The page keeps the query it was opened with for its session request.
      contentAsString(result) must include(""""sessionUrl": "/explore/session"""")
    }

    "tell the browser never to cache the session either" in {
      val cookies = freshAnonSession()
      val result  = route(app, FakeRequest(GET, "/explore/session").withCookies(cookies*)).get
      status(result) mustBe OK
      header(CACHE_CONTROL, result) mustBe Some("no-store")
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
      status(result) must (be >= 300 and be < 400)
      redirectLocation(result).value must include("zoom=1.75")

      // The session endpoint is where the value is bound; an Int binder would answer 400 here.
      val cookies = freshAnonSession()
      completeTutorial(cookies)
      val missionId = (exploreSession(cookies, "") \ "mission" \ "mission_id").as[Int]
      val seeded    =
        exploreSession(cookies, s"?lat=47.615&lng=-122.332&panoId=abc-123&heading=90&zoom=1.75&missionId=$missionId")
      (seeded \ "start_pov" \ "zoom").as[Double] mustBe 1.75
    }
  }
}
