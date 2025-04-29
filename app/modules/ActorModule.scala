package modules

import com.google.inject.AbstractModule
import play.api.libs.concurrent.PekkoGuiceSupport
import actor._

class ActorModule extends AbstractModule with PekkoGuiceSupport {
  override def configure() = {
    bindActor[RecalculateStreetPriorityActor]("recalculate-street-priority-actor")
    bindActor[ClusterLabelAttributesActor]("cluster-label-attributes-actor")
    bindActor[AuthTokenCleanerActor]("auth-token-cleaner-actor")
    bind(classOf[ActorInitializer]).asEagerSingleton()
  }
}
