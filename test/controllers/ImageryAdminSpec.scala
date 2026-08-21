package controllers

import models.utils.MyPostgresProfile.api._
import models.utils.{BackgroundJobRunTable, JobRunStatus, JobRunTrigger, MyPostgresProfile}
import org.apache.pekko.stream.Materializer
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.cache.AsyncCacheApi
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.ImageryFreshnessReportService
import slick.dbio.DBIO
import util.AnonSession

import java.time.OffsetDateTime
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Functional tests for the admin Imagery surface (#4908): the page and the two endpoints behind it.
 *
 * The endpoints publish a whole city's routing weights and the internal state of the nightly jobs, so the guard is
 * the first thing worth pinning — and pinning it needs a real signed-in caller, because a logged-out request is
 * refused identically whatever role the action demands. The rest pins the response contract the page reads: the
 * client indexes into these payloads by name and degrades silently on a miss, so a renamed field would show up as a
 * blank panel rather than as an error.
 *
 * Seeds its own caller rather than hunting the schema for an existing admin: a spec that `assume`s one away cancels
 * on an empty CI database, which reads as passing. The session is minted through the real anonymous-signup route and
 * then promoted with a DB write, mirroring how a throwaway admin is made for QA; the promotion is undone afterwards.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the
 * scheduling actors are disabled so nightly jobs can't race the tests.
 */
class ImageryAdminSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // AnonSession mints one session per call and the limiter is per-IP; every suite in a run shares loopback.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val dbConfig    = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private val jobRunTable = app.injector.instanceOf[BackgroundJobRunTable]
  private val cacheApi    = app.injector.instanceOf[AsyncCacheApi]
  private val pollJob     = ImageryFreshnessReportService.PollJob

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  /** The accounts promoted for this suite, remembered so they can be demoted again. */
  private var promotedUserIds: List[String] = Nil

  /**
   * A fresh session holding `role`, mirroring how a throwaway admin is made for QA.
   *
   * The account is identified by what the signup created rather than by reading a user id back out of a route: no
   * route publishes one, and picking the newest row would be a guess in a database other sessions write to too.
   */
  private def sessionAs(role: String): Seq[Cookie] = {
    val before  = run(sql"SELECT user_id FROM sidewalk_login.sidewalk_user".as[String]).toSet
    val cookies = freshAnonSession()
    val minted  = run(sql"SELECT user_id FROM sidewalk_login.sidewalk_user".as[String]).toSet -- before
    minted.size mustBe 1
    promotedUserIds ::= minted.head
    promote(minted.head, role)
    cookies
  }

  /**
   * A signed-in caller with no admin rights.
   *
   * Registered, not the Anonymous role a bare signup carries: an Anonymous caller is sent to sign in whatever role
   * the action wants, so only a registered one reaches the branch that refuses by name.
   */
  private lazy val visitorCookies: Seq[Cookie] = sessionAs("Registered")

  private lazy val adminCookies: Seq[Cookie] = sessionAs("Administrator")

  private def promote(userId: String, role: String): Unit = {
    val _ = run(
      sqlu"""UPDATE sidewalk_login.user_role
             SET role_id = (SELECT role_id FROM sidewalk_login.role WHERE role = $role)
             WHERE user_id = $userId"""
    )
  }

  /** The runs this suite seeded, deleted afterwards so no later suite reads them as the city's own history. */
  private var seededRunIds: List[Int] = Nil

  /** Seeds one finished run of the imagery-age poll, giving the row's optional fields something to carry. */
  private def seedPollRun(
      status: JobRunStatus.Value,
      details: Option[JsValue],
      trigger: JobRunTrigger.Value = JobRunTrigger.Scheduled
  ): Unit = {
    val startedAt = OffsetDateTime.now.minusHours(1)
    val id        = run(jobRunTable.insertRunning(pollJob, trigger, startedAt))
    seededRunIds ::= id
    val _ = run(
      jobRunTable.finish(
        id,
        status,
        startedAt.plusMinutes(1),
        details,
        if (status == JobRunStatus.Failed) Some("boom") else None
      )
    )
  }

  /** The poll job's row, read past the report cache so a run seeded after an earlier read is visible. */
  private def pollJobRow(): JsObject = {
    Await.result(cacheApi.removeAll(), 60.seconds)
    (contentAsJson(asAdmin("/adminapi/imageryFreshness")) \ "jobs")
      .as[Seq[JsObject]]
      .find(job => (job \ "job_name").as[String] == pollJob)
      .value
  }

  override def afterAll(): Unit = {
    // Leave no standing admin behind in a shared development database.
    promotedUserIds.foreach(id => promote(id, "Anonymous"))
    // By id rather than by job name: the name would also take whatever runs the connected city really recorded.
    if (seededRunIds.nonEmpty) {
      val _ = run(jobRunTable.backgroundJobRuns.filter(_.backgroundJobRunId.inSet(seededRunIds)).delete)
    }
    super.afterAll()
  }

  /** Performs an admin GET. */
  private def asAdmin(path: String) =
    route(app, FakeRequest(GET, path).withHeaders(XHR).withCookies(adminCookies: _*)).get

  private def asVisitor(path: String) =
    route(app, FakeRequest(GET, path).withHeaders(XHR).withCookies(visitorCookies: _*)).get

  "the Imagery admin surface" should {
    "refuse a signed-in visitor, naming the role it wants" in {
      // The anonymous checks in RouteAuthPostureSpec cannot tell WithAdmin from WithOwner; this can.
      Seq("/admin/imagery", "/adminapi/imageryFreshness", "/adminapi/streetPriority").foreach { path =>
        val resp = asVisitor(path)
        status(resp) mustBe FORBIDDEN
        contentAsString(resp) must include("Administrator")
      }
    }

    "send a logged-out caller to sign in rather than answering with a 404" in {
      Seq("/admin/imagery", "/adminapi/imageryFreshness", "/adminapi/streetPriority").foreach { path =>
        val resp = route(app, FakeRequest(GET, path).withHeaders("Sec-Fetch-Mode" -> "navigate")).get
        status(resp) mustBe SEE_OTHER
      }
    }
  }

  "GET /admin/imagery" should {
    "serve the page to an administrator, with the containers its client fills" in {
      val resp = asAdmin("/admin/imagery")
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/html")
      val body = contentAsString(resp)
      // Every one of these is written to by name; a template that dropped one leaves a silently blank section.
      Seq("imagery-priority-map", "imagery-region-table", "imagery-street-table", "imagery-jobs", "imagery-rotation",
        "imagery-freshness-chart", "kpi-needs-reaudit", "kpi-last-poll")
        .foreach(id => body must include(id))
    }

    "hand the client the endpoints and the default window rather than letting it hardcode them" in {
      val body = contentAsString(asAdmin("/admin/imagery"))
      body must include("/adminapi/streetPriority")
      body must include("/adminapi/imageryFreshness")
      body must include(s"pipelineDays: ${ImageryFreshnessReportService.DefaultDays}")
    }
  }

  "GET /adminapi/imageryFreshness" should {
    "publish the pipeline report as snake_case JSON" in {
      val resp = asAdmin("/adminapi/imageryFreshness")
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")
      val json = contentAsJson(resp)
      json.as[JsObject].keys mustBe Set("days", "since", "jobs", "run_days", "poll_batch_size", "overdue_after_hours",
        "poll_job", "sync_job")
    }

    "chart the pipeline's three jobs, in the order they run" in {
      val jobs = (contentAsJson(asAdmin("/adminapi/imageryFreshness")) \ "jobs").as[Seq[JsObject]]
      jobs.map(job => (job \ "job_name").as[String]) mustBe ImageryFreshnessReportService.JobNames
      // The panel keys its banner off these, and finds nothing if they name jobs that are not in the list.
      val json = contentAsJson(asAdmin("/adminapi/imageryFreshness"))
      jobs.map(job => (job \ "job_name").as[String]) must contain((json \ "poll_job").as[String])
      jobs.map(job => (job \ "job_name").as[String]) must contain((json \ "sync_job").as[String])
    }

    "give every job row the fields the panel renders" in {
      // A null field is omitted rather than sent as null, so a job that has never run carries none of these. Seeding
      // the runs is what makes this an assertion about the contract instead of about the connected city's history.
      seedPollRun(JobRunStatus.Succeeded, Some(Json.obj("streets_polled" -> 12)))
      seedPollRun(JobRunStatus.Succeeded, Some(Json.obj("streets_polled" -> 3)), JobRunTrigger.Manual)
      Seq("job_name", "label", "scheduled_at", "last_status", "overdue", "last_started_at", "hours_since_last_run",
        "last_details", "last_manual_run_at", "last_manual_status")
        .foreach(key => pollJobRow().keys must contain(key))

      // `last_error` rides the same row, but only on a failure -- the one state the panel prints in place of counts.
      seedPollRun(JobRunStatus.Failed, None)
      pollJobRow().keys must contain("last_error")
    }

    "answer the default window when none is asked for" in {
      (contentAsJson(asAdmin("/adminapi/imageryFreshness")) \ "days").as[Int] mustBe
        ImageryFreshnessReportService.DefaultDays
    }

    "narrow an out-of-range window rather than erroring on it" in {
      // The window comes from a <select>, but the URL is reachable by hand and a 500 here would read as a dead page.
      (contentAsJson(asAdmin("/adminapi/imageryFreshness?days=1")) \ "days").as[Int] mustBe
        ImageryFreshnessReportService.MinDays
      (contentAsJson(asAdmin("/adminapi/imageryFreshness?days=99999")) \ "days").as[Int] mustBe
        ImageryFreshnessReportService.MaxDays
    }

    "reject a window that is not a number, rather than serving an arbitrary one" in {
      status(asAdmin("/adminapi/imageryFreshness?days=lots")) mustBe BAD_REQUEST
    }
  }

  "GET /adminapi/streetPriority" should {
    "publish the routable streets as snake_case JSON" in {
      val resp = asAdmin("/adminapi/streetPriority")
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")
      val streets = (contentAsJson(resp) \ "streets").as[Seq[JsValue]]
      // The field contract itself is pinned without a DB in StreetPriorityForAdminSpec; this is the wiring.
      streets.foreach { street =>
        street.as[JsObject].keys mustBe Set("street_edge_id", "region_id", "region_name", "priority",
          "fresh_good_count", "outdated_good_count", "bad_count", "outdated", "last_audit_date",
          "median_newest_capture", "imagery_updated_at", "length_m")
      }
      succeed
    }

    "carry no geometry, which is what keeps a whole city's ranking small enough to send" in {
      val body = contentAsString(asAdmin("/adminapi/streetPriority"))
      body must not include "coordinates"
      body must not include "geometry"
    }
  }
}
