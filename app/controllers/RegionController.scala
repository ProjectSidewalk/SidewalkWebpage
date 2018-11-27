package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import models.user.{User, UserCurrentRegionTable}
//import play.api.Play.current
//import play.api.i18n.Messages.Implicits._
import play.api.i18n.{I18nSupport, MessagesApi}

import scala.concurrent.Future
import play.api.mvc._
import models.region._
import play.api.libs.json.Json
import play.api.libs.json.Json._
import play.extras.geojson
import com.vividsolutions.jts.geom.Coordinate
import play.api.Logger

import collection.immutable.Seq

import scala.concurrent.ExecutionContext.Implicits.global

class RegionController @Inject() (implicit val env: Environment[User, SessionAuthenticator], override val messagesApi: MessagesApi)
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader with I18nSupport {

  /**
    * This returns the list of difficult neighborhood ids
    * @return
    */
  def getDifficultNeighborhoods = Action.async { implicit request =>
    Future.successful(Ok(Json.obj("regionIds" -> RegionTable.difficultRegionIds)))
  }

  /**
    * This returns a list of all the neighborhoods stored in the database
    * @return
    */
  def listNeighborhoods = Action.async { implicit request =>
    RegionTable.selectNamedRegionsOfAType("neighborhood").map { regions =>
      regions.map { region =>
        val coordinates: Array[Coordinate] = region.geom.getCoordinates
        val latlngs: Seq[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList  // Map it to an immutable list
        val polygon: geojson.Polygon[geojson.LatLng] = geojson.Polygon(Seq(latlngs))
        val properties = Json.obj(
          "region_id" -> region.regionId,
          "region_name" -> region.name
        )
        Json.obj("type" -> "Feature", "geometry" -> polygon, "properties" -> properties)
      }
    }.map { features =>
      val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
      Ok(featureCollection)
    }
  }
}
