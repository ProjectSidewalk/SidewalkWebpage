package models.route

case class Config(openStatus: String, mapathonEventLink: String, cityCenterLat: Double, cityCenterLng: Double, southwestBoundLat: Double,
                  southwestBoundaryLng: Double, northeastBoundaryLat: Double, northeastBoundaryLng: Double, defaultMapZoom: Double,
                  tutorialStreetEdgeID: Int, offsetHours: Int, excludedTags: String, apiAttributeCenterLat: Double, apiAttributeCenterLng: Double,
                  apiAttributeZoom: Double, apiAttributeLatOne: Double, apiAttributeLngOne: Double, apiAttributeLatTwo: Double,
                  apiAttributeLngTwo: Double, apiStreetCenterLat: Double, apiStreetCenterLng: Double, apiStreetZoom: Double,
                  apiStreetLatOne: Double, apiStreetLngOne: Double, apiStreetLatTwo: Double, apiStreetLngTwo: Double,
                  apiRegionCenterLat: Double, apiRegionCenterLng: Double, apiRegionZoom: Double, apiRegionLatOne: Double,
                  apiRegionLngOne: Double, apiRegionLatTwo: Double, apRegionLngTwo: Double)

// what is a tag
class ConfigTable(tag: Tag) extends Table[Config](tag, Some("sidewalk"), "config") {
  def openStatus: Column[String] = column[String]("open_status", 0.NotNull)
  def mapathonEventLink: Column[String] = column[String]("mapathon_event_link")
  def cityCenterLat: Column[Double] = column[Double]("city_center_lat", 0.NotNull)
  def cityCenterLng: Column[Double] = column[Double]("city_center_lng", 0.NotNull)
  def southwestBoundaryLat: Column[Double] = column[Double]("southwest_boundary_lat", 0.NotNull)
  def southwestBoundaryLng: Column[Double] = column[Double]("southwest_boundary_lng", 0.NotNull)
  def northeastBoundaryLat: Column[Double] = column[Double]("northeast_boundary_lat", 0.NotNull)
  def northeastBoundaryLng: Column[Double] = column[Double]("northeast_boundary_lng", 0.NotNull)
  def defaultMapZoom: Column[Double] = column[Double]("default_map_zoom", 0.NotNull)
  def tutorialStreetEdgeID: Column[Int] = column[Int]("tutorial_street_edge_id", 0.NotNull)
  def offsetHours: Column[Int] = column[Int]("update_offset_hours", 0.NotNull)
  def excludedTags: Column[String] = column[String]("excluded_tags", 0.NotNull)
  def apiAttributeCenterLat: Column[Double] = column[Double]("api_attribute_center_lat", 0.NotNull)
  def apiAttributeCenterLng: Column[Double] = column[Double]("api_attribute_center_lng", 0.NotNull)
  def apiAttributeZoom: Column[Double] = column[Double]("api_attribute_zoom", 0.NotNull)
  def apiAttributeLatOne: Column[Double] = column[Double]("api_attribute_lat1", 0.NotNull)
  def apiAttributeLngOne: Column[Double] = column[Double]("api_attrubute_lng1", 0.NotNull)
  def apiAttributeLatTwo: Column[Double] = column[Double]("api_attribute_lat2", 0.NotNull)
  def apiAttributeLngTwo: Column[Double] = column[Double]("api_attrubute_lng2", 0.NotNull)
  def apiStreetCenterLat: Column[Double] = column[Double]("api_street_center_lat", 0.NotNull)
  def apiStreetCenterLng: Column[Double] = column[Double]("api_street_center_lng", 0.NotNull)
  def apiStreetZoom: Column[Double] = column[Double]("api_street_zoom", 0.NotNull)
  def apiStreetLatOne: Column[Double] = column[Double]("api_street_lat1", 0.NotNull)
  def apiStreetLngOne: Column[Double] = column[Double]("api_street_lng1", 0.NotNull)
  def apiStreetLatTwo: Column[Double] = column[Double]("api_street_lat2", 0.NotNull)
  def apiStreetLngTwo: Column[Double] = column[Double]("api_street_lng2", 0.NotNull)
  def apiRegionCenterLat: Column[Double] = column[Double]("api_region_center_lat", 0.NotNull)
  def apiRegionCenterLng: Column[Double] = column[Double]("api_region_center_lng", 0.NotNull)
  def apiRegionZoom: Column[Double] = column[Double]("api_region_zoom", 0.NotNull)
  def apiRegionLatOne: Column[Double] = column[Double]("api_region_lat1", 0.NotNull)
  def apiRegionLngOne: Column[Double] = column[Double]("api_region_lng1", 0.NotNull)
  def apiRegionLatTwo: Column[Double] = column[Double]("api_region_lat2", 0.NotNull)
  def apiRegionLngTwo: Column[Double] = column[Double]("api_region_lng2", 0.NotNull)

  def * = (openStatus, mapathonEventLink, cityCenterLat, cityCenterLng, southwestBoundaryLat, southwestBoundaryLng, northeastBoundaryLat, northeastBoundaryLng, defaultMapZoom, tutorialStreetEdgeID, offsetHours, excludedTags, apiAttributeCenterLat, apiAttributeCenterLng, apiAttributeZoom, apiAttributeLatOne, apiAttributeLngOne, apiAttributeLatTwo, apiAttributeLngTwo, apiStreetCenterLat, apiStreetCenterLng, apiStreetZoom, apiStreetLatOne, apiStreetLngOne, apiStreetLatTwo, apiStreetLngTwo, apiRegionCenterLat, apiRegionCenterLng, apiRegionZoom, apiRegionLatOne, apiRegionLngOne, apiRegionLatTwo, apiRegionLngTwo) <> ((Version.apply _).tupled, Version.unapply)
}

/**
 * Data access object for the config table.
 */
object RouteTable {
  val db = play.api.db.slick.DB
}
