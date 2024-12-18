package controllers

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticator
import models.utils.MapParams

import javax.inject._
import play.api.mvc._
import play.api.Play
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}
import service.region.RegionService
import service.utils.ConfigService
import com.vividsolutions.jts.geom.MultiPolygon
import controllers.helper.ControllerUtils.parseIntegerList
import models.user.SidewalkUserWithRole
import play.api.i18n.MessagesApi
//import play.api.libs.json._
import models.utils.MyPostgresDriver.api._

import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits.defaultContext
import scala.util.Try

@Singleton
class RegionController @Inject()(
                                  val messagesApi: MessagesApi,
                                  val env: Environment[SidewalkUserWithRole, CookieAuthenticator],
                                  regionService: RegionService
                                ) extends Silhouette[SidewalkUserWithRole, CookieAuthenticator] {


  /**
   * Get the city-specific parameters used to pan/zoom maps to correct location.
   */
//  def getCityMapParams() = Action.async { implicit request =>
//    val cityMapParams: Future[MapParams] = configService.getCityMapParams
//    cityMapParams.map { params =>
//      Ok(Json.obj(
//        "mapbox_api_key" -> Play.configuration.getString("mapbox-api-key").get,
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
  def listNeighborhoods(regions: Option[String]) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val regionIds: List[Int] = regions.map(parseIntegerList).getOrElse(List())
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

