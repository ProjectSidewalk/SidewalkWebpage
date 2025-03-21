package actor

import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.{ConfigService, StreetService, RegionService}

import java.util.Locale
import java.time
import java.time.format.DateTimeFormatter
import java.time.{Instant, LocalDateTime, ZoneId}
import javax.inject._
import scala.concurrent.duration._
import scala.concurrent.ExecutionContext


object RecalculateStreetPriorityActor {
  val Name = "recalculate-street-priority-actor"
  def props = Props[RecalculateStreetPriorityActor]
  case object Tick
}

@Singleton
class RecalculateStreetPriorityActor @Inject()(streetService: StreetService,
                                               regionService: RegionService
                                              )(implicit ec: ExecutionContext, configService: ConfigService) extends Actor {
  private var cancellable: Option[Cancellable] = None
  private val logger = Logger("application")
  private val dateFormatter: DateTimeFormatter = DateTimeFormatter
    .ofPattern("EE MMM dd HH:mm:ss zzz yyyy")
    .withLocale(Locale.US)
    .withZone(ZoneId.of("UTC"))
  logger.info("RecalculateStreetPriorityActor created")

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    configService.getOffsetHours.foreach { hoursOffset =>

      // Set target time to 7:45 am Pacific + offset. If that time has passed, set it to that time tomorrow.
      val now: LocalDateTime = LocalDateTime.now(ZoneId.of("America/Los_Angeles"))
      val todayTarget: LocalDateTime = now.withHour(18 + hoursOffset).withMinute(47).withSecond(0)
      val nextRun: LocalDateTime = if (now.isAfter(todayTarget)) todayTarget.plusDays(1) else todayTarget
      val durationToNextUpdate: time.Duration = java.time.Duration.between(now, nextRun)

      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          durationToNextUpdate.toMillis.millis,
          24.hours,
          self,
          RecalculateStreetPriorityActor.Tick
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
    case RecalculateStreetPriorityActor.Tick =>
      val currentTimeStart: String = dateFormatter.format(Instant.now())
      logger.info(s"Auto-scheduled recalculation of street priority starting at: $currentTimeStart")
      for {
        _ <- streetService.recalculateStreetPriority
        _ <- regionService.truncateRegionCompletionTable
        _ <- regionService.initializeRegionCompletionTable
      } yield {
        val currentEndTime: String = dateFormatter.format(Instant.now())
        logger.info(s"Street priority recalculation completed at: $currentEndTime")
      }
  }
}
