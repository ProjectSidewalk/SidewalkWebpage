package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import models.user.{User}
import models.street.{StreetEdgePriorityTable, StreetEdgePriorityParameter}

import scala.concurrent.Future


class AuditPriorityController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  // Helper methods
  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.role.getOrElse("") == "Administrator" || user.role.getOrElse("") == "Owner") true else false
    case _ => false
  }

  /**
    * Recalculates street edge priority for all streets.
    *
    * @return
    */
  def recalculateStreetPriority = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      // Function pointer to the function that returns priority based on audit counts of good/bad users
      // The functions being pointed to should always have the signature ()=>List[StreetEdgePriorityParameter]
      // (Takes no input arguments and returns a List[StreetEdgePriorityParameter])
      val completionCountPriority = () => { StreetEdgePriorityTable.selectGoodBadUserCompletionCountPriority }

      // List of function pointers that will generate priority parameters.
      val rankParameterGeneratorList: List[() => List[StreetEdgePriorityParameter]] =
        List(completionCountPriority)
//        List(completionCountPriority1,completionCountPriority2) // how it would look with two priority param funcs

      //Final Priority for each street edge is calculated by some transformation (paramScalingFunction)
      //of the weighted sum (weights are given by the weightVector) of the priority parameters.
//      val paramScalingFunction: (Double) => Double = StreetEdgePriorityTable.logisticFunction
      val weightVector: List[Double] = List(1)
//      val weightVector: List[Double] = List(0.1,0.9) -- how it would look with two priority param funcs
      StreetEdgePriorityTable.updateAllStreetEdgePriorities(rankParameterGeneratorList, weightVector)
      Future.successful(Ok("Successfully recalculated street priorities"))
    } else {
      Future.successful(Redirect("/"))
    }
  }
}
