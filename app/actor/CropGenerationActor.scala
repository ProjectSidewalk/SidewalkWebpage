package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import models.utils.JobRunTrigger
import org.apache.pekko.actor.{Actor, Cancellable}
import play.api.Logger
import service.{ConfigService, CropService, JobRunService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object CropGenerationActor {
  val Name = "crop-generation-actor"
  case object Tick
}

/**
 * Nightly reconciliation of the derived imagery (#4865): cuts a crop for every label without one whose pano is in
 * the self-hosted store, and a downscaled copy of every stored pano wider than the viewer can render. The
 * scraper that fills the store runs once per city per day at a time of its own, so a pano it fetches after this
 * job's slot is picked up the following night.
 */
@Singleton
class CropGenerationActor @Inject() (cropService: CropService, jobRunService: JobRunService)(implicit
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
            ScheduledJobs.CropGeneration.hour,
            ScheduledJobs.CropGeneration.minute,
            hoursOffset
          ).toMillis.millis,
          24.hours,
          self,
          CropGenerationActor.Tick
        )(context.dispatcher)
      )
      logger.info("CropGenerationActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = { case CropGenerationActor.Tick =>
    val currentTimeStart: String = dateFormatter.format(Instant.now())
    logger.info(s"Auto-scheduled crop generation started at: $currentTimeStart")
    jobRunService
      .record(CropGenerationActor.Name, JobRunTrigger.Scheduled)(cropService.generateMissingCrops())(_.runDetails)
      .onComplete {
        case Success(results) =>
          logger.info(results.summary)
          val currentEndTime: String = dateFormatter.format(Instant.now())
          logger.info(s"Crop generation completed at: $currentEndTime")
        case Failure(e) => logger.error(s"Error generating crops: ${e.getMessage}")
      }
  }
}
