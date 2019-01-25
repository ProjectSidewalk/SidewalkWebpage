package controllers

import com.mohiva.play.silhouette.api.Silhouette
import models.user.User
import models.street.StreetEdgePriorityTable
//import play.api.Play.current
//import play.api.i18n.Messages.Implicits._
import play.api.i18n.{ I18nSupport, MessagesApi }
import play.api.mvc.Controller

import scala.concurrent.Future

class AuditPriorityController(silhouette: Silhouette[User], messagesApi: MessagesApi) extends Controller with I18nSupport {
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
  def recalculateStreetPriority = silhouette.UserAwareAction.async { implicit request =>
    val user = Some(request.identity.asInstanceOf[User])
    if (isAdmin(user)) {
      StreetEdgePriorityTable.recalculateStreetPriority.map { _ =>
        Ok("Successfully recalculated street priorities")
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }
}
