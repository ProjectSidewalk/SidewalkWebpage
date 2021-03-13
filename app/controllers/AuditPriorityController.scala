package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user.User
import models.street.StreetEdgePriorityTable
import scala.concurrent.Future

/**
 * Holds the HTTP requests associated with maintaining the audit priority value for streets.
 *
 * @param env The Silhouette environment.
 */
class AuditPriorityController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.role.getOrElse("") == "Administrator" || user.role.getOrElse("") == "Owner") true else false
    case _ => false
  }

  /**
    * Recalculates street edge priority for all streets.
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
