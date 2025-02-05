package controllers

import models.utils.MapParams

import javax.inject._
import play.api.mvc._
import play.api.Configuration
import play.api.libs.json.Json
import service.utils.ConfigService

import scala.concurrent.{ExecutionContext, Future}

@Singleton
class ConfigController @Inject()(
                                  cc: ControllerComponents,
                                  config: Configuration,
                                  configService: ConfigService
                                )(implicit ec: ExecutionContext) extends AbstractController(cc) {

  // TODO move anything here that isn't about putting things into JSON into a service.
  /**
   * Get the city-specific parameters used to pan/zoom maps to correct location.
   */
  def getCityMapParams() = Action.async { implicit request =>
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

