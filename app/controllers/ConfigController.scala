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
    val cityStr: String = Play.configuration.getString("city-id").get
    val cityLat: Double = Play.configuration.getDouble("city-params.city-center-lat." + cityStr).get
    val cityLng: Double = Play.configuration.getDouble("city-params.city-center-lng." + cityStr).get
    val southwestLat: Double = Play.configuration.getDouble("city-params.southwest-boundary-lat." + cityStr).get
    val southwestLng: Double = Play.configuration.getDouble("city-params.southwest-boundary-lng." + cityStr).get
    val northeastLat: Double = Play.configuration.getDouble("city-params.northeast-boundary-lat." + cityStr).get
    val northeastLng: Double = Play.configuration.getDouble("city-params.northeast-boundary-lng." + cityStr).get
    val defaultZoom: Double = Play.configuration.getDouble("city-params.default-map-zoom." + cityStr).get
    Future.successful(Ok(Json.obj(
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
    val cityStr: String = Play.configuration.getString("city-id").get
    val southwestLat: Double = Play.configuration.getDouble("city-params.southwest-boundary-lat." + cityStr).get
    val southwestLng: Double = Play.configuration.getDouble("city-params.southwest-boundary-lng." + cityStr).get
    val northeastLat: Double = Play.configuration.getDouble("city-params.northeast-boundary-lat." + cityStr).get
    val northeastLng: Double = Play.configuration.getDouble("city-params.northeast-boundary-lng." + cityStr).get

    val attributeCenterLat: Double = Play.configuration.getDouble("city-params.api-demos.attribute-center-lat." + cityStr).get
    val attributeCenterLng: Double = Play.configuration.getDouble("city-params.api-demos.attribute-center-lng." + cityStr).get
    val attributeZoom: Double = Play.configuration.getDouble("city-params.api-demos.attribute-zoom." + cityStr).get
    val attributeLat1: Double = Play.configuration.getDouble("city-params.api-demos.attribute-lat1." + cityStr).get
    val attributeLng1: Double = Play.configuration.getDouble("city-params.api-demos.attribute-lng1." + cityStr).get
    val attributeLat2: Double = Play.configuration.getDouble("city-params.api-demos.attribute-lat2." + cityStr).get
    val attributeLng2: Double = Play.configuration.getDouble("city-params.api-demos.attribute-lng2." + cityStr).get

    val streetCenterLat: Double = Play.configuration.getDouble("city-params.api-demos.street-center-lat." + cityStr).get
    val streetCenterLng: Double = Play.configuration.getDouble("city-params.api-demos.street-center-lng." + cityStr).get
    val streetZoom: Double = Play.configuration.getDouble("city-params.api-demos.street-zoom." + cityStr).get
    val streetLat1: Double = Play.configuration.getDouble("city-params.api-demos.street-lat1." + cityStr).get
    val streetLng1: Double = Play.configuration.getDouble("city-params.api-demos.street-lng1." + cityStr).get
    val streetLat2: Double = Play.configuration.getDouble("city-params.api-demos.street-lat2." + cityStr).get
    val streetLng2: Double = Play.configuration.getDouble("city-params.api-demos.street-lng2." + cityStr).get

    val regionCenterLat: Double = Play.configuration.getDouble("city-params.api-demos.region-center-lat." + cityStr).get
    val regionCenterLng: Double = Play.configuration.getDouble("city-params.api-demos.region-center-lng." + cityStr).get
    val regionZoom: Double = Play.configuration.getDouble("city-params.api-demos.region-zoom." + cityStr).get
    val regionLat1: Double = Play.configuration.getDouble("city-params.api-demos.region-lat1." + cityStr).get
    val regionLng1: Double = Play.configuration.getDouble("city-params.api-demos.region-lng1." + cityStr).get
    val regionLat2: Double = Play.configuration.getDouble("city-params.api-demos.region-lat2." + cityStr).get
    val regionLng2: Double = Play.configuration.getDouble("city-params.api-demos.region-lng2." + cityStr).get

    Future.successful(Ok(Json.obj(
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
