package models.attribute

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json._
import scala.slick.lifted.ForeignKeyQuery

case class CityMapParams(cityCenterLat: Double, cityCenterLng: Double, southwestBoundaryLat: Double,
                         southwestBoundaryLng: Double, northeastBoundaryLat: Double, northeastBoundaryLng: Double)

case class ApiAttribute(apiAttributeCenterLat: Double, apiAttributeCenterLng: Double, apiAttributeZoom: Double,
                        apiAttributeLatOne: Double, apiAttributeLngOne: Double, apiAttributeLatTwo: Double,
                        apiAttributeLngTwo: Double) {
  /**
    * Converts the data into the JSON format.
    *
    * @return
    */
  def toJSON: JsObject = {
    Json.obj(
      "center_lat" -> apiAttributeCenterLat,
      "center_lng" -> apiAttributeCenterLng,
      "zoom" -> apiAttributeZoom,
      "lat1" -> apiAttributeLatOne,
      "lng1" -> apiAttributeLngOne,
      "lat2" -> apiAttributeLatTwo,
      "lng2" -> apiAttributeLngTwo
    )
  }
}

case class ApiStreet(apiStreetCenterLat: Double, apiStreetCenterLng: Double, apiStreetZoom: Double,
                     apiStreetLatOne: Double, apiStreetLngOne: Double, apiStreetLatTwo: Double, apiStreetLngTwo: Double) {
  /**
    * Converts the data into the JSON format.
    *
    * @return
    */
  def toJSON: JsObject = {
    Json.obj(
      "center_lat" -> apiStreetCenterLat,
      "center_lng" -> apiStreetCenterLng,
      "zoom" -> apiStreetZoom,
      "lat1" -> apiStreetLatOne,
      "lng1" -> apiStreetLngOne,
      "lat2" -> apiStreetLatTwo,
      "lng2" -> apiStreetLngTwo
    )
  }
}

case class ApiRegion(apiRegionCenterLat: Double, apiRegionCenterLng: Double, apiRegionZoom: Double, apiRegionLatOne: Double,
                     apiRegionLngOne: Double, apiRegionLatTwo: Double, apiRegionLngTwo: Double) {
  /**
    * Converts the data into the JSON format.
    *
    * @return
    */
  def toJSON: JsObject = {
    Json.obj(
      "center_lat" -> apiRegionCenterLat,
      "center_lng" -> apiRegionCenterLng,
      "zoom" -> apiRegionZoom,
      "lat1" -> apiRegionLatOne,
      "lng1" -> apiRegionLngOne,
      "lat2" -> apiRegionLatTwo,
      "lng2" -> apiRegionLngTwo
    )
  }
}

case class Config(openStatus: String, mapathonEventLink: Option[String], cityMapParams: CityMapParams,
                  defaultMapZoom: Double, tutorialStreetEdgeID: Int, offsetHours: Int, excludedTags: String,
                  apiAttribute: ApiAttribute,  apiStreet: ApiStreet, apiRegion: ApiRegion)

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

  def * = (openStatus, mapathonEventLink, (cityCenterLat, cityCenterLng, southwestBoundaryLat, southwestBoundaryLng, northeastBoundaryLat, northeastBoundaryLng), defaultMapZoom, tutorialStreetEdgeID, offsetHours, excludedTags,
    (apiAttributeCenterLat, apiAttributeCenterLng, apiAttributeZoom, apiAttributeLatOne, apiAttributeLngOne, apiAttributeLatTwo, apiAttributeLngTwo), (apiStreetCenterLat, apiStreetCenterLng, apiStreetZoom, apiStreetLatOne, apiStreetLngOne, apiStreetLatTwo, apiStreetLngTwo), (apiRegionCenterLat, apiRegionCenterLng, apiRegionZoom, apiRegionLatOne, apiRegionLngOne, apiRegionLatTwo, apiRegionLngTwo)
  ).shaped <> ( {
    case (openStatus, mapathonEventLink, cityMapParams, defaultMapZoom, tutorialStreetEdgeID, offsetHours, excludedTag, apiAttribute, apiStreet, apiRegion) =>
      Config(openStatus, mapathonEventLink, CityMapParams.tupled.apply(cityMapParams), defaultMapZoom, tutorialStreetEdgeID, offsetHours, excludedTag, ApiAttribute.tupled.apply(apiAttribute), ApiStreet.tupled.apply(apiStreet), ApiRegion.tupled.apply(apiRegion))
  }, {
    c: Config =>
      def f1(i: CityMapParams) = CityMapParams.unapply(i).get
      def f2(i: ApiAttribute) = ApiAttribute.unapply(i).get
      def f3(i: ApiStreet) = ApiStreet.unapply(i).get
      def f4(i: ApiRegion) = ApiRegion.unapply(i).get
      Some((c.openStatus, c.mapathonEventLink, f1(c.cityMapParams), c.defaultMapZoom, c.tutorialStreetEdgeID, c.offsetHours, c.excludedTags, f2(c.apiAttribute), f3(c.apiStreet), f4(c.apiRegion)))
    }
  )
}

/**
 * Data access object for the config table.
 */
object ConfigTable {
  val db = play.api.db.slick.DB
  val config = TableQuery[ConfigTable]

  def getApiFields: (ApiAttribute, ApiStreet, ApiRegion) = db.withSession { implicit session =>
    (
      ApiAttribute.tupled(config.map(c => (c.apiAttributeCenterLat, c.apiAttributeCenterLng, c.apiAttributeZoom, c.apiAttributeLatOne, c.apiAttributeLngOne, c.apiAttributeLatTwo, c.apiAttributeLngTwo)).list.head),
      ApiStreet.tupled(config.map(c => (c.apiStreetCenterLat, c.apiStreetCenterLng, c.apiStreetZoom, c.apiStreetLatOne, c.apiStreetLngOne, c.apiStreetLatTwo, c.apiStreetLngTwo)).list.head),
      ApiRegion.tupled(config.map(c => (c.apiRegionCenterLat, c.apiRegionCenterLng, c.apiRegionZoom, c.apiRegionLatOne, c.apiRegionLngOne, c.apiRegionLatTwo, c.apiRegionLngTwo)).list.head)
    )
  }

//  will remove these after approval
//  def getApiAttribute: ApiAttribute = db.withSession { implicit session =>
//    ApiAttribute.tupled(config.map(c => (c.apiAttributeCenterLat, c.apiAttributeCenterLng, c.apiAttributeZoom, c.apiAttributeLatOne, c.apiAttributeLngOne, c.apiAttributeLatTwo, c.apiAttributeLngTwo)).list.head)
//  }
//
//  def getApiStreet: ApiStreet = db.withSession { implicit session =>
//    ApiStreet.tupled(config.map(c => (c.apiStreetCenterLat, c.apiStreetCenterLng, c.apiStreetZoom, c.apiStreetLatOne, c.apiStreetLngOne, c.apiStreetLatTwo, c.apiStreetLngTwo)).list.head)
//  }
//
//  def getApiRegion: ApiRegion = db.withSession { implicit session =>
//    ApiRegion.tupled(config.map(c => (c.apiRegionCenterLat, c.apiRegionCenterLng, c.apiRegionZoom, c.apiRegionLatOne, c.apiRegionLngOne, c.apiRegionLatTwo, c.apiRegionLngTwo)).list.head)
//  }

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

  def getCityLat: Double = db.withSession { implicit session =>
    config.map(_.cityCenterLat).list.head
  }

  def getCityLng: Double = db.withSession { implicit session =>
    config.map(_.cityCenterLng).list.head
  }

  def getSouthwestLat: Double = db.withSession { implicit session =>
    config.map(_.southwestBoundaryLat).list.head
  }

  def getSouthwestLng: Double = db.withSession { implicit session =>
    config.map(_.southwestBoundaryLng).list.head
  }

  def getNortheastLat: Double = db.withSession { implicit session =>
    config.map(_.northeastBoundaryLat).list.head
  }

  def getNortheastLng: Double = db.withSession { implicit session =>
    config.map(_.northeastBoundaryLng).list.head
  }

  def getDefaultMapZoom: Double = db.withSession { implicit session =>
    config.map(_.defaultMapZoom).list.head
  }
}
