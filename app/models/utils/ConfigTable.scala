package models.utils

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._
import scala.concurrent.ExecutionContext

case class MapParams(
    centerLat: Double,
    centerLng: Double,
    zoom: Double,
    lat1: Double,
    lng1: Double,
    lat2: Double,
    lng2: Double
)

case class Config(
    openStatus: String,
    mapathonEventLink: Option[String],
    cityMapParams: MapParams,
    tutorialStreetEdgeID: Int,
    offsetHours: Int,
    makeCrops: Boolean,
    excludedTags: String
)

class ConfigTableDef(tag: Tag) extends Table[Config](tag, "config") {
  def openStatus: Rep[String]                = column[String]("open_status")
  def mapathonEventLink: Rep[Option[String]] = column[Option[String]]("mapathon_event_link")
  def cityCenterLat: Rep[Double]             = column[Double]("city_center_lat")
  def cityCenterLng: Rep[Double]             = column[Double]("city_center_lng")
  def southwestBoundaryLat: Rep[Double]      = column[Double]("southwest_boundary_lat")
  def southwestBoundaryLng: Rep[Double]      = column[Double]("southwest_boundary_lng")
  def northeastBoundaryLat: Rep[Double]      = column[Double]("northeast_boundary_lat")
  def northeastBoundaryLng: Rep[Double]      = column[Double]("northeast_boundary_lng")
  def defaultMapZoom: Rep[Double]            = column[Double]("default_map_zoom")
  def tutorialStreetEdgeID: Rep[Int]         = column[Int]("tutorial_street_edge_id")
  def offsetHours: Rep[Int]                  = column[Int]("update_offset_hours")
  def makeCrops: Rep[Boolean]                = column[Boolean]("make_crops")
  def excludedTags: Rep[String]              = column[String]("excluded_tags")

  override def * = (
    openStatus,
    mapathonEventLink,
    (cityCenterLat, cityCenterLng, defaultMapZoom, southwestBoundaryLat, southwestBoundaryLng, northeastBoundaryLat,
      northeastBoundaryLng),
    tutorialStreetEdgeID,
    offsetHours,
    makeCrops,
    excludedTags
  ).shaped <> (
    { case (openStatus, mapathonEventLink, cityMapParams, tutorialStreetEdgeID, offsetHours, makeCrops, excludedTag) =>
      Config(openStatus, mapathonEventLink, MapParams.tupled.apply(cityMapParams), tutorialStreetEdgeID, offsetHours,
        makeCrops, excludedTag)
    },
    { c: Config =>
      def f1(i: MapParams) = MapParams.unapply(i).get
      Some(
        (c.openStatus, c.mapathonEventLink, f1(c.cityMapParams), c.tutorialStreetEdgeID, c.offsetHours, c.makeCrops,
          c.excludedTags)
      )
    }
  )
}

@ImplementedBy(classOf[ConfigTable])
trait ConfigTableRepository {}

@Singleton
class ConfigTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends ConfigTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val config = TableQuery[ConfigTableDef]

  def getCityMapParams: DBIO[MapParams] = {
    config.result.head.map(_.cityMapParams)
  }

  /**
   * Gets the map parameters from a specific schema. This allows querying data from other city schemas.
   *
   * The method uses an explicit schema reference in the SQL query to access the config table in a different schema.
   * This enables retrieving map parameters for cities other than the current one.
   *
   * @param schema The database schema to query
   * @return DBIO action that returns MapParams from the specified schema
   * @throws NoSuchElementException if no map parameters are found in the specified schema
   */
  def getCityMapParamsBySchema(schema: String): DBIO[MapParams] = {
    // SQL query with explicit schema reference using double quotes for proper PostgreSQL schema qualification.
    sql"""
      SELECT city_center_lat, city_center_lng, default_map_zoom,
             southwest_boundary_lat, southwest_boundary_lng, northeast_boundary_lat, northeast_boundary_lng
      FROM "#$schema".config
    """
      .as[(Double, Double, Double, Double, Double, Double, Double)]
      .map { rows =>
        // Extract the first row from the result set (if any).
        rows.headOption.map { row => MapParams.tupled(row) }.getOrElse {
          // Throw an exception if no results were found.
          throw new NoSuchElementException(s"No map parameters found in schema: $schema")
        }
      }
  }

  def getTutorialStreetId: DBIO[Int] = {
    config.map(_.tutorialStreetEdgeID).result.head
  }

  def getMakeCrops: DBIO[Boolean] = {
    config.map(_.makeCrops).result.head
  }

  def getMapathonEventLink: DBIO[Option[String]] = {
    config.map(_.mapathonEventLink).result.head
  }

  def getOpenStatus: DBIO[String] = {
    config.map(_.openStatus).result.head
  }

  def getOffsetHours: DBIO[Int] = {
    config.map(_.offsetHours).result.head
  }

  def getExcludedTagsString: DBIO[String] = {
    config.map(_.excludedTags).result.head
  }
}
