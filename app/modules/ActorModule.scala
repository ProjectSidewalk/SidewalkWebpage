package modules

import com.google.inject.AbstractModule
import play.api.libs.concurrent.PekkoGuiceSupport
import actor._

class ActorModule extends AbstractModule with PekkoGuiceSupport {
  override def configure() = {
    bindActor[UserStatActor]("user-stats-actor")
    bindActor[RecalculateStreetPriorityActor]("recalculate-street-priority-actor")
    bindActor[AuthTokenCleanerActor]("auth-token-cleaner-actor")
    bindActor[ClusterLabelAttributesActor]("cluster-label-attributes-actor")
    bind(classOf[ActorInitializer]).asEagerSingleton()
  }
}
