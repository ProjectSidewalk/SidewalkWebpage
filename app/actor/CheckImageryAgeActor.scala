package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import models.utils.JobRunTrigger
import org.apache.pekko.actor.{Actor, Cancellable}
import play.api.Logger
import play.api.libs.json.Json
import service.{ConfigService, ImageryFreshnessService, JobRunService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object CheckImageryAgeActor {
  val Name = "check-imagery-age-actor"
  case object Tick
}

/**
 * Nightly poll of the city's imagery provider for current capture dates on a batch of streets (#4384).
 *
 * Feeds street_imagery.newest_capture, which the imagery-freshness sync (run later the same night, at the top of
 * RecalculateStreetPriorityActor's sequence) compares against audit dates to flag audits performed on since-replaced
 * imagery. [[ScheduledJobs]] holds the time, chosen so a night's discoveries propagate to routing and completion the
 * same night.
 */
@Singleton
class CheckImageryAgeActor @Inject() (
    imageryFreshnessService: ImageryFreshnessService,
    jobRunService: JobRunService
)(implicit
    ec: ExecutionContext,
    configService: ConfigService
) extends Actor {

  private var cancellable: Option[Cancellable] = None
  private val logger                           = Logger(this.getClass)

  override def preStart(): Unit = {
    super.preStart()
    // Each city runs at its own hour offset to stagger computation/resource use across deployments.
    configService.getOffsetHours.foreach { hoursOffset =>
      // Scheduled time comes from ScheduledJobs, shifted by this city's offset.
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(
            ScheduledJobs.CheckImageryAge.hour,
            ScheduledJobs.CheckImageryAge.minute,
            hoursOffset
          ).toMillis.millis,
          24.hours,
          self,
          CheckImageryAgeActor.Tick
        )(context.dispatcher)
      )
      logger.info("CheckImageryAgeActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = { case CheckImageryAgeActor.Tick =>
    val currentTimeStart: String = dateFormatter.format(Instant.now())
    logger.info(s"Auto-scheduled imagery-age poll starting at: $currentTimeStart")
    jobRunService
      .record(CheckImageryAgeActor.Name, JobRunTrigger.Scheduled)(imageryFreshnessService.pollImageryAges()) { result =>
        Json.obj(
          "provider"                    -> result.provider,
          "streets_selected"            -> result.streetsSelected,
          "streets_polled"              -> result.streetsPolled,
          "streets_skipped"             -> result.streetsSkipped,
          "not_polled_reason"           -> result.notPolledReason,
          "no_imagery_streets_selected" -> result.noImageryStreetsSelected,
          "no_imagery_streets_polled"   -> result.noImageryStreetsPolled,
          "reopen_candidates_found"     -> result.reopenCandidatesFound
        )
      }
      .onComplete {
        case Success(result) => logger.info(result.summary)
        case Failure(e)      => logger.error("Error polling imagery ages", e)
      }
  }
}
