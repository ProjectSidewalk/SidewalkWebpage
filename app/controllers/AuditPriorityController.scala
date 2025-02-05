package controllers

import javax.inject.{Inject, Singleton}
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import models.auth.DefaultEnv
import com.mohiva.play.silhouette.impl.authenticators.{CookieAuthenticator, SessionAuthenticator}
import controllers.helper.ControllerUtils.isAdmin
import play.api.mvc.{AbstractController, ControllerComponents}
//import controllers.headers.ProvidesHeader
import models.user.SidewalkUserWithRole
import models.street.StreetEdgePriorityTable
import play.api.i18n.{I18nSupport, MessagesApi}

import scala.concurrent.Future

@Singleton
class AuditPriorityController @Inject() (
                                          cc: ControllerComponents,
                                          val silhouette: Silhouette[DefaultEnv]
                                        ) extends AbstractController(cc) with I18nSupport {

  /**
    * Recalculates street edge priority for all streets.
    */
//  def recalculateStreetPriority = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    if (isAdmin(request.identity)) {
//      StreetEdgePriorityTable.recalculateStreetPriority
//      Future.successful(Ok("Successfully recalculated street priorities"))
//    } else {
//      Future.successful(Redirect("/"))
//    }
//  }
}
