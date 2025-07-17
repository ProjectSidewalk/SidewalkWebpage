package controllers

import controllers.base._
import models.utils.MapParams
import play.api.Logger
import play.api.libs.json.Json

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class ConfigController @Inject() (
    cc: CustomControllerComponents,
    configService: service.ConfigService
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {
  private val logger = Logger(this.getClass)

  /**
   * Get the city-specific parameters used to pan/zoom maps to correct location.
   */
  def getCityMapParams() = Action.async { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    val cityMapParams: Future[MapParams] = configService.getCityMapParams
    cityMapParams.map { params =>
      Ok(
        Json.obj(
          "city_center"        -> Json.obj("lat" -> params.centerLat, "lng" -> params.centerLng),
          "southwest_boundary" -> Json.obj("lat" -> params.lat1, "lng" -> params.lng1),
          "northeast_boundary" -> Json.obj("lat" -> params.lat2, "lng" -> params.lng2),
          "default_zoom"       -> params.zoom
        )
      )
    }
  }
}
