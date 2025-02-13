package modules

import com.google.inject.AbstractModule
import play.api.libs.concurrent.PekkoGuiceSupport
import actor.{ActorInitializer, RecalculateStreetPriorityActor}

class ActorModule extends AbstractModule with PekkoGuiceSupport {
  override def configure() = {
    bindActor[RecalculateStreetPriorityActor]("recalculate-street-priority-actor")
    bind(classOf[ActorInitializer]).asEagerSingleton()
  }
}
