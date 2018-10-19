package services

import javax.inject._
import akka.actor._
import utils.actor.RecalculateStreetPriorityActor

@Singleton
class CalculateStreetPriority @Inject() (system: ActorSystem) {
  system.actorOf(RecalculateStreetPriorityActor.props, RecalculateStreetPriorityActor.Name)
}
