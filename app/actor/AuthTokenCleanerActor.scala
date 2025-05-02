package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.ConfigService

import java.time.Instant
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationInt, DurationLong}
import scala.util.{Failure, Success}

object AuthTokenCleanerActor {
  val Name = "auth-token-cleaner-actor"
  def props = Props[AuthTokenCleanerActor]()
  case object Tick
}

@Singleton
class AuthTokenCleanerActor @Inject()(authenticationService: service.AuthenticationService)
                                     (implicit ec: ExecutionContext, configService: ConfigService) extends Actor {
  private var cancellable: Option[Cancellable] = None
  private val logger = Logger("application")

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    configService.getOffsetHours.foreach { hoursOffset =>
      // Target time is 2:00 am Pacific + offset.
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(2, 0, hoursOffset).toMillis.millis,
          24.hours,
          self,
          AuthTokenCleanerActor.Tick
        )(context.dispatcher)
      )
      logger.info("AuthTokenCleanerActor created")
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
      authenticationService.cleanAuthTokens.onComplete {
        case Success(_) =>
          val currentEndTime: String = dateFormatter.format(Instant.now())
          logger.info(s"Removal of expired auth tokens completed at: $currentEndTime")
        case Failure(e) => logger.error(s"Error removing expired auth tokens: ${e.getMessage}")
      }
  }
}
