package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import models.utils.JobRunTrigger
import org.apache.pekko.actor.{Actor, Cancellable}
import play.api.Logger
import service.{ConfigService, JobRunService, PlacesService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object PlacesRefreshActor {
  val Name = "places-refresh-actor"

  case object Tick
}

/**
 * Keeps the `place` table current from OpenStreetMap (#5311).
 *
 * Ticks nightly like every job, but the service only fetches when the table is empty or older than a week: places
 * change by the month, and Overpass is a shared public service. Recording the skipped ticks too is what lets the
 * Health panel tell "fresh, so nothing to do" from "the scheduler stopped firing".
 */
@Singleton
class PlacesRefreshActor @Inject() (
    placesService: PlacesService,
    jobRunService: JobRunService
)(implicit
    ec: ExecutionContext,
    configService: ConfigService
) extends Actor {

  private var cancellable: Option[Cancellable] = None
  private val logger                           = Logger(this.getClass)

  override def preStart(): Unit = {
    super.preStart()
    // Each city shifts the whole schedule by its own offset, so 50+ deployments don't hit Overpass at once.
    configService.getOffsetHours.foreach { hoursOffset =>
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(
            ScheduledJobs.PlacesRefresh.hour,
            ScheduledJobs.PlacesRefresh.minute,
            hoursOffset
          ).toMillis.millis,
          24.hours,
          self,
          PlacesRefreshActor.Tick
        )(context.dispatcher)
      )
      logger.info("PlacesRefreshActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = { case PlacesRefreshActor.Tick =>
    // An admin can have triggered a refresh minutes earlier; recording this tick as a failed run would show the job
    // red on the Health panel while the refresh it duplicates is in fact succeeding.
    if (placesService.isRunning) {
      logger.info("Auto-scheduled places refresh skipped: a refresh is already in progress.")
    } else {
      val currentTimeStart: String = dateFormatter.format(Instant.now())
      logger.info(s"Auto-scheduled places refresh starting at: $currentTimeStart")
      jobRunService
        .record(PlacesRefreshActor.Name, JobRunTrigger.Scheduled)(placesService.refresh(force = false))(_.runDetails)
        .onComplete {
          case Success(result) if result.skipped =>
            logger.info(
              s"Places refresh skipped: ${result.total} places, fetched ${result.fetchedAt.getOrElse("never")}"
            )
          case Success(result) =>
            logger.info(
              s"Places refresh finished: ${result.total} places (${result.inserted} new, ${result.updated} changed, " +
                s"${result.deleted} gone, ${result.dropped} outside the city)"
            )
          case Failure(e) => logger.error("Auto-scheduled places refresh failed", e)
        }
    }
  }
}
