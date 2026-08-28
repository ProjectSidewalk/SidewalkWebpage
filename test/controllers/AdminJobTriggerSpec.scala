package controllers

import actor.{
  CheckImageExpiryActor,
  ClusteringActor,
  FunnelStatActor,
  OsmWayRefreshActor,
  RecalculateStreetPriorityActor,
  UserStatActor
}
import models.street.OsmWayTable
import models.utils.MyPostgresProfile.api._
import models.utils.{BackgroundJobRun, BackgroundJobRunTable, JobRunStatus, JobRunTrigger}
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.cache.AsyncCacheApi
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.bind
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.ws.WSClient
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.PanoDataService.ImageryCheckResult
import service.{AdminService, ClusterService, ClusteringResults, OsmWayService, PanoDataService, StreetService}
import util.{AnonSession, RoleSession, RolledBackDb, StubService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * Functional tests for the six admin routes that hand-trigger a nightly job (#4946).
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
    with RolledBackDb {

  // Distinctive values, so an assertion can tell the stub's answer from anything the connected city really holds.
  private val UsersUpdated   = 4611
  private val FunnelRows     = 4612
  private val WaysRefreshed  = 4613
  private val ImageryResult  = ImageryCheckResult(stillThere = 7, gone = 2, errors = 1, reconciled = Some(3))
  private val ClusterResults = ClusteringResults(labelCount = 4614, clusterCount = 4615)

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
        // A class rather than a trait, so it takes a subclass binding instead of a proxy.
        bind[OsmWayService].to[StubOsmWayService]
      )
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val jobRunTable = app.injector.instanceOf[BackgroundJobRunTable]

  private lazy val adminCookies: Seq[Cookie]   = sessionAs("Administrator")
  private lazy val visitorCookies: Seq[Cookie] = sessionAs("Registered")

  /** The runs these tests caused, deleted afterwards so no later reader takes them for the city's own history. */
  private var triggeredRunIds: List[Int] = Nil

  private def asAdmin(path: String) =
    route(app, FakeRequest(GET, path).withCookies(adminCookies: _*)).get

  private def asVisitor(path: String) =
    route(app, FakeRequest(GET, path).withCookies(visitorCookies: _*)).get

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
  private def trigger(path: String, jobName: String): (Int, String, BackgroundJobRun) = {
    val idFloor  = highestRunId
    val response = asAdmin(path)
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
      StubOsmWayService.answer = () => Future.successful(0)
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
      (jobRun.details.value \ "users_updated").as[Int] mustBe UsersUpdated
    }
  }

  "GET /adminapi/updateFunnelStats" should {
    "record the rebuild as a manual run of the nightly funnel-stats job" in {
      val (code, body, jobRun) = trigger("/adminapi/updateFunnelStats", FunnelStatActor.Name)
      code mustBe OK
      body must include(FunnelRows.toString)
      jobRun.triggeredBy mustBe JobRunTrigger.Manual
      jobRun.status mustBe JobRunStatus.Succeeded
      (jobRun.details.value \ "rows_written").as[Int] mustBe FunnelRows
    }
  }

  "GET /adminapi/recalculateStreetPriority" should {
    "record the recalculation as a manual run of the nightly street-priority job" in {
      val (code, _, jobRun) = trigger("/adminapi/recalculateStreetPriority", RecalculateStreetPriorityActor.Name)
      code mustBe OK
      jobRun.triggeredBy mustBe JobRunTrigger.Manual
      jobRun.status mustBe JobRunStatus.Succeeded
      // This one covers only the recalculation step, not the sync the nightly sequence wraps around it, so it has no
      // counts to report -- and `record` stores an empty details object as nothing at all.
      jobRun.details mustBe empty
    }
  }

  "GET /adminapi/checkImagery" should {
    "record the sweep as a manual run of the nightly imagery-expiry job, with its counts" in {
      val (code, body, jobRun) = trigger("/adminapi/checkImagery", CheckImageExpiryActor.Name)
      code mustBe OK
      body mustBe ImageryResult.summary
      jobRun.triggeredBy mustBe JobRunTrigger.Manual
      jobRun.status mustBe JobRunStatus.Succeeded
      // The nightly sweep and this trigger share one details shape, so the panel can chart them as the same job.
      jobRun.details.value mustBe ImageryResult.runDetails
    }
  }

  "GET /adminapi/refreshOsmWayData" should {
    "record the refresh as a manual run of the nightly OSM job" in {
      StubOsmWayService.answer = () => Future.successful(WaysRefreshed)
      val (code, body, jobRun) = trigger("/adminapi/refreshOsmWayData", OsmWayRefreshActor.Name)
      code mustBe OK
      body must include(WaysRefreshed.toString)
      jobRun.triggeredBy mustBe JobRunTrigger.Manual
      jobRun.status mustBe JobRunStatus.Succeeded
      (jobRun.details.value \ "ways_refreshed").as[Int] mustBe WaysRefreshed
    }

    "record a half-finished refresh as a failure, and say so rather than reporting a count" in {
      // This job runs for tens of minutes over a shared community API and can die partway. The run row is the only
      // durable account of that, and the caller is told progress is kept -- both are easy to lose to a refactor.
      StubOsmWayService.answer = () => Future.failed(new RuntimeException("overpass timed out"))
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
      (jobRun.details.value \ "labels_clustered").as[Int] mustBe ClusterResults.labelCount
      (jobRun.details.value \ "clusters_created").as[Int] mustBe ClusterResults.clusterCount
    }
  }

  "the job triggers" should {
    "refuse a signed-in non-admin, naming the role they want, without starting the job" in {
      // The anonymous checks in RouteAuthPostureSpec cannot tell a guard that is on from one that admits anyone
      // signed in, and each of these kicks off hours of work on a production city.
      val idFloor = highestRunId
      Seq(
        "/adminapi/updateUserStats"           -> UserStatActor.Name,
        "/adminapi/updateFunnelStats"         -> FunnelStatActor.Name,
        "/adminapi/recalculateStreetPriority" -> RecalculateStreetPriorityActor.Name,
        "/adminapi/checkImagery"              -> CheckImageExpiryActor.Name,
        "/adminapi/refreshOsmWayData"         -> OsmWayRefreshActor.Name,
        "/runClustering"                      -> ClusteringActor.Name
      ).foreach { case (path, jobName) =>
        val response = asVisitor(path)
        status(response) mustBe FORBIDDEN
        contentAsString(response) must include("Administrator")
        runsSince(idFloor, jobName) mustBe empty
      }
    }
  }
}

/**
 * Answers the OSM way refresh without calling Overpass.
 *
 * A subclass rather than a proxy because `OsmWayService` is a concrete class; Guice supplies the real dependencies,
 * none of which the override touches.
 */
@Singleton
class StubOsmWayService @Inject() (
    dbConfigProvider: DatabaseConfigProvider,
    ws: WSClient,
    cacheApi: AsyncCacheApi,
    actorSystem: ActorSystem,
    osmWayTable: OsmWayTable
)(implicit ec: ExecutionContext)
    extends OsmWayService(dbConfigProvider, ws, cacheApi, actorSystem, osmWayTable) {
  override def refreshOsmWayData(): Future[Int] = StubOsmWayService.answer()
}

object StubOsmWayService {

  /** Set per test: this endpoint's failure path is part of its contract, and Guice owns the instance. */
  @volatile var answer: () => Future[Int] = () => Future.successful(0)
}
