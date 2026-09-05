package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import org.apache.pekko.actor.{Actor, Cancellable}
import play.api.Logger
import models.utils.JobRunTrigger
import service.{ClusterService, ConfigService, JobRunService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object ClusteringActor {
  val Name = "clustering-actor"
  case object Tick
}

@Singleton
class ClusteringActor @Inject() (clusterService: ClusterService, jobRunService: JobRunService)(implicit
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
            ScheduledJobs.Clustering.hour,
            ScheduledJobs.Clustering.minute,
            hoursOffset
          ).toMillis.millis,
          24.hours,
          self,
          ClusteringActor.Tick
        )(context.dispatcher)
      )
      logger.info("ClusteringActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = { case ClusteringActor.Tick =>
    val currentTimeStart: String = dateFormatter.format(Instant.now())
    logger.info(s"Auto-scheduled clustering of labels starting at: $currentTimeStart")
    jobRunService
      .record(ClusteringActor.Name, JobRunTrigger.Scheduled)(clusterService.runClustering())(_.runDetails)
      .onComplete {
        case Success(results) =>
          val currentEndTime: String = dateFormatter.format(Instant.now())
          logger.info(s"Label clustering completed at: $currentEndTime")
          logger.info("Clustering results: " + results)
        case Failure(e) => logger.error(s"Error clustering labels: ${e.getMessage}")
      }
  }
}
