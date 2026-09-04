package actor

import models.utils.JobRunTrigger
import org.apache.pekko.actor.{ActorRef, ActorSystem, Props}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.concurrent.Eventually
import org.scalatest.time.{Millis, Seconds, Span}
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.JsObject
import service.CropService.CropRunResult
import service.{ConfigService, CropService, JobRunService}
import util.StubService

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.jdk.CollectionConverters._

/**
 * What the nightly crop actor does on a tick (#4865): records a scheduled run of the job — or, while a manual run is
 * in flight, nothing at all. The second is the case that matters for the Health panel: `generateMissingCrops` refuses
 * a second concurrent run, and a refusal recorded as a failed nightly run would show the job red while it is running.
 *
 * A bare actor system with stubbed collaborators; no application, no database.
 */
class CropGenerationActorSpec extends PlaySpec with BeforeAndAfterAll with Eventually {

  private val system                        = ActorSystem("CropGenerationActorSpec")
  implicit private val ec: ExecutionContext = system.dispatcher

  private val result = CropRunResult(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)

  override def afterAll(): Unit = {
    val _ = Await.result(system.terminate(), 10.seconds)
    super.afterAll()
  }

  /** Stands in for the row-writing service: runs the work and remembers what it was asked to record. */
  private class RecordingJobRunService extends JobRunService {
    val calls = new CopyOnWriteArrayList[(String, JobRunTrigger.Value)]()

    def record[T](jobName: String, trigger: JobRunTrigger.Value)(work: => Future[T])(
        details: T => JsObject
    ): Future[T] = {
      calls.add((jobName, trigger))
      work
    }
  }

  /**
   * @param running   What the crop service reports when the actor asks whether a run is in flight; each ask is
   *                  counted, which is how a test knows a tick has been looked at.
   * @param generated Counts calls to `generateMissingCrops`.
   */
  private def actorWith(
      running: () => Boolean,
      asked: AtomicInteger,
      generated: AtomicInteger,
      jobRuns: RecordingJobRunService
  ): ActorRef = {
    // The schedule is never armed, so the only ticks are the ones a test sends.
    implicit val configService: ConfigService =
      StubService.answering[ConfigService](Map("getOffsetHours" -> Future.never))
    val cropService = StubService.answeringWith[CropService](
      Map(
        "isRunning"            -> (() => { val _ = asked.incrementAndGet(); running() }),
        "generateMissingCrops" -> (() => { val _ = generated.incrementAndGet(); Future.successful(result) })
      )
    )
    system.actorOf(Props(new CropGenerationActor(cropService, jobRuns)))
  }

  implicit override val patienceConfig: PatienceConfig =
    PatienceConfig(timeout = Span(10, Seconds), interval = Span(50, Millis))

  "CropGenerationActor" should {
    "record a tick as a scheduled run of the crop job and let it run" in {
      val jobRuns   = new RecordingJobRunService
      val generated = new AtomicInteger
      val actor     = actorWith(() => false, new AtomicInteger, generated, jobRuns)

      actor ! CropGenerationActor.Tick

      eventually {
        jobRuns.calls.asScala.toList mustBe List((CropGenerationActor.Name, JobRunTrigger.Scheduled))
        generated.get mustBe 1
      }
    }

    "skip a tick, recording nothing, while a run is already in flight" in {
      val jobRuns   = new RecordingJobRunService
      val asked     = new AtomicInteger
      val generated = new AtomicInteger
      val running   = Promise[Unit]()
      // The first tick sees a run in flight; the flag clears for the second, whose recording proves the first tick
      // was fully handled — an actor takes its messages in order — without a sleep standing in for that proof.
      val actor = actorWith(() => !running.isCompleted, asked, generated, jobRuns)

      actor ! CropGenerationActor.Tick
      eventually { asked.get mustBe 1 }
      running.success(())
      actor ! CropGenerationActor.Tick

      eventually {
        jobRuns.calls.asScala.toList mustBe List((CropGenerationActor.Name, JobRunTrigger.Scheduled))
        asked.get mustBe 2
        generated.get mustBe 1
      }
    }
  }
}
