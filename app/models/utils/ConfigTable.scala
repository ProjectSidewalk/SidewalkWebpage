package models.utils

//import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.DatabaseConfigProvider

import scala.concurrent.{ExecutionContext, Future}

import javax.inject._
import play.api.db.slick.HasDatabaseConfigProvider
import com.google.inject.ImplementedBy

case class MapParams(centerLat: Double, centerLng: Double, zoom: Double, lat1: Double, lng1: Double, lat2: Double, lng2: Double)

case class Config(openStatus: String, mapathonEventLink: Option[String], cityMapParams: MapParams,
                  tutorialStreetEdgeID: Int, offsetHours: Int, makeCrops: Boolean, excludedTags: String,
                  apiAttribute: MapParams, apiStreet: MapParams, apiRegion: MapParams)

class ConfigTableDef(tag: Tag) extends Table[Config](tag, "config") {
  def openStatus: Rep[String] = column[String]("open_status")
  def mapathonEventLink: Rep[Option[String]] = column[Option[String]]("mapathon_event_link")
  def cityCenterLat: Rep[Double] = column[Double]("city_center_lat")
  def cityCenterLng: Rep[Double] = column[Double]("city_center_lng")
  def southwestBoundaryLat: Rep[Double] = column[Double]("southwest_boundary_lat")
  def southwestBoundaryLng: Rep[Double] = column[Double]("southwest_boundary_lng")
  def northeastBoundaryLat: Rep[Double] = column[Double]("northeast_boundary_lat")
  def northeastBoundaryLng: Rep[Double] = column[Double]("northeast_boundary_lng")
  def defaultMapZoom: Rep[Double] = column[Double]("default_map_zoom")
  def tutorialStreetEdgeID: Rep[Int] = column[Int]("tutorial_street_edge_id")
  def offsetHours: Rep[Int] = column[Int]("update_offset_hours")
  def makeCrops: Rep[Boolean] = column[Boolean]("make_crops")
  def excludedTags: Rep[String] = column[String]("excluded_tags")
  def apiAttributeCenterLat: Rep[Double] = column[Double]("api_attribute_center_lat")
  def apiAttributeCenterLng: Rep[Double] = column[Double]("api_attribute_center_lng")
  def apiAttributeZoom: Rep[Double] = column[Double]("api_attribute_zoom")
  def apiAttributeLatOne: Rep[Double] = column[Double]("api_attribute_lat1")
  def apiAttributeLngOne: Rep[Double] = column[Double]("api_attribute_lng1")
  def apiAttributeLatTwo: Rep[Double] = column[Double]("api_attribute_lat2")
  def apiAttributeLngTwo: Rep[Double] = column[Double]("api_attribute_lng2")
  def apiStreetCenterLat: Rep[Double] = column[Double]("api_street_center_lat")
  def apiStreetCenterLng: Rep[Double] = column[Double]("api_street_center_lng")
  def apiStreetZoom: Rep[Double] = column[Double]("api_street_zoom")
  def apiStreetLatOne: Rep[Double] = column[Double]("api_street_lat1")
  def apiStreetLngOne: Rep[Double] = column[Double]("api_street_lng1")
  def apiStreetLatTwo: Rep[Double] = column[Double]("api_street_lat2")
  def apiStreetLngTwo: Rep[Double] = column[Double]("api_street_lng2")
  def apiRegionCenterLat: Rep[Double] = column[Double]("api_region_center_lat")
  def apiRegionCenterLng: Rep[Double] = column[Double]("api_region_center_lng")
  def apiRegionZoom: Rep[Double] = column[Double]("api_region_zoom")
  def apiRegionLatOne: Rep[Double] = column[Double]("api_region_lat1")
  def apiRegionLngOne: Rep[Double] = column[Double]("api_region_lng1")
  def apiRegionLatTwo: Rep[Double] = column[Double]("api_region_lat2")
  def apiRegionLngTwo: Rep[Double] = column[Double]("api_region_lng2")

  override def * = (openStatus, mapathonEventLink,
    (cityCenterLat, cityCenterLng, defaultMapZoom, southwestBoundaryLat, southwestBoundaryLng, northeastBoundaryLat, northeastBoundaryLng),
    tutorialStreetEdgeID, offsetHours, makeCrops, excludedTags,
    (apiAttributeCenterLat, apiAttributeCenterLng, apiAttributeZoom, apiAttributeLatOne, apiAttributeLngOne, apiAttributeLatTwo, apiAttributeLngTwo),
    (apiStreetCenterLat, apiStreetCenterLng, apiStreetZoom, apiStreetLatOne, apiStreetLngOne, apiStreetLatTwo, apiStreetLngTwo),
    (apiRegionCenterLat, apiRegionCenterLng, apiRegionZoom, apiRegionLatOne, apiRegionLngOne, apiRegionLatTwo, apiRegionLngTwo)
  ).shaped <> ( {
    case (openStatus, mapathonEventLink, cityMapParams, tutorialStreetEdgeID, offsetHours, makeCrops, excludedTag, apiAttribute, apiStreet, apiRegion) =>
      Config(openStatus, mapathonEventLink, MapParams.tupled.apply(cityMapParams), tutorialStreetEdgeID, offsetHours, makeCrops, excludedTag, MapParams.tupled.apply(apiAttribute), MapParams.tupled.apply(apiStreet), MapParams.tupled.apply(apiRegion))
  }, {
    c: Config =>
      def f1(i: MapParams) = MapParams.unapply(i).get
      Some((c.openStatus, c.mapathonEventLink, f1(c.cityMapParams), c.tutorialStreetEdgeID, c.offsetHours, c.makeCrops, c.excludedTags, f1(c.apiAttribute), f1(c.apiStreet), f1(c.apiRegion)))
  }
  )
}

@ImplementedBy(classOf[ConfigTable])
trait ConfigTableRepository {
  def getCityMapParams: Future[MapParams]
  def getApiFields: Future[(MapParams, MapParams, MapParams)]
  def getTutorialStreetId: Future[Int]
  def getMakeCrops: Future[Boolean]
  def getMapathonEventLink: Future[Option[String]]
  def getOpenStatus: Future[String]
  def getOffsetHours: Future[Int]
}

@Singleton
class ConfigTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
  extends ConfigTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  val config = TableQuery[ConfigTableDef]

  // TODO consider caching all this stuff?
  def getCityMapParams: Future[MapParams] = {
    db.run(config.result.head).map(_.cityMapParams)
  }

  def getApiFields: Future[(MapParams, MapParams, MapParams)] = {
    db.run(config.result.head).map(c => (c.apiAttribute, c.apiStreet, c.apiRegion))
  }

  def getTutorialStreetId: Future[Int] = {
    db.run(config.map(_.tutorialStreetEdgeID).result.head)
  }

  def getMakeCrops: Future[Boolean] = {
    db.run(config.map(_.makeCrops).result.head)
  }

  def getMapathonEventLink: Future[Option[String]] = {
    db.run(config.map(_.mapathonEventLink).result.head)
  }

  def getOpenStatus: Future[String] = {
    db.run(config.map(_.openStatus).result.head)
  }

  def getOffsetHours: Future[Int] = {
    db.run(config.map(_.offsetHours).result.head)
  }

  def getExcludedTagsString: DBIO[String] = {
    config.map(_.excludedTags).result.head
  }
}
