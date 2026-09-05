package controllers

import controllers.helper.{ExploreBootstrap, SubmissionSpecHelpers}
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json._
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

import java.time.OffsetDateTime

/**
 * Functional tests for `POST /explore/nostreetview`: the per-user cap (#4918) and the evidence-only write contract
 * (#4922).
 *
 * The write contract is the load-bearing property: an accepted report records a `street_edge_issue` row and nothing
 * else — the task stays incomplete, the street keeps its priority, and the region's audited distance is untouched. A
 * report is one session's verdict and transient imagery failures forge them wholesale (production saw a client loop
 * submit 44 in 33 seconds), so nothing an audit credits may hang off of one.
 *
 * The rate limit bounds how much junk evidence a runaway client can write. The client-side guards that bound those
 * loops can't be the only defense, because clients keep running cached bundles for up to an hour after a deploy. So
 * the property under test is the one that holds regardless of what the client does: past the budget, the server
 * writes nothing at all.
 *
 * The suite runs with a budget of [[MaxReports]] rather than the configured production value so a test can exhaust it
 * in a handful of requests. Each test mints its own anonymous user, which is also the limiter's key, so tests neither
 * share budget nor depend on each other's order.
 */
// Mixin order matters: GuiceOneAppPerSuite must be rightmost so its run() wraps BeforeAndAfterAll's — otherwise
// afterAll's cleanup executes after the app (and its DB pool) has shut down and aborts the suite.
class ExploreNoImageryRateLimitSpec
    extends PlaySpec
    with BeforeAndAfterAll
    with SubmissionSpecHelpers
    with GuiceOneAppPerSuite {

  /** Reports allowed per user per window in this suite. Two is the smallest budget that still has an "under" case. */
  private val MaxReports = 2

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // Several anon sessions per run share one loopback IP, so the 100/hr signup cap would 429 across repeat runs
      // and break session minting rather than anything under test.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .configure(
        "rate-limit.no-imagery.enabled"        -> true,
        "rate-limit.no-imagery.max-attempts"   -> MaxReports,
        "rate-limit.no-imagery.window-seconds" -> 300
      )
      .build()

  /** Users minted by this suite; everything written under them is deleted in `afterAll`. */
  private var createdUserIds: Set[String] = Set.empty

  /**
   * Pre-test `street_edge_priority.priority` per street: what a report must not move (#4922). Restored in `afterAll`
   * regardless, so a regression that starts moving it can't leave the shared dev DB poisoned.
   */
  private var priorityBackup: Map[Int, Double] = Map.empty

  /** Pre-test `region_completion.audited_distance` per region: same contract and same safety net as the priority. */
  private var auditedDistanceBackup: Map[Int, Double] = Map.empty

  /** The shared bootstrap, plus the bookkeeping that lets `afterAll` clean up after the user it assigns work to. */
  private def bootstrapFor(session: Seq[Cookie]): ExploreBootstrap = {
    val bootstrap = exploreBootstrap(session)
    createdUserIds += bootstrap.userId
    bootstrap
  }

  /**
   * A street whose audited state the contract can actually be checked against, with its region.
   *
   * The street a session is *assigned* won't do: a brand-new anonymous user's first mission is the tutorial, whose
   * street is served with a hardcoded priority and carries neither a `street_edge_priority` nor a `region_completion`
   * row — so assertions keyed to it have nothing to compare and die on an empty result. Picking a regular street with
   * both rows present is what makes "the report moved neither" a real check rather than one that reads two absences.
   * The endpoint takes the street from the payload, so naming one here is exactly what the client does.
   *
   * @return The street and its region, or None when the connected schema has no such street.
   */
  private def streetWithAuditedState(): Option[(Int, Int)] =
    run(sql"""SELECT street_edge_priority.street_edge_id, street_edge_region.region_id
              FROM street_edge_priority
              INNER JOIN street_edge_region
                      ON street_edge_priority.street_edge_id = street_edge_region.street_edge_id
              INNER JOIN region_completion ON street_edge_region.region_id = region_completion.region_id
              WHERE street_edge_priority.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
              ORDER BY street_edge_priority.street_edge_id
              LIMIT 1""".as[(Int, Int)]).headOption

  /** Snapshots the shared audited-state rows for a street, so a test can assert the report moved neither. */
  private def backUpAuditedState(streetEdgeId: Int, regionId: Int): Unit = {
    priorityBackup += (streetEdgeId ->
      run(sql"SELECT priority FROM street_edge_priority WHERE street_edge_id = $streetEdgeId".as[Double]).head)
    auditedDistanceBackup += (regionId ->
      run(sql"SELECT audited_distance FROM region_completion WHERE region_id = $regionId".as[Double]).head)
  }

  /** A missing-imagery report shaped exactly as `util.misc.reportNoImagery` builds one. */
  private def reportPayload(b: ExploreBootstrap, streetEdgeId: Int = -1): JsValue =
    Json.obj(
      "audit_task" -> Json.obj(
        "street_edge_id"                  -> (if (streetEdgeId >= 0) streetEdgeId else b.streetEdgeId),
        "task_start"                      -> b.taskStart,
        "audit_task_id"                   -> b.auditTaskId,
        "completed"                       -> false,
        "current_lat"                     -> b.currentLat,
        "current_lng"                     -> b.currentLng,
        "start_point_reversed"            -> b.startPointReversed,
        "current_mission_start"           -> JsNull,
        "last_priority_update_time"       -> OffsetDateTime.now,
        "request_updated_street_priority" -> false
      ),
      "mission_id" -> b.missionId
    )

  /** Posts a report over HTTP as the session's user, the way the frontend does. */
  private def postReport(session: Seq[Cookie], payload: JsValue) =
    route(
      app,
      FakeRequest(POST, "/explore/nostreetview").withCookies(session: _*).withJsonBody(payload).withCSRFToken
    ).get

  /** How many streets the user has reported as imagery-less — the row the endpoint exists to write. */
  private def reportedStreetCount(userId: String): Int =
    run(sql"SELECT count(*) FROM street_edge_issue WHERE user_id = $userId".as[Int]).head

  "POST /explore/nostreetview" should {
    "401 an unauthenticated report" in {
      // Sec-Fetch-Mode pins the fetch/XHR arm of ControllerUtils.anonSignupRedirect — what the real client hits.
      val resp = route(
        app,
        FakeRequest(POST, "/explore/nostreetview")
          .withHeaders("Sec-Fetch-Mode" -> "cors")
          .withJsonBody(Json.obj())
          .withCSRFToken
      ).get
      status(resp) mustBe UNAUTHORIZED
    }

    "charge the budget before validating the body, so a malformed flood still runs out of budget" in {
      val session = freshAnonSession()

      // A body that can't parse never reaches the database, so if the limit were checked after validation these would
      // cost nothing and a client could hammer the endpoint indefinitely.
      for (_ <- 1 to MaxReports) status(postReport(session, Json.obj("nonsense" -> true))) mustBe BAD_REQUEST

      val refused = postReport(session, Json.obj("nonsense" -> true))
      status(refused) mustBe TOO_MANY_REQUESTS
      header("Retry-After", refused) mustBe defined
      (contentAsJson(refused) \ "status").as[String] mustBe "Error"
    }

    "accept a report within budget, recording evidence without marking the street audited" in {
      val session                  = freshAnonSession()
      val b                        = bootstrapFor(session)
      val (streetEdgeId, regionId) = streetWithAuditedState()
        .getOrElse(cancel("No non-tutorial street in the connected schema carries priority and completion rows."))
      backUpAuditedState(streetEdgeId, regionId)

      val resp = postReport(session, reportPayload(b, streetEdgeId))
      status(resp) mustBe OK
      (contentAsJson(resp) \ "success").as[Int] mustBe streetEdgeId

      run(
        sql"""SELECT count(*) FROM street_edge_issue
              WHERE user_id = ${b.userId} AND street_edge_id = $streetEdgeId AND issue = 'PanoNotAvailable'"""
          .as[Int]
      ).head mustBe 1

      // The evidence-only contract (#4922): the issue row above is the report's entire footprint. No audit task is
      // touched at all, and the shared audited-state rows hold their pre-test values, so the street stays in the
      // assignment rotation for everyone.
      run(
        sql"SELECT completed FROM audit_task WHERE user_id = ${b.userId} AND street_edge_id = $streetEdgeId".as[Boolean]
      ) mustBe empty
      run(
        sql"SELECT priority FROM street_edge_priority WHERE street_edge_id = $streetEdgeId".as[Double]
      ).head mustBe priorityBackup(streetEdgeId)
      run(
        sql"SELECT audited_distance FROM region_completion WHERE region_id = $regionId".as[Double]
      ).head mustBe auditedDistanceBackup(regionId)
    }

    "write nothing once the user's budget is spent" in {
      val session = freshAnonSession()
      val b       = bootstrapFor(session)

      // Spend the budget without touching the database, so the streets this test refuses are the only ones in play.
      for (_ <- 1 to MaxReports) status(postReport(session, Json.obj("nonsense" -> true))) mustBe BAD_REQUEST

      val before  = reportedStreetCount(b.userId)
      val refused = postReport(session, reportPayload(b))
      status(refused) mustBe TOO_MANY_REQUESTS

      // The point of the limit: a refused report leaves no trace at all, not even the evidence row an accepted one
      // would write, so nothing downstream ever sees the street as suspect.
      reportedStreetCount(b.userId) mustBe before
    }

    "budget one user at a time, so a single runaway session can't lock everyone else out" in {
      val exhausted = freshAnonSession()
      // Each spend must be awaited, or the assertion below races the requests meant to precede it.
      for (_ <- 1 to MaxReports) status(postReport(exhausted, Json.obj("nonsense" -> true))) mustBe BAD_REQUEST
      status(postReport(exhausted, Json.obj("nonsense" -> true))) mustBe TOO_MANY_REQUESTS

      // A different user, same loopback IP: keying the limit per user is what keeps a classroom behind one NAT (or
      // one broken session) from throttling everybody auditing that city.
      val bystander = freshAnonSession()
      status(postReport(bystander, Json.obj("nonsense" -> true))) mustBe BAD_REQUEST
    }
  }

  /**
   * Removes the reports and tasks the suite wrote, and puts back the shared rows nothing should have moved.
   *
   * Order follows the foreign keys, and the mission's `current_audit_task_id` is cleared first: a mission points back
   * at the task the user is on, so deleting audit_task before breaking that reference violates the constraint.
   */
  override def afterAll(): Unit = {
    try {
      createdUserIds.foreach { uId =>
        val _ = run(
          DBIO.seq(
            sqlu"DELETE FROM street_edge_issue WHERE user_id = $uId",
            sqlu"UPDATE mission SET current_audit_task_id = NULL WHERE user_id = $uId",
            sqlu"DELETE FROM audit_task WHERE user_id = $uId",
            sqlu"DELETE FROM mission WHERE user_id = $uId"
          )
        )
      }
      priorityBackup.foreach { case (streetEdgeId, priority) =>
        val _ = run(sqlu"UPDATE street_edge_priority SET priority = $priority WHERE street_edge_id = $streetEdgeId")
      }
      auditedDistanceBackup.foreach { case (regionId, distance) =>
        val _ = run(sqlu"UPDATE region_completion SET audited_distance = $distance WHERE region_id = $regionId")
      }
    } finally super.afterAll()
  }
}
