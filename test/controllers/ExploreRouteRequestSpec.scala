package controllers

import controllers.helper.SubmissionSpecHelpers
import models.utils.MyPostgresProfile.api.*
import org.apache.pekko.stream.Materializer
import org.scalatest.concurrent.Eventually
import org.scalatest.time.{Millis, Seconds, Span}
import org.scalatest.{Assertion, BeforeAndAfterAll}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsBoolean, JsValue, Json}
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper.*
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.SidewalkSpec

/**
 * In-JVM functional tests for how an Explore visit answers a ?routeId= it can't resolve (#5156), through
 * /explore/session, which the page asks for its session with the query it was opened with.
 *
 * The contract has two halves, and the second is the one that bit: a mistyped or since-deleted id must be *reported*
 * rather than silently downgraded to an ordinary session, and it must leave the user's existing route walk alone.
 * Before the fix it fell into the arm written for the deliberate "leave my route" exit (?resumeRoute=false), which
 * pauses every active walk — so a typo knocked a labeler out of a route they were legitimately in. That exit path is
 * asserted here too, since the fix works by keeping it reachable only through the explicit parameter.
 *
 * Boots the real app against Postgres so routing, Silhouette and the DAO layer all run; the flag is read back the way
 * the client does, out of the /explore/session answer. Everything written is
 * keyed to the throwaway anon users the suite mints and is deleted in `afterAll`, so a failed assertion can't leave
 * the shared dev DB altered.
 */
// Mixin order matters: GuiceOneAppPerSuite must be rightmost so its run() wraps BeforeAndAfterAll's — otherwise
// afterAll's cleanup executes after the app (and its DB pool) has shut down and aborts the suite.
class ExploreRouteRequestSpec
    extends SidewalkSpec
    with BeforeAndAfterAll
    with SubmissionSpecHelpers
    with Eventually
    with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  given mat: Materializer = app.materializer

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  /** An id no route row will realistically carry, standing in for one that was mistyped. */
  private val UnknownRouteId: Int = Int.MaxValue

  /** Users minted by this suite; the routes and walks written under them are deleted in `afterAll`. */
  private var createdUserIds: Set[String] = Set.empty

  /** Resolves an Explore visit's session through /explore/session, as the page does for the query it opened with. */
  private def exploreSession(session: Seq[Cookie], query: String): JsValue = {
    val resp = route(app, FakeRequest(GET, s"/explore/session$query").withCookies(session*)).get
    withClue(s"/explore/session$query: ") { status(resp) mustBe OK }
    contentAsJson(resp)
  }

  /** Reads one of the session's fields, as the client does; None when the server left it out. */
  private def pageParam(session: JsValue, name: String): Option[JsValue] = (session \ name).toOption

  /** A street that isn't open but sits in an open region; cancels the case where the schema has none. */
  private def unopenedStreetId(): Int = run(
    sql"""SELECT street_edge.street_edge_id
          FROM street_edge
          INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
          INNER JOIN region ON street_edge_region.region_id = region.region_id
          WHERE street_edge.status <> 'open' AND NOT region.deleted
          LIMIT 1""".as[Int].headOption
  ).getOrElse(cancel("No unopened street in an open region; nothing to exercise."))

  /** A street the connected schema actually has and serves for routing; cancels the case where there is none. */
  private def routableStreetId(session: Seq[Cookie]): Int = {
    val streets = route(
      app,
      FakeRequest(GET, "/contribution/streets/all?filterLowQuality=true").withCookies(session*)
    ).get
    status(streets) mustBe OK
    (contentAsJson(streets) \ "features")
      .as[Seq[JsValue]]
      .headOption
      .map(feature => (feature \ "properties" \ "street_edge_id").as[Int])
      .getOrElse(cancel("No routable street in the connected schema; a route can't be built."))
  }

  /** Saves a one-street route on a real street through the RouteBuilder endpoint, as a user does; returns its id. */
  private def saveRoute(session: Seq[Cookie]): Int = {
    val body = Json.obj(
      "name"    -> s"Explore Route Param Spec ${java.util.UUID.randomUUID()}",
      "streets" -> Json.arr(Json.obj("street_id" -> routableStreetId(session), "reverse" -> false))
    )
    val saved = route(
      app,
      FakeRequest(POST, "/saveRoute").withHeaders(XHR).withCookies(session*).withJsonBody(body).withCSRFToken
    ).get
    status(saved) mustBe OK
    (contentAsJson(saved) \ "route_id").as[Int]
  }

  /** Soft-deletes a route the session owns. */
  private def deleteRoute(session: Seq[Cookie], routeId: Int): Assertion = {
    val resp = route(
      app,
      FakeRequest(DELETE, s"/userapi/routes/$routeId").withHeaders(XHR).withCookies(session*).withCSRFToken
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
    // test. Whether to serve the tutorial is decided by the account-wide user_account_state row, so that's written too.
    run(sqlu"UPDATE mission SET completed = TRUE WHERE mission_id = ${bootstrap.missionId}") mustBe 1
    run(sqlu"""INSERT INTO sidewalk_login.user_account_state (user_id, explore_tutorial_completed_at)
               VALUES (${bootstrap.userId}, now())""") mustBe 1
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
            sqlu"DELETE FROM user_current_region WHERE user_id = $uId",
            sqlu"DELETE FROM sidewalk_login.user_account_state WHERE user_id = $uId"
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
    val entered = exploreSession(session, s"?routeId=$routeId")
    pageParam(entered, "route_id").map(_.as[Int]) mustBe Some(routeId)
    val userRouteId = pageParam(entered, "user_route_id")
      .map(_.as[Int])
      .getOrElse(fail("Entering a route left no walk in the explore bootstrap."))
    walkPaused(userRouteId) mustBe false
    (session, routeId, userRouteId)
  }

  "GET /explore/session?routeId=<unresolvable>" should {
    "report the dropped route instead of passing the visit off as an ordinary session" in {
      val (session, _, _) = sessionWalkingARoute()

      pageParam(exploreSession(session, s"?routeId=$UnknownRouteId"), "route_unavailable") mustBe Some(JsBoolean(true))
    }

    "leave the walk the user is already in running, rather than pausing it on the strength of a typo" in {
      val (session, routeId, userRouteId) = sessionWalkingARoute()

      val visit = exploreSession(session, s"?routeId=$UnknownRouteId")

      // The walk survives, and this very visit continues it: an id that resolves to nothing is dropped, leaving the
      // session to run exactly as if no route had been asked for.
      walkPaused(userRouteId) mustBe false
      pageParam(visit, "route_id").map(_.as[Int]) mustBe Some(routeId)
      pageParam(visit, "user_route_id").map(_.as[Int]) mustBe Some(userRouteId)
    }

    "report it to a user who has no walk to lose, the plain typo case" in {
      val session = freshAnonSession()
      completeOnboarding(session)

      val visit = exploreSession(session, s"?routeId=$UnknownRouteId")

      pageParam(visit, "route_unavailable") mustBe Some(JsBoolean(true))
      pageParam(visit, "route_id") mustBe None
    }

    "leave a paused walk paused rather than resuming it on the way past" in {
      val (session, _, userRouteId) = sessionWalkingARoute()
      exploreSession(session, "?resumeRoute=false")
      walkPaused(userRouteId) mustBe true

      val visit = exploreSession(session, s"?routeId=$UnknownRouteId")

      // Dropping the id makes the visit an ordinary one, and an ordinary visit doesn't un-exit a route the user
      // left: only an explicit ?routeId= re-enters one (#4833).
      walkPaused(userRouteId) mustBe true
      pageParam(visit, "route_id") mustBe None
      pageParam(visit, "route_unavailable") mustBe Some(JsBoolean(true))
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

      val visit = exploreSession(session, s"?routeId=$UnknownRouteId")

      pageParam(visit, "route_unavailable") mustBe Some(JsBoolean(true))
      // Route data stays suppressed for the tutorial's sake, which is why the notice has to wait rather than show.
      pageParam(visit, "route_id") mustBe None
    }

    "report a route that was deleted after its link was shared" in {
      val (session, routeId, _) = sessionWalkingARoute()
      deleteRoute(session, routeId)

      val visit = exploreSession(session, s"?routeId=$routeId")
      pageParam(visit, "route_unavailable") mustBe Some(JsBoolean(true))
      // Deleting the route ends its walk as a place to be, so the page is a plain session rather than a route one.
      pageParam(visit, "route_id") mustBe None
    }
  }

  "GET /explore/session" should {
    "still exit the route on an explicit ?resumeRoute=false" in {
      val (session, _, userRouteId) = sessionWalkingARoute()

      val exited = exploreSession(session, "?resumeRoute=false")

      walkPaused(userRouteId) mustBe true
      pageParam(exited, "route_id") mustBe None
      pageParam(exited, "route_unavailable") mustBe Some(JsBoolean(false))
    }

    // The one combination where a dropped id still ends a walk. It takes the user spelling out the exit as well, and
    // nothing in the UI emits the pair, so this pins the documented behavior rather than endorsing it.
    "still exit the route when an unresolvable id is paired with an explicit ?resumeRoute=false" in {
      val (session, _, userRouteId) = sessionWalkingARoute()

      val visit = exploreSession(session, s"?routeId=$UnknownRouteId&resumeRoute=false")

      walkPaused(userRouteId) mustBe true
      pageParam(visit, "route_id") mustBe None
      pageParam(visit, "route_unavailable") mustBe Some(JsBoolean(true))
    }

    "say nothing about routes on a visit that resolved the one it asked for" in {
      val (session, routeId, _) = sessionWalkingARoute()

      pageParam(exploreSession(session, s"?routeId=$routeId"), "route_unavailable") mustBe Some(JsBoolean(false))
      pageParam(exploreSession(session, ""), "route_unavailable") mustBe Some(JsBoolean(false))
    }
  }

  /**
   * The smallest region holding a street Explore can serve, and one such street in it. Smallest because finishing it
   * gives the user one task per street, and cleanup deletes each slowly (unindexed foreign keys on audit_task).
   */
  private def smallestServableRegion(): (Int, Int) = {
    val regionId: Int = run(
      sql"""SELECT street_edge_region.region_id
            FROM street_edge_region
            INNER JOIN region ON street_edge_region.region_id = region.region_id
            WHERE NOT region.deleted
              AND street_edge_region.region_id IN (
                SELECT street_edge_region.region_id
                FROM street_edge_region
                INNER JOIN street_edge_priority
                  ON street_edge_region.street_edge_id = street_edge_priority.street_edge_id
                INNER JOIN osm_way_street_edge_primary
                  ON street_edge_region.street_edge_id = osm_way_street_edge_primary.street_edge_id
              )
            GROUP BY street_edge_region.region_id
            ORDER BY COUNT(*)
            LIMIT 1""".as[Int].headOption
    ).getOrElse(cancel("No region holds a street Explore can serve."))
    val streetEdgeId: Int = run(
      sql"""SELECT street_edge_region.street_edge_id
            FROM street_edge_region
            INNER JOIN street_edge ON street_edge_region.street_edge_id = street_edge.street_edge_id
            INNER JOIN street_edge_priority ON street_edge_region.street_edge_id = street_edge_priority.street_edge_id
            INNER JOIN osm_way_street_edge_primary
              ON street_edge_region.street_edge_id = osm_way_street_edge_primary.street_edge_id
            WHERE street_edge_region.region_id = $regionId
              AND street_edge.status = 'open'
              AND street_edge.street_edge_id NOT IN (SELECT tutorial_street_edge_id FROM config)
            LIMIT 1""".as[Int].headOption
    ).getOrElse(cancel("The smallest region has no open, non-tutorial street to visit."))
    (regionId, streetEdgeId)
  }

  private def finishRegion(userId: String, regionId: Int): Unit = {
    val _ = run(sqlu"""INSERT INTO audit_task (user_id, street_edge_id, completed, current_lat, current_lng)
                       SELECT $userId, street_edge_id, TRUE, 0, 0
                       FROM street_edge_region
                       WHERE region_id = $regionId""")
  }

  /**
   * A user who has finished the smallest region, with a mission still open in it: the leftover a closed tab or the
   * old 99.9% stall leaves behind, which a visit must not resume.
   */
  private def userWithOpenMissionInFinishedRegion(): (Seq[Cookie], Int, Int) = {
    val session = freshAnonSession()
    completeOnboarding(session)
    val (regionId, streetEdgeId) = smallestServableRegion()
    val opened                   = exploreSession(session, s"?regionId=$regionId")
    pageParam(opened, "region_id").map(_.as[Int]) mustBe Some(regionId)
    val userId =
      run(
        sql"SELECT user_id FROM mission WHERE mission_id = ${(opened \ "mission" \ "mission_id").as[Int]}"
          .as[String]
          .head
      )
    finishRegion(userId, regionId)
    (session, regionId, streetEdgeId)
  }

  "GET /explore/session for a user who has finished every region" should {
    "give the end state instead of an error, wherever the visit asked to go (#5693)" in {
      val session = freshAnonSession()
      completeOnboarding(session)
      val opened = exploreSession(session, "")
      val userId = run(
        sql"SELECT user_id FROM mission WHERE mission_id = ${(opened \ "mission" \ "mission_id").as[Int]}"
          .as[String]
          .head
      )
      val _ = run(sqlu"""INSERT INTO audit_task (user_id, street_edge_id, completed, current_lat, current_lng)
                         SELECT DISTINCT $userId, street_edge_id, TRUE, 0, 0 FROM street_edge_region""")

      pageParam(exploreSession(session, ""), "all_regions_finished") mustBe Some(JsBoolean(true))
      pageParam(exploreSession(session, "?newRegion=true"), "all_regions_finished") mustBe Some(JsBoolean(true))
      val regionId = (opened \ "region_id").as[Int]
      pageParam(exploreSession(session, s"?regionId=$regionId"), "all_regions_finished") mustBe Some(JsBoolean(true))
    }
  }

  "GET /explore/session?regionId=<finished>" should {
    "move the user to a region with streets left and say why, even with a mission still open there (#5692)" in {
      val (session, finishedRegion, _) = userWithOpenMissionInFinishedRegion()
      val otherRegions                 = run(
        sql"""SELECT COUNT(DISTINCT street_edge_region.region_id)
              FROM street_edge_region
              INNER JOIN region ON street_edge_region.region_id = region.region_id
              INNER JOIN street_edge_priority ON street_edge_region.street_edge_id = street_edge_priority.street_edge_id
              WHERE NOT region.deleted AND street_edge_region.region_id <> $finishedRegion""".as[Int].head
      )
      val visit = exploreSession(session, s"?regionId=$finishedRegion")

      if (otherRegions == 0) {
        // A one-region city (CI's seed): finishing it leaves nothing anywhere, so the visit gets the end state (#5693).
        pageParam(visit, "all_regions_finished") mustBe Some(JsBoolean(true))
        pageParam(exploreSession(session, ""), "all_regions_finished") mustBe Some(JsBoolean(true))
      } else {
        pageParam(visit, "region_finished") mustBe Some(JsBoolean(true))
        pageParam(visit, "region_id").map(_.as[Int]) must not be Some(finishedRegion)
        (visit \ "task").toOption must not be None
      }
    }

    "say nothing when the region asked for still has streets left" in {
      val session = freshAnonSession()
      completeOnboarding(session)
      val openRegion = exploreSession(session, "")("region_id").as[Int]

      val visit = exploreSession(session, s"?regionId=$openRegion")

      pageParam(visit, "region_finished") mustBe Some(JsBoolean(false))
      pageParam(visit, "region_id").map(_.as[Int]) mustBe Some(openRegion)
    }

    "pick another region rather than failing when the id names no region" in {
      val session = freshAnonSession()
      completeOnboarding(session)

      val visit = exploreSession(session, s"?regionId=${Int.MaxValue}")

      pageParam(visit, "region_finished") mustBe Some(JsBoolean(false))
    }
  }

  "GET /explore/session?streetEdgeId=<street in a finished region>" should {
    "start a mission exactly as long as that street, not resume the one left open there (#5692)" in {
      val (session, regionId, streetEdgeId) = userWithOpenMissionInFinishedRegion()

      val visit = exploreSession(session, s"?streetEdgeId=$streetEdgeId")

      pageParam(visit, "region_id").map(_.as[Int]) mustBe Some(regionId)
      pageParam(visit, "region_finished") mustBe Some(JsBoolean(false))
      pageParam(visit, "street_unavailable") mustBe Some(JsBoolean(false))
      (visit \ "task" \ "properties" \ "street_edge_id").asOpt[Int] mustBe Some(streetEdgeId)
      val missionId = (visit \ "mission" \ "mission_id").as[Int]
      val lengthGap = run(
        sql"""SELECT ABS(mission.distance_meters - ST_Length(street_edge.geom::geography))
              FROM mission, street_edge
              WHERE mission.mission_id = $missionId AND street_edge.street_edge_id = $streetEdgeId""".as[Double].head
      )
      lengthGap must be < 0.01
    }
  }

  "GET /explore/session?streetEdgeId=<street Explore can't hand out>" should {
    "drop a street that isn't open, say so, and log the id, rather than failing (#5824)" in {
      val session = freshAnonSession()
      completeOnboarding(session)
      val streetEdgeId = unopenedStreetId()

      val visit = exploreSession(session, s"?streetEdgeId=$streetEdgeId")

      pageParam(visit, "street_unavailable") mustBe Some(JsBoolean(true))
      (visit \ "task" \ "properties" \ "street_edge_id").asOpt[Int] must not be Some(streetEdgeId)
      val missionId = (visit \ "mission" \ "mission_id").as[Int]
      // The visit's activity-log write is async, so poll for it.
      eventually(timeout(Span(10, Seconds)), interval(Span(200, Millis))) {
        run(
          sql"""SELECT COUNT(*) FROM webpage_activity
                WHERE user_id = (SELECT user_id FROM mission WHERE mission_id = $missionId)
                  AND activity = ${s"Visit_Audit_UnresolvableStreetEdgeId=$streetEdgeId"}""".as[Int].head
        ) mustBe 1
      }
    }

    "leave the walk the user is already in running, as a bare /explore would" in {
      val (session, routeId, userRouteId) = sessionWalkingARoute()

      val visit = exploreSession(session, s"?streetEdgeId=${unopenedStreetId()}")

      pageParam(visit, "street_unavailable") mustBe Some(JsBoolean(true))
      walkPaused(userRouteId) mustBe false
      pageParam(visit, "route_id").map(_.as[Int]) mustBe Some(routeId)
    }

    "drop an id that names no street and say so" in {
      val session = freshAnonSession()
      completeOnboarding(session)

      pageParam(exploreSession(session, s"?streetEdgeId=${Int.MaxValue}"), "street_unavailable") mustBe
        Some(JsBoolean(true))
    }

    "still start the tutorial for a user who hasn't done it, flagging the street for after it" in {
      val session   = freshAnonSession()
      val bootstrap = exploreBootstrap(session)
      createdUserIds += bootstrap.userId

      val visit = exploreSession(session, s"?streetEdgeId=${unopenedStreetId()}")

      (visit \ "mission" \ "mission_type").asOpt[String] mustBe Some("auditOnboarding")
      pageParam(visit, "street_unavailable") mustBe Some(JsBoolean(true))
    }
  }

}
