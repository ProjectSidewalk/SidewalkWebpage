package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.{AiService, ConfigService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object GetAiValidationsActor {
  val Name  = "get-ai-validations-actor"
  def props = Props[GetAiValidationsActor]()
  case object Tick
}

@Singleton
class GetAiValidationsActor @Inject() (aiService: AiService)(implicit
    ec: ExecutionContext,
    configService: ConfigService
) extends Actor {

  private var cancellable: Option[Cancellable] = None
  private val logger                           = Logger(this.getClass)

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
    // Try to validate up to 1000 labels that AI haven't yet been validated by AI.
    aiService.validateLabelsWithAiDaily(1000).onComplete {
      case Success(results) =>
        logger.info(s"Attempted ${results.length} AI validations, ${results.flatten.length} successful.")
        val currentEndTime: String = dateFormatter.format(Instant.now())
        logger.info(s"AI validations completed at: $currentEndTime")
      case Failure(e) => logger.error(s"Critical error when performing AI validations: ${e.getMessage}")
    }
  }
}
