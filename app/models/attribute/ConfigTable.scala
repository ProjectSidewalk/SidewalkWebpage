package models.attribute

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json._

case class MapParams(centerLat: Double, centerLng: Double, zoom: Double, lat1: Double, lng1: Double, lat2: Double, lng2: Double) {
  def toJSON: JsObject = {
    Json.obj(
      "center_lat" -> centerLat,
      "center_lng" -> centerLng,
      "zoom" -> zoom,
      "lat1" -> lat1,
      "lng1" -> lng1,
      "lat2" -> lat2,
      "lng2" -> lng2
    )
  }
}

case class Config(openStatus: String, mapathonEventLink: Option[String], cityMapParams: MapParams,
                  tutorialStreetEdgeID: Int, offsetHours: Int, excludedTags: String, apiAttribute: MapParams,
                  apiStreet: MapParams, apiRegion: MapParams)

class ConfigTable(tag: slick.lifted.Tag) extends Table[Config](tag, Some("sidewalk"), "config") {
  def openStatus: Column[String] = column[String]("open_status", O.NotNull)
  def mapathonEventLink: Column[Option[String]] = column[Option[String]]("mapathon_event_link")
  def cityCenterLat: Column[Double] = column[Double]("city_center_lat", O.NotNull)
  def cityCenterLng: Column[Double] = column[Double]("city_center_lng", O.NotNull)
  def southwestBoundaryLat: Column[Double] = column[Double]("southwest_boundary_lat", O.NotNull)
  def southwestBoundaryLng: Column[Double] = column[Double]("southwest_boundary_lng", O.NotNull)
  def northeastBoundaryLat: Column[Double] = column[Double]("northeast_boundary_lat", O.NotNull)
  def northeastBoundaryLng: Column[Double] = column[Double]("northeast_boundary_lng", O.NotNull)
  def defaultMapZoom: Column[Double] = column[Double]("default_map_zoom", O.NotNull)
  def tutorialStreetEdgeID: Column[Int] = column[Int]("tutorial_street_edge_id", O.NotNull)
  def offsetHours: Column[Int] = column[Int]("update_offset_hours", O.NotNull)
  def excludedTags: Column[String] = column[String]("excluded_tags", O.NotNull)
  def apiAttributeCenterLat: Column[Double] = column[Double]("api_attribute_center_lat", O.NotNull)
  def apiAttributeCenterLng: Column[Double] = column[Double]("api_attribute_center_lng", O.NotNull)
  def apiAttributeZoom: Column[Double] = column[Double]("api_attribute_zoom", O.NotNull)
  def apiAttributeLatOne: Column[Double] = column[Double]("api_attribute_lat1", O.NotNull)
  def apiAttributeLngOne: Column[Double] = column[Double]("api_attribute_lng1", O.NotNull)
  def apiAttributeLatTwo: Column[Double] = column[Double]("api_attribute_lat2", O.NotNull)
  def apiAttributeLngTwo: Column[Double] = column[Double]("api_attribute_lng2", O.NotNull)
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

  def * = (openStatus, mapathonEventLink,
    (cityCenterLat, cityCenterLng, defaultMapZoom, southwestBoundaryLat, southwestBoundaryLng, northeastBoundaryLat, northeastBoundaryLng),
    tutorialStreetEdgeID, offsetHours, excludedTags,
    (apiAttributeCenterLat, apiAttributeCenterLng, apiAttributeZoom, apiAttributeLatOne, apiAttributeLngOne, apiAttributeLatTwo, apiAttributeLngTwo),
    (apiStreetCenterLat, apiStreetCenterLng, apiStreetZoom, apiStreetLatOne, apiStreetLngOne, apiStreetLatTwo, apiStreetLngTwo),
    (apiRegionCenterLat, apiRegionCenterLng, apiRegionZoom, apiRegionLatOne, apiRegionLngOne, apiRegionLatTwo, apiRegionLngTwo)
  ).shaped <> ( {
    case (openStatus, mapathonEventLink, cityMapParams, tutorialStreetEdgeID, offsetHours, excludedTag, apiAttribute, apiStreet, apiRegion) =>
      Config(openStatus, mapathonEventLink, MapParams.tupled.apply(cityMapParams), tutorialStreetEdgeID, offsetHours, excludedTag, MapParams.tupled.apply(apiAttribute), MapParams.tupled.apply(apiStreet), MapParams.tupled.apply(apiRegion))
  }, {
    c: Config =>
      def f1(i: MapParams) = MapParams.unapply(i).get
      Some((c.openStatus, c.mapathonEventLink, f1(c.cityMapParams), c.tutorialStreetEdgeID, c.offsetHours, c.excludedTags, f1(c.apiAttribute), f1(c.apiStreet), f1(c.apiRegion)))
    }
  )
}

/**
 * Data access object for the config table.
 */
object ConfigTable {
  val db = play.api.db.slick.DB
  val config = TableQuery[ConfigTable]

  def getCityMapParams: MapParams = db.withSession { implicit session =>
    config.run.head.cityMapParams
  }

  def getApiFields: (MapParams, MapParams, MapParams) = db.withSession { implicit session =>
    val c = TableQuery[ConfigTable].run.head
    (c.apiAttribute, c.apiStreet, c.apiRegion)
  }

  def getTutorialStreetId: Int = db.withSession { implicit session =>
    config.map(_.tutorialStreetEdgeID).list.head
  }

  def getMapathonEventLink: Option[String] = db.withSession { implicit session =>
    config.map(_.mapathonEventLink).list.head
  }

  def getOpenStatus: String = db.withSession { implicit session =>
    config.map(_.openStatus).list.head
  }

  def getOffsetHours: Int = db.withSession { implicit session =>
    config.map(_.offsetHours).list.head
  }

  def getExcludedTags: List[String] = db.withSession { implicit session =>
    config.map(_.excludedTags).list.head.drop(2).dropRight(2).split("\" \"").toList
  }
}
