package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import controllers.helper.ControllerUtils.parseIntegerList
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
    * Get list of all neighborhoods with a boolean indicating if the given user has fully audited that neighborhood.
    */
  def listNeighborhoods(regions: Option[String]) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val regionIds: List[Int] = regions.map(parseIntegerList).getOrElse(List())
        val features: List[JsObject] =
          RegionTable.getNeighborhoodsWithUserCompletionStatus(user.userId, regionIds).map { case (region, userCompleted) =>
            val properties: JsObject = Json.obj(
              "region_id" -> region.regionId,
              "region_name" -> region.name,
              "user_completed" -> userCompleted
            )
            Json.obj("type" -> "Feature", "geometry" -> region.geom.toJSON, "properties" -> properties)
        }
        val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
        Future.successful(Ok(featureCollection))
      case None =>
        // UTF-8 codes needed to pass a URL that contains parameters: ? is %3F, & is %26
        val queryParams: String = regions.map(r => s"%3Fregions=$r").getOrElse("")
        Future.successful(Redirect(s"/anonSignUp?url=/neighborhoods" + queryParams))
    }
  }
}
