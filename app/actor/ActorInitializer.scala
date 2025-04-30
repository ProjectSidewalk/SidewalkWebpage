package actor

import org.apache.pekko.actor.{ActorRef, ActorSystem}
import play.api.Logger
import play.api.inject.ApplicationLifecycle

import javax.inject._
import scala.concurrent.Future

@Singleton
class ActorInitializer @Inject() (system: ActorSystem,
                                  @Named("recalculate-street-priority-actor") actor: ActorRef,
                                  lifecycle: ApplicationLifecycle) {
  private val logger = Logger("application")

  logger.info("ActorInitializer starting up")

  lifecycle.addStopHook { () =>
    logger.info("ActorInitializer shutting down")
    Future.successful(())
  }
}
