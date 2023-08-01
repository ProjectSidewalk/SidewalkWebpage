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
import models.attribute.{ConfigTable, ApiFields, LatLngPair}

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
    val mapboxApiKey: String = Play.configuration.getString("mapbox-api-key").get
    val cityCenterPair: (LatLngPair) = ConfigTable.getCityCords
    val (southwestPair, northeastPair): (LatLngPair, LatLngPair) = ConfigTable.getDirectionCords
    val defaultZoom: Double = ConfigTable.getDefaultMapZoom
    Future.successful(Ok(Json.obj(
      "mapbox_api_key" -> mapboxApiKey,
      "city_center" -> cityCenterPair.toJSON,
      "southwest_boundary" -> southwestPair.toJSON,
      "northeast_boundary" -> northeastPair.toJSON,
      "default_zoom" -> defaultZoom
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
    val mapboxApiKey: String = Play.configuration.getString("mapbox-api-key").get
    val (southwestPair, northeastPair): (LatLngPair, LatLngPair) = ConfigTable.getDirectionCords
    val (apiAttribute, apiStreet, apiRegion): (ApiFields, ApiFields, ApiFields) = ConfigTable.getApiFields
    Future.successful(Ok(Json.obj(
      "mapbox_api_key" -> mapboxApiKey,
      "southwest_boundary" -> southwestPair.toJSON,
      "northeast_boundary" -> northeastPair.toJSON,
      "attribute" -> apiAttribute.toJSON,
      "street" -> apiStreet.toJSON,
      "region" -> apiRegion.toJSON
    )))
  }
}
