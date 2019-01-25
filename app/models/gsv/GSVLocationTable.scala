package models.gsv

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class GSVLocation(gsvPanoramaId: String, lat: Double, lng: Double, originalLat: Double, originalLng: Double,
  region: String, country: String, description: String,
  zoomLevels: Int, streetRange: Option[Int], elevationWgs84M: Double, elevationEgm96M: Double)

class GSVLocationTable(tag: Tag) extends Table[GSVLocation](tag, Some("sidewalk"), "gsv_location") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def lat = column[Double]("lat")
  def lng = column[Double]("lng")
  def originalLat = column[Double]("original_lat")
  def originalLng = column[Double]("original_lng")
  def region = column[String]("region")
  def country = column[String]("country")
  def description = column[String]("description")
  def zoomLevels = column[Int]("zoom_levels")
  def streetRange = column[Option[Int]]("street_range")
  def elevationWgs84M = column[Double]("elevation_wgs84_m")
  def elevationEgm96M = column[Double]("elevation_egm96_m")

  def * = (gsvPanoramaId, lat, lng, originalLat, originalLng, region, country, description, zoomLevels, streetRange,
    elevationWgs84M, elevationEgm96M) <> ((GSVLocation.apply _).tupled, GSVLocation.unapply)
}

object GSVLocationTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val gsvLocations = TableQuery[GSVLocationTable]
}