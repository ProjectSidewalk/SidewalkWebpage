package controllers.api

import controllers.base.CustomControllerComponents
import org.apache.pekko.stream.Materializer
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.ApiService
import formats.json.ApiFormats._

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

@Singleton
class RegionApiController @Inject()(cc: CustomControllerComponents,
                                val silhouette: Silhouette[models.auth.DefaultEnv],
                                apiService: ApiService
                               )(implicit ec: ExecutionContext, mat: Materializer) extends BaseApiController(cc) {

  /**
  * Returns the region with the highest number of labels.
  * 
  * @return A JSON response with the region data or a 404 if no region is found
  */
  def getRegionWithMostLabels = silhouette.UserAwareAction.async { implicit request =>
    apiService.getRegionWithMostLabels.map {
      case Some(region) => 
        cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)
        Ok(Json.toJson(region))
      case None => 
        NotFound(Json.obj("status" -> "NOT_FOUND", "message" -> "No region found with labels"))
    }
  }
}