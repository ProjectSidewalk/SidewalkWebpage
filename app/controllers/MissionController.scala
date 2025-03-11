package controllers

import javax.inject.{Inject, Singleton}
import play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import controllers.base._
import formats.json.MissionFormats._
import play.api.libs.json._

import scala.concurrent.ExecutionContext

@Singleton
class MissionController @Inject() (cc: CustomControllerComponents,
                                   val silhouette: Silhouette[DefaultEnv],
                                   missionService: service.MissionService,
                                  )(implicit ec: ExecutionContext) extends CustomBaseController(cc) {

  /**
    * Return the completed missions in the user's current region in a JSON array.
    */
  def getMissionsInCurrentRegion() = cc.securityService.SecuredAction { implicit request =>
    missionService.getMissionsInCurrentRegion(request.identity.userId)
      .map(missions => Ok(JsArray(missions.map(Json.toJson(_)))))
  }
}
