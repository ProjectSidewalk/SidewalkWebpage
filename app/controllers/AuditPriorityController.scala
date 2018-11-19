package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user.User
import models.street.StreetEdgePriorityTable
import play.api.Play.current
import play.api.i18n.Messages.Implicits._

import scala.concurrent.Future

import scala.concurrent.ExecutionContext.Implicits.global

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
      StreetEdgePriorityTable.recalculateStreetPriority.map { _ =>
        Ok("Successfully recalculated street priorities")
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }
}
