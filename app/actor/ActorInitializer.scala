package actor

import javax.inject._
import play.api.inject.ApplicationLifecycle
import akka.actor.{ActorRef, ActorSystem}
import scala.concurrent.Future
import play.api.Logger

@Singleton
class ActorInitializer @Inject() (
                                   system: ActorSystem,
                                   @Named("recalculate-street-priority-actor") actor: ActorRef,
                                   lifecycle: ApplicationLifecycle
                                 ) {
  Logger.info("ActorInitializer starting up")

  lifecycle.addStopHook { () =>
    Logger.info("ActorInitializer shutting down")
    Future.successful(())
  }
}