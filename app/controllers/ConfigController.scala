package controllers

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import javax.inject.Inject
import models.user.User
import play.api.Play
import play.api.Play.current
import play.api.mvc.{Action, BodyParsers}
import play.api.libs.json._

import scala.concurrent.Future

class ConfigController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  def getCityMapParams() = Action.async { implicit request =>
    val cityStr: String = Play.configuration.getString("city-id").get
    val cityLat: Double = Play.configuration.getDouble("city-params.city-center-lat." + cityStr).get
    val cityLng: Double = Play.configuration.getDouble("city-params.city-center-lng." + cityStr).get
    val southwestLat: Double = Play.configuration.getDouble("city-params.southwest-boundary-lat." + cityStr).get
    val southwestLng: Double = Play.configuration.getDouble("city-params.southwest-boundary-lng." + cityStr).get
    val northeastLat: Double = Play.configuration.getDouble("city-params.northeast-boundary-lat." + cityStr).get
    val northeastLng: Double = Play.configuration.getDouble("city-params.northeast-boundary-lng." + cityStr).get
    val defaultZoom: Int = Play.configuration.getInt("city-params.default-map-zoom." + cityStr).get
    Future.successful(Ok(Json.obj(
      "city_center" -> Json.obj("lat" -> cityLat, "lng" -> cityLng),
      "southwest_boundary" -> Json.obj("lat" -> southwestLat, "lng" -> southwestLng),
      "northeast_boundary" -> Json.obj("lat" -> northeastLat, "lng" -> northeastLng),
      "default_zoom" -> defaultZoom
    )))
  }
}
