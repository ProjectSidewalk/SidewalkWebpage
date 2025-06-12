package actor

import play.api.Logger
import play.api.inject.ApplicationLifecycle

import javax.inject._
import scala.concurrent.Future

@Singleton
class ActorInitializer @Inject() (lifecycle: ApplicationLifecycle) {
  private val logger = Logger(this.getClass)
  logger.info("ActorInitializer starting up")

  lifecycle.addStopHook { () =>
    logger.info("ActorInitializer shutting down")
    Future.successful(())
  }
}
