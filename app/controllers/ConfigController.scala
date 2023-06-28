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
import models.attribute.ConfigTable

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
    val cityStr: String = Play.configuration.getString("city-id").get
    // replace this through default map zoom - dylanb
    val cityLat: Double = ConfigTable.getCityLat
    val cityLng: Double = ConfigTable.getCityLng
    val southwestLat: Double = ConfigTable.getSouthwestLat
    val southwestLng: Double = ConfigTable.getSouthwestLng
    val northeastLat: Double = ConfigTable.getNortheastLat
    val northeastLng: Double = ConfigTable.getNortheastLng
    val defaultZoom: Double = ConfigTable.getDefaultMapZoom
    Future.successful(Ok(Json.obj(
      "mapbox_api_key" -> mapboxApiKey,
      "city_center" -> Json.obj("lat" -> cityLat, "lng" -> cityLng),
      "southwest_boundary" -> Json.obj("lat" -> southwestLat, "lng" -> southwestLng),
      "northeast_boundary" -> Json.obj("lat" -> northeastLat, "lng" -> northeastLng),
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
    val cityStr: String = Play.configuration.getString("city-id").get
    // replace ALL of this - dylanb
    val southwestLat: Double = ConfigTable.getSouthwestLat
    val southwestLng: Double = ConfigTable.getSouthwestLng
    val northeastLat: Double = ConfigTable.getNortheastLat
    val northeastLng: Double = ConfigTable.getNortheastLng

    val attributeCenterLat: Double = ConfigTable.getApiAttributeCenterLat
    val attributeCenterLng: Double = ConfigTable.getApiAttributeCenterLng
    val attributeZoom: Double = ConfigTable.getAttributeZoom
    val attributeLat1: Double = ConfigTable.getAttributeLatOne
    val attributeLng1: Double = ConfigTable.getAttributeLngOne
    val attributeLat2: Double = ConfigTable.getAttributeLatTwo
    val attributeLng2: Double = ConfigTable.getAttributeLngTwo

    val streetCenterLat: Double = ConfigTable.getStreetCenterLat
    val streetCenterLng: Double = ConfigTable.getStreetCenterLng
    val streetZoom: Double = ConfigTable.getStreetZoom
    val streetLat1: Double = ConfigTable.getStreetLatOne
    val streetLng1: Double = ConfigTable.getStreetLngOne
    val streetLat2: Double = ConfigTable.getStreetLatTwo
    val streetLng2: Double = ConfigTable.getStreetLngTwo

    val regionCenterLat: Double = ConfigTable.getRegionCenterLat
    val regionCenterLng: Double = ConfigTable.getRegionCenterLng
    val regionZoom: Double = ConfigTable.getRegionZoom
    val regionLat1: Double = ConfigTable.getRegionLatOne
    val regionLng1: Double = ConfigTable.getRegionLngOne
    val regionLat2: Double = ConfigTable.getRegionLatTwo
    val regionLng2: Double = ConfigTable.getRegionLngTwo

    Future.successful(Ok(Json.obj(
      "mapbox_api_key" -> mapboxApiKey,
      "southwest_boundary" -> Json.obj("lat" -> southwestLat, "lng" -> southwestLng),
      "northeast_boundary" -> Json.obj("lat" -> northeastLat, "lng" -> northeastLng),
      "attribute" -> Json.obj(
        "center_lat" -> attributeCenterLat,
        "center_lng" -> attributeCenterLng,
        "zoom" -> attributeZoom,
        "lat1" -> attributeLat1,
        "lng1" -> attributeLng1,
        "lat2" -> attributeLat2,
        "lng2" -> attributeLng2
      ),
      "street" -> Json.obj(
        "center_lat" -> streetCenterLat,
        "center_lng" -> streetCenterLng,
        "zoom" -> streetZoom,
        "lat1" -> streetLat1,
        "lng1" -> streetLng1,
        "lat2" -> streetLat2,
        "lng2" -> streetLng2
      ),
      "region" -> Json.obj(
        "center_lat" -> regionCenterLat,
        "center_lng" -> regionCenterLng,
        "zoom" -> regionZoom,
        "lat1" -> regionLat1,
        "lng1" -> regionLng1,
        "lat2" -> regionLat2,
        "lng2" -> regionLng2
      )
    )))
  }
}
