package service

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import models.utils.{BackgroundJobRun, BackgroundJobRunTable, JobRunStatus, JobRunTrigger}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.OptionValues
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import slick.dbio.DBIO

import scala.concurrent.duration._
import scala.concurrent.{Await, Future}

/**
 * DB-backed contract test for [[JobRunService]] (#4928).
 *
 * The wrapper is bolted onto every nightly actor, so its central promise is that it changes nothing: whatever the job
 * returned comes back untouched, and whatever it threw propagates unchanged. The rest is that a run always ends up
 * closed with the right outcome, including when the job throws synchronously before its Future exists.
 *
 * Requires a Postgres database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the scheduling actors
 * are disabled so no real job writes rows mid-test.
 */
class JobRunServiceSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite with OptionValues {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val jobRunService = app.injector.instanceOf[JobRunService]
  private val jobRunTable   = app.injector.instanceOf[BackgroundJobRunTable]
  private val dbConfig      = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)
  private def await[T](f: Future[T]): T  = Await.result(f, 60.seconds)
  private val jobName                    = "test-4928-service-job"

  private def runsFor(name: String): Seq[BackgroundJobRun] =
    run(jobRunTable.backgroundJobRuns.filter(_.jobName === name).sortBy(_.backgroundJobRunId).result)

  private def cleanUp(): Unit = { val _ = run(sqlu"DELETE FROM background_job_run WHERE job_name = $jobName") }

  override def beforeAll(): Unit = { super.beforeAll(); cleanUp() }
  override def afterAll(): Unit  = { cleanUp(); super.afterAll() }

  "JobRunService.record" should {
    "return the job's own result and record it as succeeded, with its counts" in {
      cleanUp()
      val result = await(
        jobRunService.record(jobName, JobRunTrigger.Scheduled)(Future.successful(7)) { n =>
          Json.obj("things_done" -> n)
        }
      )
      result mustBe 7

      val runs = runsFor(jobName)
      runs must have size 1
      runs.head.status mustBe JobRunStatus.Succeeded
      runs.head.finishedAt mustBe defined
      runs.head.details mustBe Some(Json.obj("things_done" -> 7))
      runs.head.triggeredBy mustBe JobRunTrigger.Scheduled
    }

    "record no details when the job reports none" in {
      cleanUp()
      await(jobRunService.record(jobName, JobRunTrigger.Scheduled)(Future.successful(()))(_ => Json.obj()))
      runsFor(jobName).head.details mustBe None
    }

    "propagate the job's failure unchanged and record it" in {
      cleanUp()
      val boom   = new IllegalStateException("boom")
      val thrown = the[IllegalStateException] thrownBy {
        await(jobRunService.record(jobName, JobRunTrigger.Scheduled)(Future.failed[Int](boom))(_ => Json.obj()))
      }
      (thrown eq boom) mustBe true

      val failed = runsFor(jobName).head
      failed.status mustBe JobRunStatus.Failed
      failed.finishedAt mustBe defined
      failed.errorMessage.value must include("boom")
    }

    "record a job that throws before returning a Future" in {
      cleanUp()
      // The actors resolve config and API keys eagerly inside the call they hand us, so this is a real failure mode
      // rather than a hypothetical one: without the deferral, the throw would escape past the bracket unrecorded.
      the[RuntimeException] thrownBy {
        await(
          jobRunService.record[Int](jobName, JobRunTrigger.Scheduled)(throw new RuntimeException("eager boom"))(_ =>
            Json.obj()
          )
        )
      }

      val failed = runsFor(jobName).head
      failed.status mustBe JobRunStatus.Failed
      failed.errorMessage.value must include("eager boom")
    }

    "tag a manually triggered run so it can't stand in for a scheduled one" in {
      cleanUp()
      await(jobRunService.record(jobName, JobRunTrigger.Manual)(Future.successful(1))(_ => Json.obj()))
      runsFor(jobName).head.triggeredBy mustBe JobRunTrigger.Manual
    }

    "still return the job's result when recording its details throws" in {
      cleanUp()
      val result = await(
        jobRunService.record(jobName, JobRunTrigger.Scheduled)(Future.successful(3)) { _ =>
          throw new RuntimeException("details boom")
        }
      )
      result mustBe 3
      runsFor(jobName).head.status mustBe JobRunStatus.Succeeded
    }
  }
}
