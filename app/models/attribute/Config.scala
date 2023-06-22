package models.route

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.region.{Region, RegionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class Config(openStatus: String, mapathonEventLink: String, cityCenterLat: Double, cityCenterLng: Double, southwestBoundLat: Double,
                  southwestBoundaryLng: Double, northeastBoundaryLat: Double, northeastBoundaryLng: Double, defaultMapZoom: Double,
                  tutorialStreetEdgeID: Int, offsetHours: Int, excludedTags: String)

case class ConfigApi(apiAttributeCenterLat: Double, apiAttributeCenterLng: Double,
                     apiAttributeZoom: Double, apiAttributeLatOne: Double, apiAttributeLngOne: Double, apiAttributeLatTwo: Double,
                     apiAttributeLngTwo: Double, apiStreetCenterLat: Double, apiStreetCenterLng: Double, apiStreetZoom: Double,
                     apiStreetLatOne: Double, apiStreetLngOne: Double, apiStreetLatTwo: Double, apiStreetLngTwo: Double,
                     apiRegionCenterLat: Double, apiRegionCenterLng: Double, apiRegionZoom: Double, apiRegionLatOne: Double,
                     apiRegionLngOne: Double, apiRegionLatTwo: Double, apiRegionLngTwo: Double)

class ConfigApiTable(tag: slick.lifted.Tag) extends Table[ConfigApi](tag, Some("sidewalk"), "config_api") {
//  def openStatus: Column[String] = column[String]("open_status", O.NotNull)
//  def mapathonEventLink: Column[String] = column[String]("mapathon_event_link")
//  def cityCenterLat: Column[Double] = column[Double]("city_center_lat", O.NotNull)
//  def cityCenterLng: Column[Double] = column[Double]("city_center_lng", O.NotNull)
//  def southwestBoundaryLat: Column[Double] = column[Double]("southwest_boundary_lat", O.NotNull)
//  def southwestBoundaryLng: Column[Double] = column[Double]("southwest_boundary_lng", O.NotNull)
//  def northeastBoundaryLat: Column[Double] = column[Double]("northeast_boundary_lat", O.NotNull)
//  def northeastBoundaryLng: Column[Double] = column[Double]("northeast_boundary_lng", O.NotNull)
//  def defaultMapZoom: Column[Double] = column[Double]("default_map_zoom", O.NotNull)
//  def tutorialStreetEdgeID: Column[Int] = column[Int]("tutorial_street_edge_id", O.NotNull)
//  def offsetHours: Column[Int] = column[Int]("update_offset_hours", O.NotNull)
//  def excludedTags: Column[String] = column[String]("excluded_tags", O.NotNull)
  def apiAttributeCenterLat: Column[Double] = column[Double]("api_attribute_center_lat", O.NotNull)
  def apiAttributeCenterLng: Column[Double] = column[Double]("api_attribute_center_lng", O.NotNull)
  def apiAttributeZoom: Column[Double] = column[Double]("api_attribute_zoom", O.NotNull)
  def apiAttributeLatOne: Column[Double] = column[Double]("api_attribute_lat1", O.NotNull)
  def apiAttributeLngOne: Column[Double] = column[Double]("api_attrubute_lng1", O.NotNull)
  def apiAttributeLatTwo: Column[Double] = column[Double]("api_attribute_lat2", O.NotNull)
  def apiAttributeLngTwo: Column[Double] = column[Double]("api_attrubute_lng2", O.NotNull)
  def apiStreetCenterLat: Column[Double] = column[Double]("api_street_center_lat", O.NotNull)
  def apiStreetCenterLng: Column[Double] = column[Double]("api_street_center_lng", O.NotNull)
  def apiStreetZoom: Column[Double] = column[Double]("api_street_zoom", O.NotNull)
  def apiStreetLatOne: Column[Double] = column[Double]("api_street_lat1", O.NotNull)
  def apiStreetLngOne: Column[Double] = column[Double]("api_street_lng1", O.NotNull)
  def apiStreetLatTwo: Column[Double] = column[Double]("api_street_lat2", O.NotNull)
  def apiStreetLngTwo: Column[Double] = column[Double]("api_street_lng2", O.NotNull)
  def apiRegionCenterLat: Column[Double] = column[Double]("api_region_center_lat", O.NotNull)
  def apiRegionCenterLng: Column[Double] = column[Double]("api_region_center_lng", O.NotNull)
  def apiRegionZoom: Column[Double] = column[Double]("api_region_zoom", O.NotNull)
  def apiRegionLatOne: Column[Double] = column[Double]("api_region_lat1", O.NotNull)
  def apiRegionLngOne: Column[Double] = column[Double]("api_region_lng1", O.NotNull)
  def apiRegionLatTwo: Column[Double] = column[Double]("api_region_lat2", O.NotNull)
  def apiRegionLngTwo: Column[Double] = column[Double]("api_region_lng2", O.NotNull)

  def * = (apiAttributeCenterLat, apiAttributeCenterLng, apiAttributeZoom, apiAttributeLatOne, apiAttributeLngOne, apiAttributeLatTwo, apiAttributeLngTwo, apiStreetCenterLat, apiStreetCenterLng, apiStreetZoom, apiStreetLatOne, apiStreetLngOne, apiStreetLatTwo, apiStreetLngTwo, apiRegionCenterLat, apiRegionCenterLng, apiRegionZoom, apiRegionLatOne, apiRegionLngOne, apiRegionLatTwo, apiRegionLngTwo) <> ((ConfigApi.apply _).tupled, ConfigApi.unapply)
}

/**
 * Data access object for the config table.
 */
object ConfigTable {
  val db = play.api.db.slick.DB
}
