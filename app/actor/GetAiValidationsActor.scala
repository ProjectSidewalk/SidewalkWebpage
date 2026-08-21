package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import org.apache.pekko.actor.{Actor, Cancellable}
import play.api.{Configuration, Logger}
import models.utils.JobRunTrigger
import play.api.libs.json.Json
import service.{AiService, ConfigService, JobRunService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object GetAiValidationsActor {
  val Name = "get-ai-validations-actor"
  case object Tick
}

@Singleton
class GetAiValidationsActor @Inject() (aiService: AiService, jobRunService: JobRunService)(implicit
    ec: ExecutionContext,
    configService: ConfigService,
    val config: Configuration
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
            ScheduledJobs.GetAiValidations.hour,
            ScheduledJobs.GetAiValidations.minute,
            hoursOffset
          ).toMillis.millis,
          24.hours,
          self,
          GetAiValidationsActor.Tick
        )(context.dispatcher)
      )
      logger.info("GetAiValidationsActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = { case GetAiValidationsActor.Tick =>
    val currentTimeStart: String = dateFormatter.format(Instant.now())
    logger.info(s"Auto-scheduled AI validating started at: $currentTimeStart")
    // Try to validate up to 100 labels that haven't yet been validated by AI.
    val n: Int = if (config.get[String]("environment-type") == "prod") 800 else 10
    jobRunService
      .record(GetAiValidationsActor.Name, JobRunTrigger.Scheduled)(aiService.validateLabelsWithAiDaily(n)) { results =>
        Json.obj("labels_attempted" -> results.length, "validations_returned" -> results.flatten.length)
      }
      .onComplete {
        case Success(results) =>
          logger.info(s"Attempted ${results.length} AI validations, ${results.flatten.length} successful.")
          val currentEndTime: String = dateFormatter.format(Instant.now())
          logger.info(s"AI validations completed at: $currentEndTime")
        case Failure(e) => logger.error(s"Critical error when performing AI validations: ${e.getMessage}")
      }
  }
}
