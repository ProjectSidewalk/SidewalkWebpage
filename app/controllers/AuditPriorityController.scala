package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import models.user.{User, UserCurrentRegionTable}
import models.street.{StreetEdgeAssignmentCountTable, StreetEdgeIssue, StreetEdgeIssueTable, StreetEdgePriorityTable, StreetEdgePriority, StreetEdgePriorityParameter}

import scala.concurrent.Future
import play.api.mvc._
import models.region._
import play.api.libs.json.Json
import play.api.libs.json.Json._

import play.extras.geojson
import collection.immutable.Seq


class AuditPriorityController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  // Helper methods
  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.role.getOrElse("") == "Administrator" || user.role.getOrElse("") == "Owner") true else false
    case _ => false
  }

  /**
    *
    * @return
    */
  def recalculateStreetPriority = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)){
      //Example function pointer to the function that returns the completion count for each edge
      //The functions being pointed to should always have the signature ()=>List[StreetEdgePriorityParameter]
      // (Takes no input arguments and returns a List[StreetEdgePriorityParameter])
      val selectCompletionCount = ()=> {StreetEdgePriorityTable.selectCompletionCount}
      //Example list of function pointers that will generate priority parameters.
      //In this case I'm assuming I have 2 functions (but both are the same completion count functions)
      val rankParameterGeneratorList: List[()=>List[StreetEdgePriorityParameter]] = List(selectCompletionCount,selectCompletionCount)
      //Final Priority for each street edge is calculated by some transformation (paramScalingFunction)
      //of the weighted sum (weights are given by the weightVector) of the priority parameters.
      val paramScalingFunction: (Double)=>Double = StreetEdgePriorityTable.logisticFunction
      val weightVector: List[Double] = List(-0.1,-0.01)
      StreetEdgePriorityTable.updateAllStreetEdgePriorities(rankParameterGeneratorList, weightVector, paramScalingFunction)
      Future.successful(Ok("Successfully recalculated street priorities"))
    }else{
      Future.successful(Redirect("/"))
    }
  }

  def getRegionStreetPriority(regionId: Int) = UserAwareAction.async { implicit request =>
    val regionStreetPriorities: List[JsObject] = StreetEdgePriorityTable.getAllStreetEdgeInRegionPriority(regionId).map(_.toJSON)
    Future.successful(Ok(JsArray(regionStreetPriorities)))
  }

  /**
    * This returns the list of all streets with their priority
    * @return
  def getStreetPriorityList = UserAwareAction.async { implicit request =>
    Future.successful(Ok(StreetEdgePriorityTable.listAll))
  }*/
}