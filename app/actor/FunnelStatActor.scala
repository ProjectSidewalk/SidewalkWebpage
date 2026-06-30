package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.{AdminService, ConfigService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object FunnelStatActor {
  val Name  = "funnel-stat-actor"
  def props = Props[FunnelStatActor]()
  case object Tick
}

/**
 * Nightly recompute of this deployment's engagement funnel into the local `funnel_stat` table (#288).
 *
 * Mirrors [[UserStatActor]]: each deployment precomputes only its own city's funnel; the cross-city Across Cities page
 * reads every schema's precomputed table. Scheduled at 3:15 am Pacific plus the per-deployment offset (which staggers
 * co-hosted cities), in an empty slot between the user-stat (1:30) and clustering (4:00) jobs.
 *
 * @param adminService Recompute entry point ([[AdminService.updateFunnelStatTable]]).
 */
@Singleton
class FunnelStatActor @Inject() (adminService: AdminService)(implicit
    ec: ExecutionContext,
    configService: ConfigService
) extends Actor {

  private var cancellable: Option[Cancellable] = None
  private val logger                           = Logger(this.getClass)

  override def preStart(): Unit = {
    super.preStart()
    // Per-city offset staggers computation/resource use across co-hosted deployments.
    configService.getOffsetHours.foreach { hoursOffset =>
      // Target time is 3:15 am Pacific + offset.
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(3, 15, hoursOffset).toMillis.millis,
          24.hours,
          self,
          FunnelStatActor.Tick
        )(context.dispatcher)
      )
      logger.info("FunnelStatActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = { case FunnelStatActor.Tick =>
    val currentTimeStart: String = dateFormatter.format(Instant.now())
    logger.info(s"Auto-scheduled computation of engagement funnel starting at: $currentTimeStart")
    adminService.updateFunnelStatTable().onComplete {
      case Success(nRows) =>
        val currentEndTime: String = dateFormatter.format(Instant.now())
        logger.info(s"Funnel stats updated ($nRows rows) completed at: $currentEndTime")
      case Failure(e) => logger.error(s"Error updating funnel stats: ${e.getMessage}")
    }
  }
}
