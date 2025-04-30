package actor

import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.{AdminService, ConfigService}

import java.time
import java.time.format.DateTimeFormatter
import java.time.{Instant, LocalDateTime, OffsetDateTime, ZoneId}
import java.util.Locale
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

object UserStatActor {
  val Name = "user-stats-actor"
  def props = Props[UserStatActor]
  case object Tick
}

@Singleton
class UserStatActor @Inject()(adminService: AdminService)(implicit ec: ExecutionContext, configService: ConfigService) extends Actor {
  private var cancellable: Option[Cancellable] = None
  private val logger = Logger("application")
  private val dateFormatter: DateTimeFormatter = DateTimeFormatter
    .ofPattern("EE MMM dd HH:mm:ss zzz yyyy")
    .withLocale(Locale.US)
    .withZone(ZoneId.of("UTC"))
  logger.info("UserStatActor created")

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    configService.getOffsetHours.foreach { hoursOffset =>

      // Set target time to 12:30 am Pacific + offset. If that time has passed, set it to that time tomorrow.
      val now: LocalDateTime = LocalDateTime.now(ZoneId.of("America/Los_Angeles"))
      val todayHours: Int = Math.floorMod(0 + hoursOffset, 24)
      val todayTarget: LocalDateTime = now.withHour(todayHours).withMinute(30).withSecond(0)
      val nextRun: LocalDateTime = if (now.isAfter(todayTarget)) todayTarget.plusDays(1) else todayTarget
      val durationToNextUpdate: time.Duration = java.time.Duration.between(now, nextRun)

      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          durationToNextUpdate.toMillis.millis,
          24.hours,
          self,
          UserStatActor.Tick
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
      logger.info(s"Auto-scheduled computation of user stats starting at: $currentTimeStart")
      // Update stats for anyone who audited in past 36 hours.
      adminService.updateUserStatTable(OffsetDateTime.now().minusHours(36)).map { usersUpdated: Int =>
        val currentEndTime: String = dateFormatter.format(Instant.now())
        logger.info(s"User stats updated for $usersUpdated users!")
        logger.info(s"Updating user stats completed at: $currentEndTime")
      }
  }
}
