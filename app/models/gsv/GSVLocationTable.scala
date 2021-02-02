package models.gsv

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class GSVLocation(gsvPanoramaId: String, lat: Double, lng: Double, originalLat: Double, originalLng: Double,
                       region: String, country: String, description: String,
                       zoomLevels: Int, streetRange: Option[Int], elevationWgs84M: Double, elevationEgm96M: Double)

class GSVLocationTable(tag: Tag) extends Table[GSVLocation](tag, Some("sidewalk"), "gsv_location") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def lat = column[Double]("lat", O.NotNull)
  def lng = column[Double]("lng", O.NotNull)
  def originalLat = column[Double]("original_lat", O.NotNull)
  def originalLng = column[Double]("original_lng", O.NotNull)
  def region = column[String]("region", O.NotNull)
  def country = column[String]("country", O.NotNull)
  def description = column[String]("description", O.NotNull)
  def zoomLevels = column[Int]("zoom_levels", O.NotNull)
  def streetRange = column[Option[Int]]("street_range", O.Nullable)
  def elevationWgs84M = column[Double]("elevation_wgs84_m", O.NotNull)
  def elevationEgm96M = column[Double]("elevation_egm96_m", O.NotNull)

  def * = (gsvPanoramaId, lat, lng, originalLat, originalLng, region, country, description, zoomLevels, streetRange,
    elevationWgs84M, elevationEgm96M) <> ((GSVLocation.apply _).tupled, GSVLocation.unapply)
}

object GSVLocationTable {
  val db = play.api.db.slick.DB
  val gsvLocations = TableQuery[GSVLocationTable]
}
