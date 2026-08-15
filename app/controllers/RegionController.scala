package controllers

import controllers.base._
import controllers.helper.ControllerUtils.{parseIntegerSeq, NoUserId}
import models.auth.DefaultEnv
import models.utils.MyPostgresProfile.api._
import play.api.libs.json.{JsArray, JsObject, Json}
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

  /**
   * Get audit coverage of each neighborhood.
   *
   * Public read: the landing-page choropleth, /labelMap, and the user dashboard's contribution map all load these
   * rates anonymously, so this stays ungated.
   *
   * @param regions Comma-separated region IDs to filter by.
   * @return        JSON array of `{region_id, total_distance_m, completed_distance_m, outdated_distance_m, rate,
   *                name}` objects, where `rate` is `completed_distance_m / total_distance_m`, or 1.0 for a region
   *                with no street distance. `outdated_distance_m` is the distance of streets needing re-audit
   *                (audited before, but on since-replaced imagery, #4384) -- those streets stay counted in
   *                `completed_distance_m`, so this is an annotation, not a subtraction.
   */
  def getNeighborhoodCompletionRate(regions: Option[String]) = Action.async {
    val regionIds: Seq[Int] = parseIntegerSeq(regions)

    for {
      // Ensure the region_completion cache table is populated before reading rates from it.
      _             <- regionService.initializeRegionCompletionTable
      neighborhoods <- regionService.selectAllNamedNeighborhoodCompletions(regionIds)
      outdatedDists <- regionService.getOutdatedDistanceByRegion
    } yield {
      val completionRates: Seq[JsObject] = for (neighborhood <- neighborhoods) yield {
        val completionRate: Double =
          if (neighborhood.totalDistance > 0) neighborhood.auditedDistance / neighborhood.totalDistance
          else 1.0d
        val outdatedDistanceM: Double = outdatedDists.getOrElse(neighborhood.regionId, 0.0)
        Json.obj(
          "region_id"            -> neighborhood.regionId,
          "total_distance_m"     -> neighborhood.totalDistance,
          "completed_distance_m" -> neighborhood.auditedDistance,
          "outdated_distance_m"  -> outdatedDistanceM,
          "rate"                 -> completionRate,
          "name"                 -> neighborhood.name
        )
      }
      Ok(JsArray(completionRates))
    }
  }
}
