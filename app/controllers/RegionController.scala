package controllers

import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import com.mohiva.play.silhouette.api.{Silhouette, SilhouetteProvider}
import models.auth.DefaultEnv

import javax.inject._
import play.api.mvc._
import play.api.libs.json.{JsObject, Json}
import service.region.RegionService
import service.utils.ConfigService
import com.vividsolutions.jts.geom.MultiPolygon
import controllers.helper.ControllerUtils.parseIntegerSeq
import play.api.i18n.{I18nSupport, MessagesApi}
import services.CustomSecurityService
//import play.api.libs.json._
import models.utils.MyPostgresProfile.api._

import scala.concurrent.{ExecutionContext, Future}

@Singleton
class RegionController @Inject()(
                                  cc: ControllerComponents,
                                  val silhouette: Silhouette[DefaultEnv],
                                  securityService: CustomSecurityService,
                                  regionService: RegionService
                                )(implicit ec: ExecutionContext) extends AbstractController(cc) with I18nSupport {


  /**
   * Get the city-specific parameters used to pan/zoom maps to correct location.
   */
//  def getCityMapParams() = Action.async { implicit request =>
//    val cityMapParams: Future[MapParams] = configService.getCityMapParams
//    cityMapParams.map { params =>
//      Ok(Json.obj(
//        "mapbox_api_key" -> config.get[String]("mapbox-api-key"),
//        "city_center" -> Json.obj("lat" -> params.centerLat, "lng" -> params.centerLng),
//        "southwest_boundary" -> Json.obj("lat" -> params.lat1, "lng" -> params.lng1),
//        "northeast_boundary" -> Json.obj("lat" -> params.lat2, "lng" -> params.lng2),
//        "default_zoom" -> params.zoom
//      ))
//    }
//  }

  /**
   * Get list of all neighborhoods with a boolean indicating if the given user has fully audited that neighborhood.
   */
  def listNeighborhoods(regions: Option[String]) = securityService.SecuredAction { implicit request: SecuredRequest[DefaultEnv, AnyContent] =>
    val regionIds: Seq[Int] = parseIntegerSeq(regions)
    regionService.getNeighborhoodsWithUserCompletionStatus(request.identity.userId, regionIds).map { regions =>
      val features: Seq[JsObject] = regions.map { case (region, userCompleted) =>
        val properties: JsObject = Json.obj(
          "region_id" -> region.regionId,
          "region_name" -> region.name,
          "user_completed" -> userCompleted
        )
        Json.obj("type" -> "Feature", "geometry" -> region.geom, "properties" -> properties)
      }
      val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
      Ok(featureCollection)
    }
  }
}
