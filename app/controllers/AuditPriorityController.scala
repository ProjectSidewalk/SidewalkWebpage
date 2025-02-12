package controllers

import javax.inject.{Inject, Singleton}
import play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import controllers.helper.ControllerUtils.isAdmin
import controllers.base._
import models.user.SidewalkUserWithRole
import models.street.StreetEdgePriorityTable

import scala.concurrent.Future

@Singleton
class AuditPriorityController @Inject() (
                                          cc: CustomControllerComponents,
                                          val silhouette: Silhouette[DefaultEnv]
                                        ) extends CustomBaseController(cc) {

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
