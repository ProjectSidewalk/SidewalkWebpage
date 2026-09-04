package controllers

import actor.{
  CheckImageExpiryActor,
  ClusteringActor,
  CropGenerationActor,
  FunnelStatActor,
  OsmWayRefreshActor,
  RecalculateStreetPriorityActor,
  UserStatActor
}
import models.user.Role
import models.utils.MyPostgresProfile.api._
import models.utils.{BackgroundJobRun, BackgroundJobRunTable, JobRunStatus, JobRunTrigger}
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.bind
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._
import org.scalatest.concurrent.Eventually
import org.scalatest.time.{Millis, Seconds, Span}
import play.api.test.CSRFTokenHelper._
import service.CropService.CropRunResult
import service.PanoDataService.ImageryCheckResult
import service.{
  AdminService,
  ClusterService,
  ClusteringResults,
  CropService,
  OsmWayService,
  PanoDataService,
  StreetService
}
import util.{AnonSession, RoleSession, RolledBackDb, StubService}

import scala.concurrent.Future

/**
 * Functional tests for the seven admin routes that hand-trigger a nightly job (#4946).
 *
 * Each wraps its service call in `jobRunService.record(..., Manual)` so a hand-run leaves the same counts and error
 * trail the scheduler's run would (#4932). Nothing else asserts that a given controller method still *calls* it: drop
 * the wrapper and the endpoint keeps working, the job keeps running, and the only symptom is a row that never appears
 * in `background_job_run` — which is indistinguishable from a job nobody triggered. So these run the routes for real
 * and read the row back.
 *
 * The work itself is stubbed. Left alone these recompute a whole city's user stats, funnels and street priorities,
 * shell out to the Python clusterer, and call out to Overpass and the imagery providers; the assertion here is about
 * the bookkeeping around the call, not the call's arithmetic, which each service's own spec covers.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the
 * scheduling actors are disabled so a nightly run can't be mistaken for a triggered one.
 */
class AdminJobTriggerSpec
    extends PlaySpec
    with RoleSession
    with GuiceOneAppPerSuite
    with AnonSession
    with RolledBackDb
    with Eventually {

  // Distinctive values, so an assertion can tell the stub's answer from anything the connected city really holds.
  private val UsersUpdated   = 4611
  private val FunnelRows     = 4612
  private val WaysRefreshed  = 4613
  private val ImageryResult  = ImageryCheckResult(stillThere = 7, gone = 2, errors = 1, reconciled = Some(3))
  private val ClusterResults = ClusteringResults(labelCount = 4614, clusterCount = 4615)
  private val CropResult     = CropRunResult(
    panosOpened = 4616, panosWithoutBackup = 4617, cropsWritten = 4618, shiftedVertically = 4619, outOfFrame = 4620,
    dimsMismatch = 4621, dimsUnverified = 4622, downscaledWritten = 4623, downscaledDeleted = 4625, errors = 4624
  )

  /** Set per test: this endpoint's failure path is part of its contract, and Guice owns the stub. */
  @volatile private var osmWayAnswer: Future[Int] = Future.successful(0)

  /** Set per test: whether the crop service reports a run in flight, which is the trigger's refusal path. */
  @volatile private var cropRunning: Boolean = false

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // AnonSession mints one session per call and the limiter is per-IP; every suite in a run shares loopback.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .overrides(
        bind[AdminService].toInstance(
          StubService.answering[AdminService](
            Map(
              "updateUserStatTable"   -> Future.successful(UsersUpdated),
              "updateFunnelStatTable" -> Future.successful(FunnelRows)
            )
          )
        ),
        bind[StreetService].toInstance(
          StubService.answering[StreetService](Map("recalculateStreetPriority" -> Future.successful(Seq(1, 2))))
        ),
        bind[PanoDataService].toInstance(
          StubService.answering[PanoDataService](
            Map(
              "checkForImagery" -> Future.successful(ImageryResult),
              // Play builds every controller to route one request, and ImageController reads this in its constructor.
              "getCropDirectory" -> ".crops"
            )
          )
        ),
        bind[ClusterService].toInstance(
          StubService.answering[ClusterService](Map("runClustering" -> Future.successful(ClusterResults)))
        ),
        bind[CropService].toInstance(
          StubService.answeringWith[CropService](
            Map("generateMissingCrops" -> (() => Future.successful(CropResult)), "isRunning" -> (() => cropRunning))
          )
        ),
        bind[OsmWayService].toInstance(
          StubService.answeringWith[OsmWayService](Map("refreshOsmWayData" -> (() => osmWayAnswer)))
        )
      )
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val jobRunTable = app.injector.instanceOf[BackgroundJobRunTable]

  private lazy val adminCookies: Seq[Cookie]   = sessionAs(Role.Administrator)
  private lazy val visitorCookies: Seq[Cookie] = sessionAs(Role.Registered)

  /** The runs these tests caused, deleted afterwards so no later reader takes them for the city's own history. */
  private var triggeredRunIds: List[Int] = Nil

  // A POST carries the CSRF token the admin UI's fetch wrapper sends; on a GET the token is simply unused.
  private def asAdmin(path: String, method: String) =
    route(app, FakeRequest(method, path).withCookies(adminCookies: _*).withCSRFToken).get

  private def asVisitor(path: String, method: String) =
    route(app, FakeRequest(method, path).withCookies(visitorCookies: _*).withCSRFToken).get

  private def highestRunId: Int =
    run(jobRunTable.backgroundJobRuns.map(_.backgroundJobRunId).max.result).getOrElse(0)

  private def runsSince(idFloor: Int, jobName: String): Seq[BackgroundJobRun] =
    run(
      jobRunTable.backgroundJobRuns
        .filter(row => row.jobName === jobName && row.backgroundJobRunId > idFloor)
        .result
    )

  /**
   * Calls a trigger as an admin, returning its status and body alongside the one run it recorded.
   *
   * Reading by id floor rather than by "the newest row for this job" is what keeps the assertion honest: against a
   * database that already holds runs of these jobs, the latter passes whether or not the request wrote anything.
   */
  private def trigger(path: String, jobName: String, method: String = GET): (Int, String, BackgroundJobRun) = {
    val idFloor  = highestRunId
    val response = asAdmin(path, method)
    val code     = status(response) // Blocks until the action settles, which is after the run row is closed.
    val body     = contentAsString(response)

    // Claimed for cleanup before anything can fail on them; a row this request wrote is ours to delete either way.
    val runs = runsSince(idFloor, jobName)
    triggeredRunIds ++= runs.map(_.backgroundJobRunId)
    runs.size mustBe 1
    (code, body, runs.head)
  }

  override def afterAll(): Unit = {
    // RoleSession's demotion rides super.afterAll, and leaving an account Administrator in the shared login schema is
    // worse than leaving rows behind -- so a failed delete must not cost us it.
    try {
      if (triggeredRunIds.nonEmpty) {
        val _ = run(jobRunTable.backgroundJobRuns.filter(_.backgroundJobRunId.inSet(triggeredRunIds)).delete)
      }
    } finally super.afterAll()
  }

  "GET /adminapi/updateUserStats" should {
    "record the recompute as a manual run of the nightly user-stats job" in {
      val (code, body, jobRun) = trigger("/adminapi/updateUserStats", UserStatActor.Name)
      code mustBe OK
      body must include(UsersUpdated.toString)
      jobRun.triggeredBy mustBe JobRunTrigger.Manual
      jobRun.status mustBe JobRunStatus.Succeeded
      jobRun.finishedAt mustBe defined
      // The nightly recompute and this trigger share one details shape, so the panel can chart them as one job.
      // The shape's own key names are pinned by JobRunDetailsSpec; comparing against the builder can't be.
      jobRun.details.value mustBe UserStatActor.runDetails(UsersUpdated)
    }
  }

  "GET /adminapi/updateFunnelStats" should {
    "record the rebuild as a manual run of the nightly funnel-stats job" in {
      val (code, body, jobRun) = trigger("/adminapi/updateFunnelStats", FunnelStatActor.Name)
      code mustBe OK
      body must include(FunnelRows.toString)
      jobRun.triggeredBy mustBe JobRunTrigger.Manual
      jobRun.status mustBe JobRunStatus.Succeeded
      jobRun.details.value mustBe FunnelStatActor.runDetails(FunnelRows)
    }
  }

  "GET /adminapi/recalculateStreetPriority" should {
    "record the recalculation as a manual run of the nightly street-priority job" in {
      val (code, _, jobRun) = trigger("/adminapi/recalculateStreetPriority", RecalculateStreetPriorityActor.Name)
      code mustBe OK
      jobRun.triggeredBy mustBe JobRunTrigger.Manual
      jobRun.status mustBe JobRunStatus.Succeeded
      // This one covers only the recalculation step, not the region_completion rebuild the nightly sequence wraps
      // around it, so it reports a null count rather than a number a reader could mistake for a rebuild that ran.
      jobRun.details.value mustBe RecalculateStreetPriorityActor.runDetails(None)
    }
  }

  "GET /adminapi/checkImagery" should {
    "record the sweep as a manual run of the nightly imagery-expiry job, with its counts" in {
      val (code, body, jobRun) = trigger("/adminapi/checkImagery", CheckImageExpiryActor.Name)
      code mustBe OK
      body mustBe ImageryResult.summary
      jobRun.triggeredBy mustBe JobRunTrigger.Manual
      jobRun.status mustBe JobRunStatus.Succeeded
      jobRun.details.value mustBe ImageryResult.runDetails
    }
  }

  "POST /adminapi/generateCrops" should {
    // The one trigger that answers before its job finishes (a first backfill outlives any proxy read timeout), so it
    // is also the one whose run row can't be read straight off the response.
    "answer at once and record the crop run as a manual run of the nightly job, with its counts" in {
      val idFloor  = highestRunId
      val response = asAdmin("/adminapi/generateCrops", POST)
      status(response) mustBe ACCEPTED
      contentAsString(response) must include("started")

      val jobRun = eventually(timeout(Span(30, Seconds)), interval(Span(100, Millis))) {
        val runs = runsSince(idFloor, CropGenerationActor.Name)
        // Claimed on every attempt, as `trigger` does: a row this request wrote is ours to delete either way.
        triggeredRunIds = (triggeredRunIds ++ runs.map(_.backgroundJobRunId)).distinct
        runs.size mustBe 1
        runs.head.status mustBe JobRunStatus.Succeeded
        runs.head
      }
      jobRun.triggeredBy mustBe JobRunTrigger.Manual
      jobRun.details.value mustBe CropResult.runDetails
    }

    "refuse with 409, and record nothing, while a run is already in flight" in {
      // The refusal happens before the run is recorded on purpose: a second click during an hour-long backfill is not
      // a failed job, and must not show as one on the Health panel.
      cropRunning = true
      try {
        val idFloor  = highestRunId
        val response = asAdmin("/adminapi/generateCrops", POST)
        status(response) mustBe CONFLICT
        contentAsString(response) must include("already in progress")
        runsSince(idFloor, CropGenerationActor.Name) mustBe empty
      } finally cropRunning = false
    }
  }

  "GET /adminapi/refreshOsmWayData" should {
    "record the refresh as a manual run of the nightly OSM job" in {
      osmWayAnswer = Future.successful(WaysRefreshed)
      val (code, body, jobRun) = trigger("/adminapi/refreshOsmWayData", OsmWayRefreshActor.Name)
      code mustBe OK
      body must include(WaysRefreshed.toString)
      jobRun.triggeredBy mustBe JobRunTrigger.Manual
      jobRun.status mustBe JobRunStatus.Succeeded
      jobRun.details.value mustBe OsmWayRefreshActor.runDetails(WaysRefreshed)
    }

    "record a half-finished refresh as a failure, and say so rather than reporting a count" in {
      // This job runs for tens of minutes over a shared community API and can die partway. The run row is the only
      // durable account of that, and the caller is told progress is kept -- both are easy to lose to a refactor.
      osmWayAnswer = Future.failed(new RuntimeException("overpass timed out"))
      val (code, body, jobRun) = trigger("/adminapi/refreshOsmWayData", OsmWayRefreshActor.Name)
      code mustBe SERVICE_UNAVAILABLE
      body must include("trigger again to resume")
      jobRun.triggeredBy mustBe JobRunTrigger.Manual
      jobRun.status mustBe JobRunStatus.Failed
      jobRun.errorMessage.value must include("overpass timed out")
      jobRun.details mustBe empty
    }
  }

  "GET /runClustering" should {
    "record the clustering as a manual run of the nightly clustering job" in {
      // The row is closed before the future the last chunk carries resolves, so consuming the body (which `trigger`
      // does) is what makes it safe to read back -- unlike the others, this response is chunked and returns first.
      val (code, body, jobRun) = trigger("/runClustering", ClusteringActor.Name)
      code mustBe OK
      body must include(ClusterResults.clusterCount.toString)
      jobRun.triggeredBy mustBe JobRunTrigger.Manual
      jobRun.status mustBe JobRunStatus.Succeeded
      jobRun.details.value mustBe ClusterResults.runDetails
    }
  }

  "the job triggers" should {
    "refuse a signed-in non-admin, naming the role they want, without starting the job" in {
      // The anonymous checks in RouteAuthPostureSpec cannot tell a guard that is on from one that admits anyone
      // signed in, and each of these kicks off hours of work on a production city.
      val idFloor = highestRunId
      Seq(
        (GET, "/adminapi/updateUserStats", UserStatActor.Name),
        (GET, "/adminapi/updateFunnelStats", FunnelStatActor.Name),
        (GET, "/adminapi/recalculateStreetPriority", RecalculateStreetPriorityActor.Name),
        (GET, "/adminapi/checkImagery", CheckImageExpiryActor.Name),
        (GET, "/adminapi/refreshOsmWayData", OsmWayRefreshActor.Name),
        (POST, "/adminapi/generateCrops", CropGenerationActor.Name),
        (GET, "/runClustering", ClusteringActor.Name)
      ).foreach { case (method, path, jobName) =>
        val response = asVisitor(path, method)
        status(response) mustBe FORBIDDEN
        contentAsString(response) must include("Administrator")
        runsSince(idFloor, jobName) mustBe empty
      }
    }
  }
}
