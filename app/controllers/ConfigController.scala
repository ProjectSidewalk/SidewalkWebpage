package controllers

import controllers.base._
import models.utils.MapParams
import play.api.Configuration
import play.api.libs.json.Json

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class ConfigController @Inject()(cc: CustomControllerComponents,
                                 config: Configuration,
                                 configService: service.ConfigService
                                )(implicit ec: ExecutionContext) extends CustomBaseController(cc) {

  /**
   * Get the city-specific parameters used to pan/zoom maps to correct location.
   */
  def getCityMapParams() = Action.async { implicit _ =>
    val cityMapParams: Future[MapParams] = configService.getCityMapParams
    cityMapParams.map { params =>
      Ok(Json.obj(
        "mapbox_api_key" -> config.get[String]("mapbox-api-key"),
        "city_center" -> Json.obj("lat" -> params.centerLat, "lng" -> params.centerLng),
        "southwest_boundary" -> Json.obj("lat" -> params.lat1, "lng" -> params.lng1),
        "northeast_boundary" -> Json.obj("lat" -> params.lat2, "lng" -> params.lng2),
        "default_zoom" -> params.zoom
      ))
    }
  }
}
