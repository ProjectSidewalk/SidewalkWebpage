package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import models.user.{User, UserCurrentRegionTable}

import scala.concurrent.Future
import play.api.mvc._
import models.region._
import play.api.libs.json.Json
import play.api.libs.json.Json._

import play.extras.geojson
import com.vividsolutions.jts.io.{WKBReader, WKBWriter, WKTReader}
import com.vividsolutions.jts.geom.{LineString, Coordinate, CoordinateSequence, GeometryFactory, PrecisionModel}
import collection.immutable.Seq


class RegionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  def setANewRegion = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    case class RegionId(regionId:Int)
    implicit val regionIdReads: Reads[RegionId] = (JsPath \ "region_id").read[Int].map(RegionId(_))
    var submission = request.body.validate[RegionId]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        val regionId: Int = submission.regionId
        request.identity match {
          case Some(user) =>

            UserCurrentRegionTable.update(user.userId, regionId)
          case None =>
        }
        Future.successful(Ok(Json.obj(
          "region_id" -> regionId
        )))
      }
    )
  }

  /**
    * This returns a list of all the streets stored in the database
    * @return
    */
  def listNeighborhoods = UserAwareAction.async { implicit request =>
    val features: List[JsObject] = RegionTable.listNamedRegionOfType("neighborhood").map { region =>
      val coordinates: Array[Coordinate] = region.geom.getCoordinates
      val latlngs: Seq[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList  // Map it to an immutable list
    val polygon: geojson.Polygon[geojson.LatLng] = geojson.Polygon(Seq(latlngs))
      val properties = Json.obj(
        "region_id" -> region.regionId,
        "region_name" -> region.name
      )
      Json.obj("type" -> "Feature", "geometry" -> polygon, "properties" -> properties)
    }
    val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
    Future.successful(Ok(featureCollection))
  }
}
