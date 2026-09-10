package controllers

import controllers.helper.SubmissionSpecHelpers
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatest.{Assertion, BeforeAndAfterAll}
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
 * the flag is read back the way the client does, out of the inline `mainParam` assignments. Everything written is
 * keyed to the throwaway anon users the suite mints and is deleted in `afterAll`, so a failed assertion can't leave
 * the shared dev DB altered.
 */
// Mixin order matters: GuiceOneAppPerSuite must be rightmost so its run() wraps BeforeAndAfterAll's — otherwise
// afterAll's cleanup executes after the app (and its DB pool) has shut down and aborts the suite.
class ExploreRouteRequestSpec
    extends PlaySpec
    with BeforeAndAfterAll
    with SubmissionSpecHelpers
    with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  /** An id no route row will realistically carry, standing in for one that was mistyped. */
  private val UnknownRouteId: Int = Int.MaxValue

  /** Users minted by this suite; the routes and walks written under them are deleted in `afterAll`. */
  private var createdUserIds: Set[String] = Set.empty

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
    createdUserIds += bootstrap.userId
    bootstrap.missionType mustBe "auditOnboarding"
    // A real graduate also gets a mission_end stamp and a finished tutorial task; neither is read on any path under
    // test, and the gate itself (MissionTable.hasCompletedAuditOnboarding) asks only whether a completed onboarding
    // mission exists.
    run(sqlu"UPDATE mission SET completed = TRUE WHERE mission_id = ${bootstrap.missionId}") mustBe 1
  }

  /**
   * Deletes every route and walk this suite's users created, in FK order.
   *
   * Routes are the part that must not be left behind: a route row keeps its slug reserved even once soft-deleted,
   * so leaked spec routes would quietly claim share links in a developer's database.
   */
  override def afterAll(): Unit = {
    try {
      createdUserIds.foreach { uId =>
        val _ = run(
          DBIO.seq(
            sqlu"UPDATE mission SET current_audit_task_id = NULL WHERE user_id = $uId",
            sqlu"""DELETE FROM audit_task_user_route
                   WHERE user_route_id IN (SELECT user_route_id FROM user_route WHERE user_id = $uId)""",
            sqlu"DELETE FROM audit_task WHERE user_id = $uId",
            sqlu"DELETE FROM mission WHERE user_id = $uId",
            sqlu"DELETE FROM user_route WHERE user_id = $uId",
            sqlu"""DELETE FROM route_slug_alias
                   WHERE route_id IN (SELECT route_id FROM route WHERE user_id = $uId)""",
            sqlu"DELETE FROM route_street WHERE route_id IN (SELECT route_id FROM route WHERE user_id = $uId)",
            sqlu"DELETE FROM route WHERE user_id = $uId",
            sqlu"DELETE FROM user_current_region WHERE user_id = $uId"
          )
        )
      }
    } finally super.afterAll()
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

    "report it to a user who has no walk to lose, the plain typo case" in {
      val session = freshAnonSession()
      completeOnboarding(session)

      val visit = exploreHtml(session, s"?routeId=$UnknownRouteId")

      pageParam(visit, "routeUnavailable") mustBe Some(JsBoolean(true))
      pageParam(visit, "routeId") mustBe None
    }

    "leave a paused walk paused rather than resuming it on the way past" in {
      val (session, _, userRouteId) = sessionWalkingARoute()
      exploreHtml(session, "?resumeRoute=false")
      walkPaused(userRouteId) mustBe true

      val visit = exploreHtml(session, s"?routeId=$UnknownRouteId")

      // Dropping the id makes the visit an ordinary one, and an ordinary visit doesn't un-exit a route the user
      // left: only an explicit ?routeId= re-enters one (#4833).
      walkPaused(userRouteId) mustBe true
      pageParam(visit, "routeId") mustBe None
      pageParam(visit, "routeUnavailable") mustBe Some(JsBoolean(true))
    }

    // The tutorial suppresses route data on the page (#4816), so this flag is the only thing that survives the
    // visit — the client parks it and shows it on the load after the tutorial. A first-time visitor following a
    // stale share link is exactly who lands here, so if the server stopped emitting it, the one user the whole
    // deferral exists for would silently never hear.
    "flag a dropped route on a tutorial visit, where a first-time visitor following the link lands" in {
      val session   = freshAnonSession()
      val bootstrap = exploreBootstrap(session)
      createdUserIds += bootstrap.userId
      bootstrap.missionType mustBe "auditOnboarding"

      val visit = exploreHtml(session, s"?routeId=$UnknownRouteId")

      pageParam(visit, "routeUnavailable") mustBe Some(JsBoolean(true))
      // Route data stays suppressed for the tutorial's sake, which is why the notice has to wait rather than show.
      pageParam(visit, "routeId") mustBe None
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

    // The one combination where a dropped id still ends a walk. It takes the user spelling out the exit as well, and
    // nothing in the UI emits the pair, so this pins the documented behavior rather than endorsing it.
    "still exit the route when an unresolvable id is paired with an explicit ?resumeRoute=false" in {
      val (session, _, userRouteId) = sessionWalkingARoute()

      val visit = exploreHtml(session, s"?routeId=$UnknownRouteId&resumeRoute=false")

      walkPaused(userRouteId) mustBe true
      pageParam(visit, "routeId") mustBe None
      pageParam(visit, "routeUnavailable") mustBe Some(JsBoolean(true))
    }

    "say nothing about routes on a visit that resolved the one it asked for" in {
      val (session, routeId, _) = sessionWalkingARoute()

      pageParam(exploreHtml(session, s"?routeId=$routeId"), "routeUnavailable") mustBe None
      pageParam(exploreHtml(session, ""), "routeUnavailable") mustBe None
    }
  }
}
