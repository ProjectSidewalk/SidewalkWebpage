package controllers

import controllers.helper.SubmissionSpecHelpers
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatest.Assertion
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsBoolean, JsValue, Json}
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * In-JVM functional tests for how /explore answers a ?routeId= it can't resolve (#5156).
 *
 * The contract has two halves, and the second is the one that bit: a mistyped or since-deleted id must be *reported*
 * rather than silently downgraded to an ordinary session, and it must leave the user's existing route walk alone.
 * Before the fix it fell into the arm written for the deliberate "leave my route" exit (?resumeRoute=false), which
 * pauses every active walk — so a typo knocked a labeler out of a route they were legitimately in. That exit path is
 * asserted here too, since the fix works by keeping it reachable only through the explicit parameter.
 *
 * Boots the real app against Postgres so routing, Silhouette, the DAO layer, and the page's bootstrap script all run;
 * the flag is read back the way the client does, out of the inline `mainParam` assignments.
 */
class ExploreRouteRequestSpec extends PlaySpec with GuiceOneAppPerSuite with SubmissionSpecHelpers {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  /** An id no route row can carry, standing in for one that was mistyped. */
  private val UnknownRouteId: Int = Int.MaxValue

  /** Loads /explore for the session and returns the rendered page. */
  private def exploreHtml(session: Seq[Cookie], query: String): String = {
    val resp = route(app, FakeRequest(GET, s"/explore$query").withCookies(session: _*)).get
    withClue(s"/explore$query: ") { status(resp) mustBe OK }
    contentAsString(resp)
  }

  /** Reads one of the page's `mainParam.<name> = <json>;` bootstrap assignments, as the client does. */
  private def pageParam(html: String, name: String): Option[JsValue] = embeddedPageJson(html, s"mainParam.$name")

  /** Saves a one-street route in a region the connected schema actually has, and returns its id. */
  private def saveRoute(session: Seq[Cookie]): Int = {
    val streets = route(
      app,
      FakeRequest(GET, "/contribution/streets/all?filterLowQuality=true").withCookies(session: _*)
    ).get
    status(streets) mustBe OK
    val feature = (contentAsJson(streets) \ "features")
      .as[Seq[JsValue]]
      .headOption
      .getOrElse(cancel("No routable street in the connected schema; a route can't be built."))
    val body = Json.obj(
      "region_id" -> (feature \ "properties" \ "region_id").as[Int],
      "name"      -> s"Explore Route Param Spec ${java.util.UUID.randomUUID()}",
      "streets"   -> Json.arr(
        Json.obj("street_id" -> (feature \ "properties" \ "street_edge_id").as[Int], "reverse" -> false)
      )
    )
    val saved = route(
      app,
      FakeRequest(POST, "/saveRoute").withHeaders(XHR).withCookies(session: _*).withJsonBody(body).withCSRFToken
    ).get
    status(saved) mustBe OK
    (contentAsJson(saved) \ "route_id").as[Int]
  }

  /** Soft-deletes a route the session owns. */
  private def deleteRoute(session: Seq[Cookie], routeId: Int): Assertion = {
    val resp = route(
      app,
      FakeRequest(DELETE, s"/userapi/routes/$routeId").withHeaders(XHR).withCookies(session: _*).withCSRFToken
    ).get
    status(resp) mustBe OK
  }

  /** Whether the walk has been paused — the state a stray ?routeId= must not be able to put a user in. */
  private def walkPaused(userRouteId: Int): Boolean =
    run(sql"SELECT paused FROM user_route WHERE user_route_id = $userRouteId".as[Boolean].head)

  /**
   * Puts the tutorial behind a brand-new account, which every one of them is served first.
   *
   * Nothing about routes is observable until then: the tutorial takes over the session and deliberately suppresses
   * route data on the page (#4816). Completed by writing the row, since driving the tutorial needs a panorama. The
   * call doubles as the schema precondition — `exploreBootstrap` cancels where /explore can't be served at all, so
   * the assertions that follow fail only on real breakage.
   */
  private def completeOnboarding(session: Seq[Cookie]): Assertion = {
    val bootstrap = exploreBootstrap(session)
    bootstrap.missionType mustBe "auditOnboarding"
    run(sqlu"UPDATE mission SET completed = TRUE WHERE mission_id = ${bootstrap.missionId}") mustBe 1
  }

  /** Enters a freshly saved route and returns the session, the route, and the walk it started. */
  private def sessionWalkingARoute(): (Seq[Cookie], Int, Int) = {
    val session = freshAnonSession()
    completeOnboarding(session)

    val routeId = saveRoute(session)
    val entered = exploreHtml(session, s"?routeId=$routeId")
    pageParam(entered, "routeId").map(_.as[Int]) mustBe Some(routeId)
    val userRouteId = pageParam(entered, "userRouteId")
      .map(_.as[Int])
      .getOrElse(fail("Entering a route left no walk in the explore bootstrap."))
    walkPaused(userRouteId) mustBe false
    (session, routeId, userRouteId)
  }

  "GET /explore?routeId=<unresolvable>" should {
    "report the dropped route instead of passing the visit off as an ordinary session" in {
      val (session, _, _) = sessionWalkingARoute()

      pageParam(exploreHtml(session, s"?routeId=$UnknownRouteId"), "routeUnavailable") mustBe Some(JsBoolean(true))
    }

    "leave the walk the user is already in running, rather than pausing it on the strength of a typo" in {
      val (session, routeId, userRouteId) = sessionWalkingARoute()

      val visit = exploreHtml(session, s"?routeId=$UnknownRouteId")

      // The walk survives, and this very visit continues it: an id that resolves to nothing is dropped, leaving the
      // session to run exactly as if no route had been asked for.
      walkPaused(userRouteId) mustBe false
      pageParam(visit, "routeId").map(_.as[Int]) mustBe Some(routeId)
      pageParam(visit, "userRouteId").map(_.as[Int]) mustBe Some(userRouteId)
    }

    "report a route that was deleted after its link was shared" in {
      val (session, routeId, _) = sessionWalkingARoute()
      deleteRoute(session, routeId)

      val visit = exploreHtml(session, s"?routeId=$routeId")
      pageParam(visit, "routeUnavailable") mustBe Some(JsBoolean(true))
      // Deleting the route ends its walk as a place to be, so the page is a plain session rather than a route one.
      pageParam(visit, "routeId") mustBe None
    }
  }

  "GET /explore" should {
    "still exit the route on an explicit ?resumeRoute=false" in {
      val (session, _, userRouteId) = sessionWalkingARoute()

      val exited = exploreHtml(session, "?resumeRoute=false")

      walkPaused(userRouteId) mustBe true
      pageParam(exited, "routeId") mustBe None
      pageParam(exited, "routeUnavailable") mustBe None
    }

    "say nothing about routes on a visit that resolved the one it asked for" in {
      val (session, routeId, _) = sessionWalkingARoute()

      pageParam(exploreHtml(session, s"?routeId=$routeId"), "routeUnavailable") mustBe None
      pageParam(exploreHtml(session, ""), "routeUnavailable") mustBe None
    }
  }
}
