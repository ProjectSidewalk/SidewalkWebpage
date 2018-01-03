package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import models.user.{User, UserCurrentRegionTable}
import models.street.{StreetEdgeAssignmentCountTable, StreetEdgeIssue, StreetEdgeIssueTable, StreetEdgePriorityTable, StreetEdgePriorityParameter}

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
      val selectCompletionCount = ()=> {StreetEdgePriorityTable.selectCompletionCount}
      val rankParameterGeneratorList: List[()=>List[StreetEdgePriorityParameter]] = List(selectCompletionCount,selectCompletionCount)
      val paramScalingFunction: (Double)=>Double = StreetEdgePriorityTable.logisticFunction
      val weightVector: List[Double] = List(-0.1,-0.01)
      StreetEdgePriorityTable.updateAllStreetEdgePriorities(rankParameterGeneratorList, weightVector, paramScalingFunction)
      Future.successful(Ok("Succesfully recalculated street priorities"))
    }else{
      Future.successful(Redirect("/"))
    }
  }

  /**
    * This returns the list of all streets with their priority
    * @return
  def getStreetPriorityList = UserAwareAction.async { implicit request =>
    Future.successful(Ok(StreetEdgePriorityTable.listAll))
  }*/
}