package actor

import actor.ActorUtils.getTimeToNextUpdate
import models.utils.JobRunTrigger
import org.apache.pekko.actor.{Actor, ActorRef, Cancellable}
import play.api.Logger
import service.{BasemapService, ConfigService, JobRunService}

import javax.inject.*
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.*
import scala.util.{Failure, Success}

object BasemapRefreshActor {
  val Name = "basemap-refresh-actor"

  case object Tick

  /**
   * @param cityId The city's id.
   * @return       When a city with no archive builds its first: within an hour, spread by city, since a deploy
   *               restarts every city at once.
   */
  def firstBuildDelay(cityId: String): FiniteDuration = 2.minutes + Math.floorMod(cityId.hashCode, 60).minutes
}

/**
 * Keeps the minimap's basemap archive current (#5716). Ticks nightly and lets BasemapService.isDue decide; skipped
 * ticks are recorded too, so the Health panel can tell "fresh" from "the scheduler stopped".
 */
@Singleton
class BasemapRefreshActor @Inject() (
    basemapService: BasemapService,
    jobRunService: JobRunService
)(using ec: ExecutionContext, configService: ConfigService)
    extends Actor {

  private var cancellables: Seq[Cancellable] = Seq.empty
  private val logger                         = Logger(this.getClass)

  override def preStart(): Unit = {
    super.preStart()
    // Each city shifts the whole schedule by its own offset, so 50+ deployments don't all download on the same hour.
    configService.getOffsetHours.foreach { hoursOffset =>
      val nightly = context.system.scheduler.scheduleAtFixedRate(
        getTimeToNextUpdate(
          ScheduledJobs.BasemapRefresh.hour,
          ScheduledJobs.BasemapRefresh.minute,
          hoursOffset
        ).toMillis.millis,
        24.hours,
        self,
        BasemapRefreshActor.Tick
      )(using context.dispatcher, ActorRef.noSender)
      val firstBuild = Option.when(basemapService.currentArchive.isEmpty) {
        val delay = BasemapRefreshActor.firstBuildDelay(configService.getCityId)
        context.system.scheduler.scheduleOnce(delay, self, BasemapRefreshActor.Tick)(using
          context.dispatcher,
          ActorRef.noSender
        )
      }
      cancellables = nightly +: firstBuild.toSeq
      logger.info("BasemapRefreshActor created")
    }
  }

  override def postStop(): Unit = {
    cancellables.foreach(_.cancel())
    cancellables = Seq.empty
    super.postStop()
  }

  def receive: Receive = { case BasemapRefreshActor.Tick =>
    // An admin can have triggered a rebuild minutes earlier; recording this tick as a failed run would show the job
    // red on the Health panel while the rebuild it duplicates is in fact succeeding.
    if (basemapService.isRunning) {
      logger.info("Auto-scheduled basemap refresh skipped: a refresh is already in progress.")
    } else {
      jobRunService
        .record(BasemapRefreshActor.Name, JobRunTrigger.Scheduled)(basemapService.refresh(force = false))(_.runDetails)
        .onComplete {
          case Success(result) if result.skipped =>
            logger.info(s"Basemap refresh skipped: current archive ${result.archive.getOrElse("none")}")
          case Success(result) => logger.info(s"Basemap refresh finished: ${result.runDetails}")
          case Failure(e)      => logger.error("Auto-scheduled basemap refresh failed", e)
        }
    }
  }
}
