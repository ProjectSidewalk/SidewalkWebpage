package controllers

import controllers.base._
import controllers.helper.ControllerUtils.{parseIntegerSeq, NoUserId}
import models.auth.DefaultEnv
import models.utils.MyPostgresProfile.api._
import play.api.libs.json.{JsObject, Json}
import play.api.mvc._
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.UserAwareRequest
import service.RegionService

import javax.inject._
import scala.concurrent.ExecutionContext

@Singleton
class RegionController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    regionService: RegionService
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {

  /**
   * Get list of all neighborhoods with a boolean indicating if the given user has fully audited that neighborhood.
   *
   * User-aware (#4643): the landing page's choropleth calls this on a page that renders for cookie-less visitors. With
   * no identity we query with an id that matches no audit tasks, so every neighborhood reads as not-completed — the
   * same result a brand-new anonymous account would get (mirrors LabelController.getLabelData).
   */
  def listNeighborhoods(regions: Option[String]) = cc.securityService.UserAwareAction {
    implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
      val regionIds: Seq[Int] = parseIntegerSeq(regions)
      val userId: String      = request.identity.map(_.userId).getOrElse(NoUserId)
      regionService.getNeighborhoodsWithUserCompletionStatus(userId, regionIds).map { regions =>
        val features: Seq[JsObject] = regions.map { case (region, userCompleted) =>
          val properties: JsObject = Json.obj(
            "region_id"      -> region.regionId,
            "region_name"    -> region.name,
            "user_completed" -> userCompleted
          )
          Json.obj("type" -> "Feature", "geometry" -> region.geom, "properties" -> properties)
        }
        val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
        Ok(featureCollection)
      }
  }
}
