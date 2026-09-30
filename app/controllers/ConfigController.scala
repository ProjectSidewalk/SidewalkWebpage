package controllers

import controllers.base.*
import models.auth.DefaultEnv
import models.pano.PanoSource
import models.utils.MapParams
import play.api.libs.json.Json
import play.api.mvc.AnyContent
import play.silhouette.api.actions.UserAwareRequest

import javax.inject.*
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class ConfigController @Inject() (
    cc: CustomControllerComponents,
    configService: service.ConfigService
)(using ec: ExecutionContext)
    extends CustomBaseController(cc) {

  /**
   * Get the city-specific parameters used to pan/zoom maps to correct location.
   */
  def getCityMapParams() = Action.async { _ =>
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

  /**
   * The imagery provider's access token, with its expiry. Exists for Infra3d, whose hour-long token the SDK cannot
   * renew: Infra3dViewer re-fetches it here before expiry. It is the same token every page load already carries, so
   * it needs no more protection than a page does. Other providers' keys are static and 404 here, so the route never
   * becomes a second place a key is served from.
   */
  def getImageryAccessToken() = cc.securityService.UserAwareAction { (_: UserAwareRequest[DefaultEnv, AnyContent]) =>
    configService.getImageryAccessToken.map { access =>
      if (access.source != PanoSource.Infra3d) {
        NotFound(Json.obj("error" -> s"${access.source.name} uses a static key; nothing to renew"))
      } else {
        Ok(
          Json.obj(
            "source"     -> access.source.name,
            "token"      -> access.token,
            "expires_at" -> access.expiresAt.map(_.toString)
          )
        )
      }
    }
  }
}
