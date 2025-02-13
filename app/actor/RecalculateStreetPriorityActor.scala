package actor

import java.util.Locale
import org.apache.pekko.actor.{Actor, Cancellable, Props}

import javax.inject._
import service.utils.ConfigService

import scala.concurrent.ExecutionContext
import play.api.Logger

import java.time
import java.time.format.DateTimeFormatter
import java.time.{Instant, LocalDateTime, ZoneId}
import scala.concurrent.duration._


object RecalculateStreetPriorityActor {
  val Name = "recalculate-street-priority-actor"
  def props = Props[RecalculateStreetPriorityActor]
  case object Tick
}

@Singleton
class RecalculateStreetPriorityActor @Inject()(implicit ec: ExecutionContext, configService: ConfigService) extends Actor {
  private var cancellable: Option[Cancellable] = None
  private val logger = Logger(this.getClass)
  private val dateFormatter: DateTimeFormatter = DateTimeFormatter
    .ofPattern("EE MMM dd HH:mm:ss zzz yyyy")
    .withLocale(Locale.US)
    .withZone(ZoneId.of("UTC"))
  println("RecalculateStreetPriorityActor created")

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    configService.getOffsetHours.foreach { hoursOffset =>

      // Set target time to 7:45 am Pacific + offset. If that time has passed, set it to that time tomorrow.
      val now: LocalDateTime = LocalDateTime.now(ZoneId.of("America/Los_Angeles"))
      val todayTarget: LocalDateTime = now.withHour(7 + hoursOffset).withMinute(45).withSecond(0)
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
//      StreetEdgePriorityTable.recalculateStreetPriority()
//      RegionCompletionTable.truncateTable()
//      RegionCompletionTable.initializeRegionCompletionTable()
      val currentEndTime: String = dateFormatter.format(Instant.now())
      logger.info(s"Street priority recalculation completed at: $currentEndTime")
  }
}
