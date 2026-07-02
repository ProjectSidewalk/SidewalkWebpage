package controllers

import controllers.base._
import controllers.helper.ControllerUtils.parseIntegerSeq
import models.auth.DefaultEnv
import models.utils.MyPostgresProfile.api._
import play.api.libs.json.{JsObject, Json}
import play.silhouette.api.Silhouette
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
   */
  def listNeighborhoods(regions: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    // Public read (#456): the share landing renders LabelMap anonymously. `user_completed` falls back to false for
    // every region when there's no signed-in identity (the empty userId matches no completions).
    val regionIds: Seq[Int] = parseIntegerSeq(regions)
    val userId: String      = request.identity.map(_.userId).getOrElse("")
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
