package actor

import controllers.ClusterController
import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.ConfigService

import java.time
import java.time.format.DateTimeFormatter
import java.time.{Instant, LocalDateTime, ZoneId}
import java.util.Locale
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

object ClusterLabelAttributesActor {
  val Name = "cluster-label-attributes-actor"
  def props = Props[ClusterLabelAttributesActor]
  case object Tick
}

@Singleton
class ClusterLabelAttributesActor @Inject()(clusterController: ClusterController)(implicit ec: ExecutionContext, configService: ConfigService) extends Actor {
  private var cancellable: Option[Cancellable] = None
  private val logger = Logger("application")
  private val dateFormatter: DateTimeFormatter = DateTimeFormatter
    .ofPattern("EE MMM dd HH:mm:ss zzz yyyy")
    .withLocale(Locale.US)
    .withZone(ZoneId.of("UTC"))
  logger.info("ClusterLabelAttributesActor created")

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    configService.getOffsetHours.foreach { hoursOffset =>

      // Set target time to 8:00 am Pacific + offset. If that time has passed, set it to that time tomorrow.
      val now: LocalDateTime = LocalDateTime.now(ZoneId.of("America/Los_Angeles"))
      val todayHours: Int = Math.floorMod(8 + hoursOffset, 24)
      val todayTarget: LocalDateTime = now.withHour(todayHours).withMinute(0).withSecond(0)
      val nextRun: LocalDateTime = if (now.isAfter(todayTarget)) todayTarget.plusDays(1) else todayTarget
      val durationToNextUpdate: time.Duration = java.time.Duration.between(now, nextRun)

      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          durationToNextUpdate.toMillis.millis,
          24.hours,
          self,
          ClusterLabelAttributesActor.Tick
        )(context.dispatcher)
      )
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
      for {
        results <- clusterController.runClusteringHelper("both")
      } yield {
        val currentEndTime: String = dateFormatter.format(Instant.now())
        logger.info(s"Label attribute clustering completed at: $currentEndTime")
        logger.info("Clustering results: " + results)
      }
  }
}
