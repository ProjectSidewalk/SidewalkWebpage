package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import models.utils.JobRunTrigger
import org.apache.pekko.actor.{Actor, Cancellable}
import play.api.Logger
import service.{ConfigService, JobRunService, SidewalkPresenceService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object SidewalkPresenceActor {
  val Name = "sidewalk-presence-actor"

  case object Tick
}

/**
 * Rebuilds the derived `sidewalk_presence` table nightly (#5279).
 *
 * A job of its own rather than a step of the clustering run: it reads labels and audits, not clusters, and nothing
 * downstream in the night waits on it, so chaining it would only tie a seconds-long rebuild to a job that can run
 * for hours in a big city.
 */
@Singleton
class SidewalkPresenceActor @Inject() (
    sidewalkPresenceService: SidewalkPresenceService,
    jobRunService: JobRunService
)(implicit
    ec: ExecutionContext,
    configService: ConfigService
) extends Actor {

  private var cancellable: Option[Cancellable] = None
  private val logger                           = Logger(this.getClass)

  override def preStart(): Unit = {
    super.preStart()
    // Each city shifts the whole schedule by its own offset, so 50+ deployments don't hit the database at once.
    configService.getOffsetHours.foreach { hoursOffset =>
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(
            ScheduledJobs.SidewalkPresenceRebuild.hour,
            ScheduledJobs.SidewalkPresenceRebuild.minute,
            hoursOffset
          ).toMillis.millis,
          24.hours,
          self,
          SidewalkPresenceActor.Tick
        )(context.dispatcher)
      )
      logger.info("SidewalkPresenceActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = { case SidewalkPresenceActor.Tick =>
    // An admin can have triggered the same rebuild seconds earlier; recording this tick as a failed run would show
    // the job red on the Health panel while the rebuild it duplicates is in fact succeeding.
    if (sidewalkPresenceService.isRunning) {
      logger.info("Auto-scheduled sidewalk presence rebuild skipped: a rebuild is already in progress.")
    } else {
      val currentTimeStart: String = dateFormatter.format(Instant.now())
      logger.info(s"Auto-scheduled sidewalk presence rebuild starting at: $currentTimeStart")
      jobRunService
        .record(SidewalkPresenceActor.Name, JobRunTrigger.Scheduled)(sidewalkPresenceService.rebuild())(_.runDetails)
        .onComplete {
          case Success(result) =>
            logger.info(
              s"Sidewalk presence rebuild finished: ${result.faces} faces (${result.inserted} new, " +
                s"${result.updated} changed, ${result.deleted} gone)"
            )
          case Failure(e) => logger.error("Auto-scheduled sidewalk presence rebuild failed", e)
        }
    }
  }
}
