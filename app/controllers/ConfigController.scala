package controllers

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import javax.inject.Inject
import models.user.User
import play.api.Play
import play.api.Play.current
import play.api.mvc.Action
import play.api.libs.json._
import scala.concurrent.Future
import models.attribute.{ConfigTable, MapParams}

/**
 * Holds the HTTP requests associated with getting data from the parameters in our config files.
 *
 * @param env The Silhouette environment.
 */
class ConfigController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Get the city-specific parameters used to pan/zoom maps to correct location.
   */
  def getCityMapParams() = Action.async { implicit request =>
    val cityMapParams: MapParams = ConfigTable.getCityMapParams
    Future.successful(Ok(Json.obj(
      "mapbox_api_key" -> Play.configuration.getString("mapbox-api-key").get,
      "city_center" -> Json.obj("lat" -> cityMapParams.centerLat, "lng" -> cityMapParams.centerLng),
      "southwest_boundary" -> Json.obj("lat" -> cityMapParams.lat1, "lng" -> cityMapParams.lng1),
      "northeast_boundary" -> Json.obj("lat" -> cityMapParams.lat2, "lng" -> cityMapParams.lng2),
      "default_zoom" -> cityMapParams.zoom
    )))
  }

  /**
   * Get the short version of the current city name.
   */
  def getCityShortNameParam() = Action.async { implicit request =>
    val cityStr: String = Play.configuration.getString("city-id").get
    val cityShortName: String = Play.configuration.getString("city-params.city-short-name." + cityStr).get
    Future.successful(Ok(Json.obj("city_short_name" -> cityShortName)))
  }

  /**
   * Get all city-specific parameters needed for the API page demos.
   */
  def getCityAPIDemoParams() = Action.async { implicit request =>
    val cityMapParams: MapParams = ConfigTable.getCityMapParams
    val (apiAttribute, apiStreet, apiRegion): (MapParams, MapParams, MapParams) = ConfigTable.getApiFields
    Future.successful(Ok(Json.obj(
      "mapbox_api_key" -> Play.configuration.getString("mapbox-api-key").get,
      "southwest_boundary" -> Json.obj("lat" -> cityMapParams.lat1, "lng" -> cityMapParams.lng1),
      "northeast_boundary" -> Json.obj("lat" -> cityMapParams.lat2, "lng" -> cityMapParams.lng2),
      "attribute" -> apiAttribute.toJSON,
      "street" -> apiStreet.toJSON,
      "region" -> apiRegion.toJSON
    )))
  }
}
