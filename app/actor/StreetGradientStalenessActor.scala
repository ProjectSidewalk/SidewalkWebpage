package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import models.utils.JobRunTrigger
import org.apache.pekko.actor.{Actor, Cancellable}
import play.api.Logger
import service.{ConfigService, JobRunService, StreetService}

import java.time.Instant
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationInt, DurationLong}
import scala.util.{Failure, Success}

object StreetGradientStalenessActor {
  val Name = "street-gradient-staleness-actor"
  case object Tick
}

/**
 * Nightly count of the served streets whose gradient is missing or stale (#5223), recorded so the Health panel shows
 * it. The table is filled offline, so this job changes nothing; it exists because a city that was never sampled, or
 * took a street import, would otherwise score without grade and nothing would say so.
 */
@Singleton
class StreetGradientStalenessActor @Inject() (
    streetService: StreetService,
    jobRunService: JobRunService
)(implicit
    ec: ExecutionContext,
    configService: ConfigService
) extends Actor {

  private var cancellable: Option[Cancellable] = None
  private val logger                           = Logger(this.getClass)

  override def preStart(): Unit = {
    super.preStart()
    configService.getOffsetHours.foreach { hoursOffset =>
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(
            ScheduledJobs.StreetGradientStaleness.hour,
            ScheduledJobs.StreetGradientStaleness.minute,
            hoursOffset
          ).toMillis.millis,
          24.hours,
          self,
          StreetGradientStalenessActor.Tick
        )(context.dispatcher)
      )
      logger.info("StreetGradientStalenessActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = { case StreetGradientStalenessActor.Tick =>
    logger.info(s"Auto-scheduled street gradient staleness count starting at: ${dateFormatter.format(Instant.now())}")
    jobRunService
      .record(StreetGradientStalenessActor.Name, JobRunTrigger.Scheduled)(streetService.countStreetGradientStaleness)(
        _.runDetails
      )
      .onComplete {
        case Success(counts) =>
          logger.info(s"Street gradient staleness: ${counts.unsampled} unsampled, ${counts.stale} stale street(s).")
        case Failure(e) => logger.error(s"Error counting street gradient staleness: ${e.getMessage}")
      }
  }
}
