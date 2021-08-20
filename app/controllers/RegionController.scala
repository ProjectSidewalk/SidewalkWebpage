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
import com.vividsolutions.jts.geom.Coordinate
import collection.immutable.Seq

/**
 * Holds the HTTP requests associated with managing neighorhoods.
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
          // Put polygon in geojson format, an array[array[latlng]], where the first array contains the latlngs for the
          // outer boundary of the polygon, and the remaining arrays have the latlngs for any holes in the polygon.
          val nHoles: Int = region.geom.getNumInteriorRing
          val outerRing: Seq[Array[Coordinate]] = Seq(region.geom.getExteriorRing.getCoordinates)
          val holes: Seq[Array[Coordinate]] = (0 until nHoles).map(i => region.geom.getInteriorRingN(i).getCoordinates)
          val coordinates: Seq[Array[Coordinate]] = outerRing ++ holes
          val latlngs: Seq[Seq[geojson.LatLng]] = coordinates.map { ring =>
            ring.map(coord => geojson.LatLng(coord.y, coord.x)).toList
          }
          val polygon: geojson.Polygon[geojson.LatLng] = geojson.Polygon(latlngs)

          val properties: JsObject = Json.obj(
            "region_id" -> region.regionId,
            "region_name" -> region.name,
            "user_completed" -> region.userCompleted
          )
          Json.obj("type" -> "Feature", "geometry" -> polygon, "properties" -> properties)
        }
        val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
        Future.successful(Ok(featureCollection))
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/neighborhoods"))
    }
  }
}
