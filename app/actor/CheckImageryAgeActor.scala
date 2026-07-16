package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.{ConfigService, ImageryFreshnessService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object CheckImageryAgeActor {
  val Name  = "check-imagery-age-actor"
  def props = Props[CheckImageryAgeActor]()
  case object Tick
}

/**
 * Nightly poll of the city's imagery provider for current capture dates on a batch of streets (#4384).
 *
 * Feeds street_imagery.newest_capture, which the imagery-freshness sync (run later the same night, at the top of
 * RecalculateStreetPriorityActor's 1:45am sequence) compares against audit dates to flag audits performed on
 * since-replaced imagery. Scheduled at 12:45am Pacific + the per-city offset so a night's discoveries propagate to
 * routing and completion the same night.
 */
@Singleton
class CheckImageryAgeActor @Inject() (imageryFreshnessService: ImageryFreshnessService)(implicit
    ec: ExecutionContext,
    configService: ConfigService
) extends Actor {

  private var cancellable: Option[Cancellable] = None
  private val logger                           = Logger(this.getClass)

  override def preStart(): Unit = {
    super.preStart()
    // Each city runs at its own hour offset to stagger computation/resource use across deployments.
    configService.getOffsetHours.foreach { hoursOffset =>
      // Target time is 12:45 am Pacific + offset.
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(0, 45, hoursOffset).toMillis.millis,
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
    imageryFreshnessService.pollImageryAges().onComplete {
      case Success(summary) => logger.info(summary)
      case Failure(e)       => logger.error("Error polling imagery ages", e)
    }
  }
}
