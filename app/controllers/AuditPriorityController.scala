package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import models.user.{User, UserCurrentRegionTable}
import models.street.{StreetEdgeAssignmentCountTable, StreetEdgeIssue, StreetEdgeIssueTable, StreetEdgePriorityTable}

import scala.concurrent.Future
import play.api.mvc._
import models.region._
import play.api.libs.json.Json
import play.api.libs.json.Json._

import play.extras.geojson
import collection.immutable.Seq


class AuditPriorityController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
    *
    * @return
    */
  def recalculateStreetPriority = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)){
      Future.successful(Redirect("/"))
    }else{
      Future.successful(Redirect("/"))
    }
  }

  /**
    * This returns the list of difficult neighborhood ids
    * @return
    */
  def getStreetPriorityList = UserAwareAction.async { implicit request =>
    Future.successful(Ok(Json.obj("streetPriorities" -> StreetEdgePriorityTable.listAll)))
  }
}