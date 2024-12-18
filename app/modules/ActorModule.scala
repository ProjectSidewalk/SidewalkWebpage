package modules

import com.google.inject.AbstractModule
import play.api.libs.concurrent.AkkaGuiceSupport
import actor.{ActorInitializer, RecalculateStreetPriorityActor}

class ActorModule extends AbstractModule with AkkaGuiceSupport {
  override def configure() = {
    bindActor[RecalculateStreetPriorityActor]("recalculate-street-priority-actor")
    bind(classOf[ActorInitializer]).asEagerSingleton()
  }
}