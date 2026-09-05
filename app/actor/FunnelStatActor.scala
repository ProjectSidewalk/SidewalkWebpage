package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import org.apache.pekko.actor.{Actor, Cancellable}
import play.api.Logger
import models.utils.JobRunTrigger
import play.api.libs.json.{JsObject, Json}
import service.{AdminService, ConfigService, JobRunService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object FunnelStatActor {
  val Name = "funnel-stat-actor"
  case object Tick

  /**
   * The counts as they are stored against a `background_job_run` row.
   *
   * Defined here rather than at each call site so the nightly recompute and the admin hand-trigger can't record the
   * same job under two different shapes.
   *
   * @param rowsWritten Rows written to `funnel_stat`.
   * @return The run's `details` object.
   */
  def runDetails(rowsWritten: Int): JsObject = Json.obj("rows_written" -> rowsWritten)
}

/**
 * Nightly recompute of this deployment's engagement funnel into the local `funnel_stat` table (#288).
 *
 * Mirrors [[UserStatActor]]: each deployment precomputes only its own city's funnel; the cross-city Across Cities page
 * reads every schema's precomputed table. [[ScheduledJobs]] holds the time, in an empty slot between the user-stat and
 * clustering jobs, shifted by the per-deployment offset that staggers co-hosted cities.
 *
 * @param adminService Recompute entry point ([[AdminService.updateFunnelStatTable]]).
 */
@Singleton
class FunnelStatActor @Inject() (adminService: AdminService, jobRunService: JobRunService)(implicit
    ec: ExecutionContext,
    configService: ConfigService
) extends Actor {

  private var cancellable: Option[Cancellable] = None
  private val logger                           = Logger(this.getClass)

  override def preStart(): Unit = {
    super.preStart()
    // Per-city offset staggers computation/resource use across co-hosted deployments.
    configService.getOffsetHours.foreach { hoursOffset =>
      // Scheduled time comes from ScheduledJobs, shifted by this city's offset.
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(
            ScheduledJobs.FunnelStats.hour,
            ScheduledJobs.FunnelStats.minute,
            hoursOffset
          ).toMillis.millis,
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
    jobRunService
      .record(FunnelStatActor.Name, JobRunTrigger.Scheduled)(adminService.updateFunnelStatTable())(
        FunnelStatActor.runDetails
      )
      .onComplete {
        case Success(nRows) =>
          val currentEndTime: String = dateFormatter.format(Instant.now())
          logger.info(s"Funnel stats updated ($nRows rows) completed at: $currentEndTime")
        case Failure(e) => logger.error(s"Error updating funnel stats: ${e.getMessage}")
      }
  }
}
