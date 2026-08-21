package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import models.utils.JobRunTrigger
import org.apache.pekko.actor.{Actor, Cancellable}
import play.api.Logger
import service.{ConfigService, JobRunService, PanoDataService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object CheckImageExpiryActor {
  val Name = "check-image-expiry-actor"
  case object Tick
}

@Singleton
class CheckImageExpiryActor @Inject() (panoDataService: PanoDataService, jobRunService: JobRunService)(implicit
    ec: ExecutionContext,
    configService: ConfigService
) extends Actor {

  private var cancellable: Option[Cancellable] = None
  private val logger                           = Logger(this.getClass)

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    configService.getOffsetHours.foreach { hoursOffset =>
      // Scheduled time comes from ScheduledJobs, shifted by this city's offset.
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(
            ScheduledJobs.CheckImageExpiry.hour,
            ScheduledJobs.CheckImageExpiry.minute,
            hoursOffset
          ).toMillis.millis,
          24.hours,
          self,
          CheckImageExpiryActor.Tick
        )(context.dispatcher)
      )
      logger.info("CheckImageExpiryActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = { case CheckImageExpiryActor.Tick =>
    val currentTimeStart: String = dateFormatter.format(Instant.now())
    logger.info(s"Auto-scheduled checking image expiry started at: $currentTimeStart")
    jobRunService
      .record(CheckImageExpiryActor.Name, JobRunTrigger.Scheduled)(panoDataService.checkForImagery)(_.runDetails)
      .onComplete {
        case Success(results) =>
          logger.info(results.summary)
          val currentEndTime: String = dateFormatter.format(Instant.now())
          logger.info(s"Checking image expiry completed at: $currentEndTime")
        case Failure(e) => logger.error(s"Error checking for expired imagery: ${e.getMessage}")
      }
  }
}
