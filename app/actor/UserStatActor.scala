package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.{AdminService, ConfigService}

import java.time.{Instant, OffsetDateTime}
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

object UserStatActor {
  val Name = "user-stats-actor"
  def props = Props[UserStatActor]
  case object Tick
}

@Singleton
class UserStatActor @Inject()(adminService: AdminService)
                             (implicit ec: ExecutionContext, configService: ConfigService) extends Actor {
  private var cancellable: Option[Cancellable] = None
  private val logger = Logger("application")

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    configService.getOffsetHours.foreach { hoursOffset =>
      // Target time is 12:30 am Pacific + offset.
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(0, 30, hoursOffset).toMillis.millis,
          24.hours,
          self,
          UserStatActor.Tick
        )(context.dispatcher)
      )
      logger.info("UserStatActor created")
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
