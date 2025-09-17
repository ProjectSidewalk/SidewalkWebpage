package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.{ConfigService, RegionService, StreetService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object RecalculateStreetPriorityActor {
  val Name  = "recalculate-street-priority-actor"
  def props = Props[RecalculateStreetPriorityActor]()
  case object Tick
}

@Singleton
class RecalculateStreetPriorityActor @Inject() (streetService: StreetService, regionService: RegionService)(implicit
    ec: ExecutionContext,
    configService: ConfigService
) extends Actor {

  private var cancellable: Option[Cancellable] = None
  private val logger                           = Logger(this.getClass)

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    configService.getOffsetHours.foreach { hoursOffset =>
      // Target time is 1:45 am Pacific + offset.
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(1, 45, hoursOffset).toMillis.millis,
          24.hours,
          self,
          RecalculateStreetPriorityActor.Tick
        )(context.dispatcher)
      )
      logger.info("RecalculateStreetPriorityActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = { case RecalculateStreetPriorityActor.Tick =>
    val currentTimeStart: String = dateFormatter.format(Instant.now())
    logger.info(s"Auto-scheduled recalculation of street priority starting at: $currentTimeStart")
    (for {
      _ <- streetService.recalculateStreetPriority
      _ <- regionService.truncateRegionCompletionTable
      _ <- regionService.initializeRegionCompletionTable
    } yield {
      val currentEndTime: String = dateFormatter.format(Instant.now())
      logger.info(s"Street priority recalculation completed at: $currentEndTime")
    }).onComplete {
      case Success(_) =>
      case Failure(e) => logger.error("Error recalculating street priority", e)
    }
  }
}
