package controllers

import com.mohiva.play.silhouette.api.Silhouette
import models.auth.DefaultEnv

import javax.inject._
import play.api.mvc._
import play.api.libs.json.{JsObject, Json}
import service.region.RegionService
import service.utils.ConfigService
import com.vividsolutions.jts.geom.MultiPolygon
import controllers.helper.ControllerUtils.parseIntegerSeq
import play.api.i18n.{I18nSupport, MessagesApi}
//import play.api.libs.json._
import models.utils.MyPostgresDriver.api._

import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits.defaultContext

@Singleton
class RegionController @Inject()(
                                  val messagesApi: MessagesApi,
                                  val silhouette: Silhouette[DefaultEnv],
                                  regionService: RegionService
                                ) extends Controller with I18nSupport {


  /**
   * Get the city-specific parameters used to pan/zoom maps to correct location.
   */
//  def getCityMapParams() = Action.async { implicit request =>
//    val cityMapParams: Future[MapParams] = configService.getCityMapParams
//    cityMapParams.map { params =>
//      Ok(Json.obj(
//        "mapbox_api_key" -> config.getString("mapbox-api-key").get,
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
  def listNeighborhoods(regions: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val regionIds: Seq[Int] = parseIntegerSeq(regions)
        regionService.getNeighborhoodsWithUserCompletionStatus(user.userId, regionIds).map { regions =>
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
      case None =>
        // UTF-8 codes needed to pass a URL that contains parameters: ? is %3F, & is %26
//        val queryParams: String = regions.map(r => s"%3Fregions=$r").getOrElse("")
//        Future.successful(Redirect(s"/anonSignUp?url=/neighborhoods" + queryParams))
        Future.successful(Redirect(s"/anonSignUp?url=${request.uri}"))
    }
  }
}

