package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import org.apache.pekko.actor.{Actor, Cancellable}
import play.api.Logger
import models.utils.JobRunTrigger
import play.api.libs.json.{JsObject, Json}
import service.{AdminService, ConfigService, JobRunService}

import java.time.{Instant, OffsetDateTime}
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object UserStatActor {
  val Name = "user-stats-actor"
  case object Tick

  /**
   * The counts as they are stored against a `background_job_run` row.
   *
   * Defined here rather than at each call site so the nightly recompute and the admin hand-trigger can't record the
   * same job under two different shapes.
   *
   * @param usersUpdated Rows written to `user_stat`.
   * @return The run's `details` object.
   */
  def runDetails(usersUpdated: Int): JsObject = Json.obj("users_updated" -> usersUpdated)
}

@Singleton
class UserStatActor @Inject() (adminService: AdminService, jobRunService: JobRunService)(implicit
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
            ScheduledJobs.UserStats.hour,
            ScheduledJobs.UserStats.minute,
            hoursOffset
          ).toMillis.millis,
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

  def receive: Receive = { case UserStatActor.Tick =>
    val currentTimeStart: String = dateFormatter.format(Instant.now())
    logger.info(s"Auto-scheduled computation of user stats starting at: $currentTimeStart")
    // Update stats for anyone who audited in past 36 hours.
    jobRunService
      .record(UserStatActor.Name, JobRunTrigger.Scheduled)(
        adminService.updateUserStatTable(OffsetDateTime.now().minusHours(36))
      )(UserStatActor.runDetails)
      .onComplete {
        case Success(nUsersUpdated) =>
          val currentEndTime: String = dateFormatter.format(Instant.now())
          logger.info(s"User stats updated for $nUsersUpdated users!")
          logger.info(s"Updating user stats completed at: $currentEndTime")
        case Failure(e) => logger.error(s"Error updating user stats: ${e.getMessage}")
      }
  }
}
