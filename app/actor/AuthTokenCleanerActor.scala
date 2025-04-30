package actor

import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.ConfigService

import java.time
import java.time.{Instant, LocalDateTime, ZoneId}
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationInt, DurationLong}

object AuthTokenCleanerActor {
  val Name = "auth-token-cleaner-actor"
  def props = Props[AuthTokenCleanerActor]
  case object Tick
}

@Singleton
class AuthTokenCleanerActor @Inject()(authenticationService: service.AuthenticationService)(implicit ec: ExecutionContext, configService: ConfigService) extends Actor {
  private var cancellable: Option[Cancellable] = None
  private val logger = Logger("application")
  private val dateFormatter: DateTimeFormatter = DateTimeFormatter
    .ofPattern("EE MMM dd HH:mm:ss zzz yyyy")
    .withLocale(Locale.US)
    .withZone(ZoneId.of("UTC"))
  logger.info("AuthTokenCleanerActor created")

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    configService.getOffsetHours.foreach { hoursOffset =>

      // Set target time to 2:00 am Pacific + offset. If that time has passed, set it to that time tomorrow.
      val now: LocalDateTime = LocalDateTime.now(ZoneId.of("America/Los_Angeles"))
      val todayHours: Int = Math.floorMod(2 + hoursOffset, 24)
      val todayTarget: LocalDateTime = now.withHour(todayHours).withMinute(0).withSecond(0)
      val nextRun: LocalDateTime = if (now.isAfter(todayTarget)) todayTarget.plusDays(1) else todayTarget
      val durationToNextUpdate: time.Duration = java.time.Duration.between(now, nextRun)

      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          durationToNextUpdate.toMillis.millis,
          24.hours,
          self,
          AuthTokenCleanerActor.Tick
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
    case AuthTokenCleanerActor.Tick =>
      val currentTimeStart: String = dateFormatter.format(Instant.now())
      logger.info(s"Auto-scheduled removal of expired auth tokens starting at: $currentTimeStart")
      authenticationService.cleanAuthTokens.map { _ =>
        val currentEndTime: String = dateFormatter.format(Instant.now())
        logger.info(s"Removal of expired auth tokens completed at: $currentEndTime")
      }
  }
}
