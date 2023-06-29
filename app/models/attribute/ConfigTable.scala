package models.attribute

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class ConfigApi(apiAttributeCenterLat: Double, apiAttributeCenterLng: Double,
                     apiAttributeZoom: Double, apiAttributeLatOne: Double, apiAttributeLngOne: Double, apiAttributeLatTwo: Double,
                     apiAttributeLngTwo: Double, apiStreetCenterLat: Double, apiStreetCenterLng: Double, apiStreetZoom: Double,
                     apiStreetLatOne: Double, apiStreetLngOne: Double, apiStreetLatTwo: Double, apiStreetLngTwo: Double,
                     apiRegionCenterLat: Double, apiRegionCenterLng: Double, apiRegionZoom: Double, apiRegionLatOne: Double,
                     apiRegionLngOne: Double, apiRegionLatTwo: Double, apiRegionLngTwo: Double)

case class Config(openStatus: String, mapathonEventLink: Option[String], cityCenterLat: Double, cityCenterLng: Double, southwestBoundaryLat: Double,
                  southwestBoundaryLng: Double, northeastBoundaryLat: Double, northeastBoundaryLng: Double, defaultMapZoom: Double,
                  tutorialStreetEdgeID: Int, offsetHours: Int, excludedTags: String, databaseName: String, configApi: ConfigApi)

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
  def databaseName: Column[String] = column[String]("database_name", O.NotNull)

  def * = (openStatus, mapathonEventLink, cityCenterLat, cityCenterLng, southwestBoundaryLat, southwestBoundaryLng, northeastBoundaryLat, northeastBoundaryLng, defaultMapZoom, tutorialStreetEdgeID, offsetHours, excludedTags, databaseName, (
    apiAttributeCenterLat, apiAttributeCenterLng, apiAttributeZoom, apiAttributeLatOne, apiAttributeLngOne, apiAttributeLatTwo, apiAttributeLngTwo, apiStreetCenterLat, apiStreetCenterLng, apiStreetZoom, apiStreetLatOne, apiStreetLngOne, apiStreetLatTwo, apiStreetLngTwo, apiRegionCenterLat, apiRegionCenterLng, apiRegionZoom, apiRegionLatOne, apiRegionLngOne, apiRegionLatTwo, apiRegionLngTwo
  )
    ).shaped <> ( {
    case (openStatus, mapathonEventLink, cityCenterLat, cityCenterLng, southwestBoundaryLat, southwestBoundaryLng, northeastBoundaryLat, northeastBoundaryLng, defaultMapZoom, tutorialStreetEdgeID, offsetHours, excludedTag, databaseName, configApi) =>
      Config(openStatus, mapathonEventLink, cityCenterLat, cityCenterLng, southwestBoundaryLat, southwestBoundaryLng, northeastBoundaryLat, northeastBoundaryLng, defaultMapZoom, tutorialStreetEdgeID, offsetHours, excludedTag, databaseName, ConfigApi.tupled.apply(configApi))
  }, {
    c: Config =>
      def f(i: ConfigApi) = ConfigApi.unapply(i).get
      Some((c.openStatus, c.mapathonEventLink, c.cityCenterLng, c.cityCenterLng, c.southwestBoundaryLat, c.southwestBoundaryLng, c.northeastBoundaryLat, c.northeastBoundaryLng, c.defaultMapZoom, c.tutorialStreetEdgeID, c.offsetHours, c.excludedTags, c.databaseName, f(c.configApi)))
    }
  )
}

/**
 * Data access object for the config table.
 */
object ConfigTable {
  val db = play.api.db.slick.DB
  val config = TableQuery[ConfigTable]

  def getTutorialStreetId: Int = db.withSession { implicit session =>
    config.map(_.tutorialStreetEdgeID).list.head
  }

  def getMapathonEventLink: Option[String] = db.withSession { implicit session =>
    config.map(_.mapathonEventLink).list.head
  }

  def getOffsetHours: Int = db.withSession { implicit session =>
    config.map(_.offsetHours).list.head
  }

  def getExcludedTags: List[String] = db.withSession { implicit session =>
    config.map(_.excludedTags).list
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

  def getApiAttributeCenterLat: Double = db.withSession { implicit session =>
    config.map(_.apiAttributeCenterLat).list.head
  }

  def getApiAttributeCenterLng: Double = db.withSession { implicit session =>
    config.map(_.apiAttributeCenterLng).list.head
  }

  def getAttributeZoom: Double = db.withSession { implicit session =>
    config.map(_.apiAttributeZoom).list.head
  }

  def getAttributeLatOne: Double = db.withSession { implicit session =>
    config.map(_.apiAttributeLatOne).list.head
  }

  def getAttributeLngOne: Double = db.withSession { implicit session =>
    config.map(_.apiAttributeLngOne).list.head
  }

  def getAttributeLatTwo: Double = db.withSession { implicit session =>
    config.map(_.apiAttributeLatOne).list.head
  }

  def getAttributeLngTwo: Double = db.withSession { implicit session =>
    config.map(_.apiAttributeLngOne).list.head
  }

  def getStreetCenterLat: Double = db.withSession { implicit session =>
    config.map(_.apiStreetCenterLat).list.head
  }

  def getStreetCenterLng: Double = db.withSession { implicit session =>
    config.map(_.apiStreetCenterLng).list.head
  }

  def getStreetZoom: Double = db.withSession { implicit session =>
    config.map(_.apiStreetZoom).list.head
  }

  def getStreetLatOne: Double = db.withSession { implicit session =>
    config.map(_.apiStreetLatOne).list.head
  }

  def getStreetLngOne: Double = db.withSession { implicit session =>
    config.map(_.apiStreetLngOne).list.head
  }

  def getStreetLatTwo: Double = db.withSession { implicit session =>
    config.map(_.apiStreetLatTwo).list.head
  }

  def getStreetLngTwo: Double = db.withSession { implicit session =>
    config.map(_.apiStreetLngTwo).list.head
  }

  def getRegionCenterLat: Double = db.withSession { implicit session =>
    config.map(_.apiRegionCenterLat).list.head
  }

  def getRegionCenterLng: Double = db.withSession { implicit session =>
    config.map(_.apiRegionCenterLng).list.head
  }

  def getRegionZoom: Double = db.withSession { implicit session =>
    config.map(_.apiRegionZoom).list.head
  }

  def getRegionLatOne: Double = db.withSession { implicit session =>
    config.map(_.apiRegionLatOne).list.head
  }

  def getRegionLngOne: Double = db.withSession { implicit session =>
    config.map(_.apiRegionLngOne).list.head
  }

  def getRegionLatTwo: Double = db.withSession { implicit session =>
    config.map(_.apiRegionLatTwo).list.head
  }

  def getRegionLngTwo: Double = db.withSession { implicit session =>
    config.map(_.apiRegionLngTwo).list.head
  }

}
