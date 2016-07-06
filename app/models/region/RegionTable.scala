package models.region

import java.util.UUID

import com.vividsolutions.jts.geom.Polygon
import math._
import models.street.StreetEdgeAssignmentCountTable
import models.user.UserCurrentRegionTable
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.slick.lifted.ForeignKeyQuery

case class Region(regionId: Int, regionTypeId: Int, dataSource: String, description: String, geom: Polygon, deleted: Boolean)
case class NamedRegion(regionId: Int, name: Option[String], geom: Polygon)

class RegionTable(tag: Tag) extends Table[Region](tag, Some("sidewalk"), "region") {
  def regionId = column[Int]("region_id", O.PrimaryKey, O.AutoInc)
  def regionTypeId = column[Int]("region_type_id", O.NotNull)
  def dataSource = column[String]("data_source", O.Nullable)
  def description = column[String]("description", O.Nullable)
  def geom = column[Polygon]("geom")
  def deleted = column[Boolean]("deleted")

  def * = (regionId, regionTypeId, dataSource, description, geom, deleted) <> ((Region.apply _).tupled, Region.unapply)

  def regionType: ForeignKeyQuery[RegionTypeTable, RegionType] =
    foreignKey("region_region_type_id_fkey", regionTypeId, TableQuery[RegionTypeTable])(_.regionTypeId)
}

/**
 * Data access object for the sidewalk_edge table
 */
object RegionTable {
  import MyPostgresDriver.plainImplicits._

  implicit val regionConverter = GetResult[Region](r => {
    Region(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextGeometry[Polygon], r.nextBoolean)
  })

  implicit val namedRegionConverter = GetResult[NamedRegion](r => {
    NamedRegion(r.nextInt, r.nextStringOption, r.nextGeometry[Polygon])
  })

  case class StreetCompletion(regionId: Int, regionName: String, streetEdgeId: Int, completionCount: Int, distance: Double)
  implicit val streetCompletionConverter = GetResult[StreetCompletion](r => {
    StreetCompletion(r.nextInt, r.nextString, r.nextInt, r.nextInt, r.nextDouble)
  })

  val db = play.api.db.slick.DB
  val regions = TableQuery[RegionTable]
  val regionTypes = TableQuery[RegionTypeTable]
  val regionProperties = TableQuery[RegionPropertyTable]
  val streetEdgeAssignmentCounts = TableQuery[StreetEdgeAssignmentCountTable]
  val userCurrentRegions = TableQuery[UserCurrentRegionTable]

  val regionsWithoutDeleted = regions.filter(_.deleted === false)
  val neighborhoods = regionsWithoutDeleted.filter(_.regionTypeId === 2)

  // Create a round robin neighborhood supplier to be used in getRegion.
  // http://stackoverflow.com/questions/19771992/is-there-a-round-robin-circular-queue-avaliable-in-scala-collections
  // http://stackoverflow.com/questions/7619642/consume-items-from-a-scala-iterator
  val neighborhoodRoundRobin = db.withSession { implicit session =>
    val neighborhoods = regionsWithoutDeleted.filter(_.regionTypeId === 2).list
    Iterator.continually(neighborhoods).flatten
  }

  val namedRegionRoundRobin = db.withSession { implicit session =>
    val neighborhoods = regionsWithoutDeleted.filter(_.regionTypeId === 2)
    val namedRegions = for {
      (_neighborhoods, _regionProperties) <- neighborhoods.leftJoin(regionProperties).on(_.regionId === _.regionId)
      if _regionProperties.key === "Neighborhood Name"
    } yield (_neighborhoods.regionId, _regionProperties.value.?, _neighborhoods.geom)

    val namedRegionsList: List[NamedRegion] = namedRegions.list.map(x => NamedRegion.tupled(x))
    val namedRegionMap: Map[Int, NamedRegion] = namedRegionsList.map(nr => nr.regionId -> nr).toMap

    // Sort the NamedRegions based on their completion rates
    val completionRates = StreetEdgeAssignmentCountTable.computeNeighborhoodComplationRate(1).sortWith(_.rate < _.rate)
    val sortedRegionIds = completionRates.map(_.regionId)
    val sortedNamedRegionList: List[NamedRegion] = for (regionId <- sortedRegionIds) yield namedRegionMap(regionId)

    Iterator.continually(sortedNamedRegionList).flatten
  }

  /**
   * Returns a list of all the neighborhood regions
    *
    * @return A list of Region objects.
   */
  def selectAllNeighborhoods: List[Region] = db.withSession { implicit session =>
    regionsWithoutDeleted.filter(_.regionTypeId === 2).list
  }

  /**
    * Returns a list of all neighborhoods with names
    * @return
    */
  def selectAllNamedNeighborhoods: List[NamedRegion] = db.withSession { implicit session =>
    val namedRegions = for {
      (_neighborhoods, _regionProperties) <- neighborhoods.leftJoin(regionProperties).on(_.regionId === _.regionId)
      if _regionProperties.key === "Neighborhood Name"
    } yield (_neighborhoods.regionId, _regionProperties.value.?, _neighborhoods.geom)

    namedRegions.list.map(x => NamedRegion.tupled(x))
  }

  /**
    * Get a Region in a round-robin fashion.
    *
    * @return
    */
  def selectARegionRoundRobin: Option[Region] = db.withSession { implicit session =>
    Some(neighborhoodRoundRobin.next)
  }

  /**
    * Get a Named Region in a round-robin fashion
    *
    * @return
    */
  def selectANamedRegionRoundRobin: Option[NamedRegion] = db.withSession { implicit session =>
    Some(namedRegionRoundRobin.next)
  }

  /**
    * Get the region specified by the region id
    *
    * @param regionId region id
    * @return
    */
  def selectANeighborhood(regionId: Int): Option[Region] = db.withSession { implicit session =>
    try {
      val l = neighborhoods.filter(_.regionId === regionId).list
      l.headOption
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None  // Shouldn't reach here
    }
  }

  /**
    * Get the region specified by the region id
    *
    * @param regionId region id
    * @return
    */
  def selectANamedRegion(regionId: Int): Option[NamedRegion] = db.withSession { implicit session =>
    try {
      val filteredNeighborhoods = neighborhoods.filter(_.regionId === regionId)
      val _regions = for {
        (_neighborhoods, _properties) <- filteredNeighborhoods.leftJoin(regionProperties).on(_.regionId === _.regionId)
        if _properties.key === "Neighborhood Name"
      } yield (_neighborhoods.regionId, _properties.value.?, _neighborhoods.geom)
      val namedRegionsList = _regions.list.map(x => NamedRegion.tupled(x))
      namedRegionsList.headOption
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None  // Shouldn't reach here
    }
  }

  /**
    * Get the neighborhood that is currently assigned to the user.
    *
    * @param userId user id
    * @return
    */
  def selectTheCurrentRegion(userId: UUID): Option[Region] = db.withSession { implicit session =>
    try {
      val currentRegions = for {
        (r, ucr) <- regionsWithoutDeleted.filter(_.regionTypeId === 2).innerJoin(userCurrentRegions).on(_.regionId === _.regionId)
        if ucr.userId === userId.toString
      } yield r
      Some(currentRegions.list.head)
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None  // Shouldn't reach here
    }
  }

  /**
    * Get the neighborhood that is currently assigned to the user.
    *
    * @param userId user id
    * @return
    */
  def selectTheCurrentNamedRegion(userId: UUID): Option[NamedRegion] = db.withSession { implicit session =>
    try {
      val currentRegions = for {
        (r, ucr) <- regionsWithoutDeleted.filter(_.regionTypeId === 2).innerJoin(userCurrentRegions).on(_.regionId === _.regionId)
        if ucr.userId === userId.toString
      } yield r

      val _regions = for {
        (_regions, _properties) <- currentRegions.leftJoin(regionProperties).on(_.regionId === _.regionId)
        if _properties.key === "Neighborhood Name"
      } yield (_regions.regionId, _properties.value.?, _regions.geom)
      Some(_regions.list.map(x => NamedRegion.tupled(x)).head)
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None  // Shouldn't reach here
    }
  }

  def selectNamedRegionsIntersectingAStreet(streetEdgeId: Int): List[NamedRegion] = db.withSession { implicit session =>
    val selectRegionQuery = Q.query[Int, NamedRegion](
      """SELECT region.region_id, region_property.value, region.geom FROM sidewalk.region
        |INNER JOIN sidewalk.street_edge
        | ON ST_Intersects(region.geom, street_edge.geom)
        |LEFT JOIN sidewalk.region_property
        | ON region.region_id = region_property.region_id
        |WHERE street_edge.street_edge_id = ? AND region_property.key = 'Neighborhood Name' AND region.deleted = FALSE
      """.stripMargin
    )
    selectRegionQuery(streetEdgeId).list
  }

  /**
    * Returns a list of neighborhoods intersecting the given bounding box
    * @param lat1
    * @param lng1
    * @param lat2
    * @param lng2
    * @return
    */
  def selectNamedNeighborhoodsIntersecting(lat1: Double, lng1: Double, lat2: Double, lng2: Double): List[NamedRegion] = db.withTransaction { implicit session =>
    // http://postgis.net/docs/ST_MakeEnvelope.html
    // geometry ST_MakeEnvelope(double precision xmin, double precision ymin, double precision xmax, double precision ymax, integer srid=unknown);
    val selectNamedNeighborhoodQuery = Q.query[(Double, Double, Double, Double), NamedRegion](
      """SELECT region.region_id, region_property.value, region.geom
        | FROM sidewalk.region
        |LEFT JOIN sidewalk.region_property
        | ON region.region_id = region_property.region_id
        |WHERE region.deleted = FALSE
        | AND region.region_type_id = 2
        | AND ST_Intersects(region.geom, ST_MakeEnvelope(?,?,?,?,4326))""".stripMargin
    )
    val minLat = min(lat1, lat2)
    val minLng = min(lng1, lng2)
    val maxLat = max(lat1, lat2)
    val maxLng = max(lng1, lng2)
    selectNamedNeighborhoodQuery((minLng, minLat, maxLng, maxLat)).list
  }

  /**
    * Returns a list of neighborhoods within the given bounding box
    * @param lat1
    * @param lng1
    * @param lat2
    * @param lng2
    * @return
    */
  def selectNamedNeighborhoodsWithin(lat1: Double, lng1: Double, lat2: Double, lng2: Double): List[NamedRegion] = db.withTransaction { implicit session =>
    // http://postgis.net/docs/ST_MakeEnvelope.html
    // geometry ST_MakeEnvelope(double precision xmin, double precision ymin, double precision xmax, double precision ymax, integer srid=unknown);
    val selectNamedNeighborhoodQuery = Q.query[(Double, Double, Double, Double), NamedRegion](
      """SELECT region.region_id, region_property.value, region.geom
        | FROM sidewalk.region
        |LEFT JOIN sidewalk.region_property
        | ON region.region_id = region_property.region_id
        |WHERE region.deleted = FALSE
        | AND region.region_type_id = 2
        | AND ST_Within(region.geom, ST_MakeEnvelope(?,?,?,?,4326))""".stripMargin
    )
    val minLat = min(lat1, lat2)
    val minLng = min(lng1, lng2)
    val maxLat = max(lat1, lat2)
    val maxLng = max(lng1, lng2)
    selectNamedNeighborhoodQuery((minLng, minLat, maxLng, maxLat)).list
  }

  /**
    * This method returns a list of NamedRegions
    *
    * @param regionType
    * @return
    */
  def selectNamedRegionsOfAType(regionType: String): List[NamedRegion] = db.withSession { implicit session =>

    val _regions = for {
      (_regions, _regionTypes) <- regionsWithoutDeleted.innerJoin(regionTypes).on(_.regionTypeId === _.regionTypeId) if _regionTypes.regionType === regionType
    } yield _regions


    val _namedRegions = for {
      (_regions, _regionProperties) <- _regions.leftJoin(regionProperties).on(_.regionId === _.regionId) if _regionProperties.key === "Neighborhood Name"
    } yield (_regions.regionId, _regionProperties.value.?, _regions.geom)

    _namedRegions.list.map(x => NamedRegion.tupled(x))
  }


}
