package controllers

import models.utils.MapParams

import javax.inject._
import play.api.mvc._
import play.api.{Configuration, Play}
import play.api.Play.current
import play.api.libs.json.Json
import service.utils.ConfigService

import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits.defaultContext

@Singleton
class ConfigController @Inject()(config: Configuration, configService: ConfigService) extends Controller {

  // TODO move anything here that isn't about putting things into JSON into a service.
  /**
   * Get the city-specific parameters used to pan/zoom maps to correct location.
   */
  def getCityMapParams() = Action.async { implicit request =>
    val cityMapParams: Future[MapParams] = configService.getCityMapParams
    cityMapParams.map { params =>
      Ok(Json.obj(
        "mapbox_api_key" -> config.getString("mapbox-api-key").get,
        "city_center" -> Json.obj("lat" -> params.centerLat, "lng" -> params.centerLng),
        "southwest_boundary" -> Json.obj("lat" -> params.lat1, "lng" -> params.lng1),
        "northeast_boundary" -> Json.obj("lat" -> params.lat2, "lng" -> params.lng2),
        "default_zoom" -> params.zoom
      ))
    }
  }

}

