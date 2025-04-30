package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.{ConfigService, GSVDataService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

object CheckImageExpiryActor {
  val Name = "check-image-expiry-actor"
  def props = Props[CheckImageExpiryActor]
  case object Tick
}

@Singleton
class CheckImageExpiryActor @Inject()(gsvDataService: GSVDataService)
                                     (implicit ec: ExecutionContext, configService: ConfigService) extends Actor {
  private var cancellable: Option[Cancellable] = None
  private val logger = Logger("application")

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    configService.getOffsetHours.foreach { hoursOffset =>
      // Target time is 12:15 am Pacific + offset.
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(0, 15, hoursOffset).toMillis.millis,
          24.hours,
          self,
          CheckImageExpiryActor.Tick
        )(context.dispatcher)
      )
      logger.info("CheckImageExpiryActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = {
    case CheckImageExpiryActor.Tick =>
      val currentTimeStart: String = dateFormatter.format(Instant.now())
      logger.info(s"Auto-scheduled checking image expiry started at: $currentTimeStart")
      gsvDataService.checkForGSVImagery().map { _ =>
        val currentEndTime: String = dateFormatter.format(Instant.now())
        logger.info(s"Checking image expiry completed at: $currentEndTime")
      }
  }
}
