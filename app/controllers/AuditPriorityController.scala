package controllers

import javax.inject.{Inject, Singleton}
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.{CookieAuthenticator, SessionAuthenticator}
import controllers.helper.ControllerUtils.isAdmin
//import controllers.headers.ProvidesHeader
import models.user.SidewalkUserWithRole
import models.street.StreetEdgePriorityTable
import play.api.i18n.MessagesApi

import scala.concurrent.Future

@Singleton
class AuditPriorityController @Inject() (val messagesApi: MessagesApi, val env: Environment[SidewalkUserWithRole, CookieAuthenticator])
  extends Silhouette[SidewalkUserWithRole, CookieAuthenticator] {

  /**
    * Recalculates street edge priority for all streets.
    */
//  def recalculateStreetPriority = UserAwareAction.async { implicit request =>
//    if (isAdmin(request.identity)) {
//      StreetEdgePriorityTable.recalculateStreetPriority
//      Future.successful(Ok("Successfully recalculated street priorities"))
//    } else {
//      Future.successful(Redirect("/"))
//    }
//  }
}
