package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import controllers.ClusterController
import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.ConfigService

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

object ClusterLabelAttributesActor {
  val Name = "cluster-label-attributes-actor"
  def props = Props[ClusterLabelAttributesActor]
  case object Tick
}

@Singleton
class ClusterLabelAttributesActor @Inject()(clusterController: ClusterController)
                                           (implicit ec: ExecutionContext, configService: ConfigService) extends Actor {
  private var cancellable: Option[Cancellable] = None
  private val logger = Logger("application")

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    configService.getOffsetHours.foreach { hoursOffset =>
      // Target time is 8:00 am Pacific + offset.
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(8, 0, hoursOffset).toMillis.millis,
          24.hours,
          self,
          ClusterLabelAttributesActor.Tick
        )(context.dispatcher)
      )
      logger.info("ClusterLabelAttributesActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = {
    case ClusterLabelAttributesActor.Tick =>
      val currentTimeStart: String = dateFormatter.format(Instant.now())
      logger.info(s"Auto-scheduled clustering of label attributes starting at: $currentTimeStart")
      clusterController.runClusteringHelper("both").map { results =>
        val currentEndTime: String = dateFormatter.format(Instant.now())
        logger.info(s"Label attribute clustering completed at: $currentEndTime")
        logger.info("Clustering results: " + results)
      }
  }
}
