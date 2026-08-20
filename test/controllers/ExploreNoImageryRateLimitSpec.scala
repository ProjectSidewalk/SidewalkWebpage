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
 * Functional tests for the per-user cap on `POST /explore/nostreetview` (#4918).
 *
 * The endpoint is unusually expensive to get wrong: an accepted report marks the reported street `completed` and
 * lowers its priority, so the street stops being handed out to labelers. That makes a false report permanent lost
 * coverage rather than a retryable annoyance, and production has twice seen a client loop turn a transient imagery
 * failure into dozens of streets marked audited that nobody ever looked at — 44 streets in 33 seconds in one case.
 *
 * The client-side guards that bound those loops can't be the only defense, because clients keep running cached
 * bundles for up to an hour after a deploy and old bundles carry the unbounded behavior. So the property under test
 * here is the one that holds regardless of what the client does: past the budget, the server writes nothing.
 *
 * The suite runs with a budget of [[MaxReports]] rather than the configured production value so a test can exhaust it
 * without marking a pile of real streets audited. Each test mints its own anonymous user, which is also the limiter's
 * key, so tests neither share budget nor depend on each other's order.
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

  /** Pre-test `street_edge_priority.priority` for each street a report completed, restored in `afterAll`. */
  private var priorityBackup: Map[Int, Double] = Map.empty

  /** Pre-test `region_completion.audited_distance` for each region touched, restored in `afterAll`. */
  private var auditedDistanceBackup: Map[Int, Double] = Map.empty

  /** The shared bootstrap, plus the bookkeeping that lets `afterAll` clean up after the user it assigns work to. */
  private def bootstrapFor(session: Seq[Cookie]): ExploreBootstrap = {
    val bootstrap = exploreBootstrap(session)
    createdUserIds += bootstrap.userId
    run(
      sql"SELECT priority FROM street_edge_priority WHERE street_edge_id = ${bootstrap.streetEdgeId}".as[Double]
    ).headOption
      .foreach(p => priorityBackup += (bootstrap.streetEdgeId -> p))
    run(
      sql"SELECT audited_distance FROM region_completion WHERE region_id = ${bootstrap.regionId}".as[Double]
    ).headOption
      .foreach(d => auditedDistanceBackup += (bootstrap.regionId -> d))
    bootstrap
  }

  /** A missing-imagery report shaped exactly as `util.misc.reportNoImagery` builds one. */
  private def reportPayload(b: ExploreBootstrap): JsValue =
    Json.obj(
      "audit_task" -> Json.obj(
        "street_edge_id"                  -> b.streetEdgeId,
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

    "accept a report within budget and record the street as having no imagery" in {
      val session = freshAnonSession()
      val b       = bootstrapFor(session)

      val resp = postReport(session, reportPayload(b))
      status(resp) mustBe OK
      (contentAsJson(resp) \ "success").as[Int] mustBe b.streetEdgeId

      run(
        sql"""SELECT count(*) FROM street_edge_issue
              WHERE user_id = ${b.userId} AND street_edge_id = ${b.streetEdgeId} AND issue = 'PanoNotAvailable'"""
          .as[Int]
      ).head mustBe 1
    }

    "stop marking streets audited once the user's budget is spent" in {
      val session = freshAnonSession()
      val b       = bootstrapFor(session)

      // Spend the budget without touching the database, so the streets this test refuses are the only ones in play.
      for (_ <- 1 to MaxReports) status(postReport(session, Json.obj("nonsense" -> true))) mustBe BAD_REQUEST

      val before  = reportedStreetCount(b.userId)
      val refused = postReport(session, reportPayload(b))
      status(refused) mustBe TOO_MANY_REQUESTS

      // The point of the limit: a refused report leaves no trace, so the street stays in the assignment rotation.
      reportedStreetCount(b.userId) mustBe before
      run(
        sql"SELECT completed FROM audit_task WHERE user_id = ${b.userId} AND street_edge_id = ${b.streetEdgeId}"
          .as[Boolean]
      ) must not contain true
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
   * Removes the reports and tasks the suite wrote, and puts back the shared rows an accepted report moved.
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
