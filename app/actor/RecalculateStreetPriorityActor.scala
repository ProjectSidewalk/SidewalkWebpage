package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import models.utils.JobRunTrigger
import org.apache.pekko.actor.{Actor, Cancellable}
import play.api.Logger
import play.api.libs.json.Json
import service.{ConfigService, ImageryFreshnessService, JobRunService, RegionService, StreetService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object RecalculateStreetPriorityActor {
  val Name = "recalculate-street-priority-actor"

  /**
   * Job name for the imagery-freshness sync that opens this actor's sequence.
   *
   * Recorded as its own run rather than folded into the sequence's: its flag counts are the only measure of whether
   * the re-audit signal is still moving, and it is deliberately recovered rather than propagated, so a sequence that
   * reports success says nothing about whether the sync inside it worked.
   */
  val FreshnessSyncJobName = "imagery-freshness-sync"

  case object Tick
}

@Singleton
class RecalculateStreetPriorityActor @Inject() (
    streetService: StreetService,
    regionService: RegionService,
    imageryFreshnessService: ImageryFreshnessService,
    jobRunService: JobRunService
)(implicit
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
            ScheduledJobs.RecalculateStreetPriority.hour,
            ScheduledJobs.RecalculateStreetPriority.minute,
            hoursOffset
          ).toMillis.millis,
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
    jobRunService
      .record(RecalculateStreetPriorityActor.Name, JobRunTrigger.Scheduled)(for {
        // The freshness sync must precede the priority recalc and region_completion rebuild so that all three stay
        // mutually consistent (see ImageryFreshnessService.syncImageryFreshness for the ordering contract). A sync
        // failure is recovered rather than propagated: the recalc and rebuild are still correct against the previous
        // night's flags, and letting the sync abort them would leave routing and coverage stale for a whole day. The
        // recovery happens outside the sync's own run record, so that record still shows the failure.
        syncSummary <- jobRunService
          .record(RecalculateStreetPriorityActor.FreshnessSyncJobName, JobRunTrigger.Scheduled)(
            imageryFreshnessService.syncImageryFreshness
          ) { sync =>
            Json.obj(
              "streets_refreshed" -> sync.streetsRefreshed,
              "audits_flagged"    -> sync.auditsFlagged,
              "audits_unflagged"  -> sync.auditsUnflagged
            )
          }
          .map { sync =>
            s"${sync.streetsRefreshed} streets refreshed, ${sync.auditsFlagged} audits flagged outdated, " +
              s"${sync.auditsUnflagged} unflagged"
          }
          .recover { case e: Throwable =>
            logger.error("Imagery freshness sync failed; continuing with the previous night's flags", e)
            "failed, see error above"
          }
        _ = logger.info(s"Imagery freshness sync: $syncSummary")
        _             <- streetService.recalculateStreetPriority
        _             <- regionService.truncateRegionCompletionTable
        regionsSeeded <- regionService.initializeRegionCompletionTable
      } yield regionsSeeded) { regionsSeeded => Json.obj("regions_seeded" -> regionsSeeded) }
      .onComplete {
        case Success(_) =>
          val currentEndTime: String = dateFormatter.format(Instant.now())
          logger.info(s"Street priority recalculation completed at: $currentEndTime")
        case Failure(e) => logger.error("Error recalculating street priority", e)
      }
  }
}
