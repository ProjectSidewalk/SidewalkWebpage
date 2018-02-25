package controllers

import javax.inject.Inject

import akka.actor.Actor
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import models.user.User
import models.street.{StreetEdgePriorityParameter, StreetEdgePriorityTable}

import scala.io.Source

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
      StreetEdgePriorityTable.recalculateStreetPriority
      Future.successful(Ok("Successfully recalculated street priorities"))
    } else {
      Future.successful(Redirect("/"))
    }
  }
}
