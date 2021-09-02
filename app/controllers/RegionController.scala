package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import models.user.User
import scala.concurrent.Future
import play.api.mvc._
import models.region._
import play.api.libs.json.Json
import play.api.libs.json.Json._
import play.extras.geojson
import models.region.RegionTable.MultiPolygonUtils

/**
 * Holds the HTTP requests associated with managing neighborhoods.
 *
 * @param env The Silhouette environment.
 */
class RegionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
    * This returns the list of difficult neighborhood ids.
    */
  def getDifficultNeighborhoods = Action.async { implicit request =>
    Future.successful(Ok(Json.obj("regionIds" -> RegionTable.difficultRegionIds)))
  }

  /**
    * Get list of all neighborhoods with a boolean indicating if the given user has fully audited that neighborhood.
    */
  def listNeighborhoods = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val features: List[JsObject] = RegionTable.getNeighborhoodsWithUserCompletionStatus(user.userId).map { region =>
          val properties: JsObject = Json.obj(
            "region_id" -> region.regionId,
            "region_name" -> region.name,
            "user_completed" -> region.userCompleted
          )
          Json.obj("type" -> "Feature", "geometry" -> region.geom.toJSON, "properties" -> properties)
        }
        val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
        Future.successful(Ok(featureCollection))
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/neighborhoods"))
    }
  }
}
