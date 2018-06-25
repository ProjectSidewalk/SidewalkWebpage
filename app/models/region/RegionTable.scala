package models.region

import java.util.UUID

import com.vividsolutions.jts.geom.Polygon
import models.mission.MissionTable

import math._
import models.street.{StreetEdgePriorityTable, StreetEdgeRegionTable}
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
  val userCurrentRegions = TableQuery[UserCurrentRegionTable]

  // These regions are buggy, so we steer new users away from them
  val difficultRegionIds: List[Int] = List(251, 281, 317, 366)
  val regionsWithoutDeleted = regions.filter(_.deleted === false)
  val neighborhoods = regionsWithoutDeleted.filter(_.regionTypeId === 2)
  val namedRegions = for {
    (_neighborhoods, _regionProperties) <- neighborhoods.leftJoin(regionProperties).on(_.regionId === _.regionId)
    if _regionProperties.key === "Neighborhood Name"
  } yield (_neighborhoods.regionId, _regionProperties.value.?, _neighborhoods.geom)

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
    namedRegions.list.map(x => NamedRegion.tupled(x))
  }

  /**
    * Picks one of the easy regions with highest average priority.
    *
    * @return
    */
  def selectAHighPriorityEasyRegion: Option[NamedRegion] = db.withSession { implicit session =>
    val possibleRegionIds: List[Int] =
      regionsWithoutDeleted.filterNot(_.regionId inSet difficultRegionIds).map(_.regionId).list

    selectAHighPriorityRegionGeneric(possibleRegionIds) match {
      case Some(region) => Some(region)
      case _ => selectAHighPriorityRegion // Should only happen if all regions are difficult regions.
    }
  }

  /**
    * Picks one of the regions with highest average priority.
    *
    * @return
    */
  def selectAHighPriorityRegion: Option[NamedRegion] = db.withSession { implicit session =>
    val possibleRegionIds: List[Int] = regionsWithoutDeleted.map(_.regionId).list

    selectAHighPriorityRegionGeneric(possibleRegionIds) match {
      case Some(region) => Some(region)
      case _ => None // Should never happen.
    }
  }

  /**
    * Picks one of the regions with highest average priority out of those that the user has not completed.
    *
    * @param userId
    * @return
    */
  def selectAHighPriorityRegion(userId: UUID): Option[NamedRegion] = db.withSession { implicit session =>
    val possibleRegionIds: List[Int] = MissionTable.selectIncompleteRegionsUsingTasks(userId).toList

    selectAHighPriorityRegionGeneric(possibleRegionIds) match {
      case Some(region) => Some(region)
      case _ => selectAHighPriorityRegion // Should only happen if user has completed all regions.
    }
  }

  /**
    * Picks one of the easy regions with highest average priority out of those that the user has not completed.
    *
    * @param userId
    * @return
    */
  def selectAHighPriorityEasyRegion(userId: UUID): Option[NamedRegion] = db.withSession { implicit session =>
    val possibleRegionIds: List[Int] =
      MissionTable.selectIncompleteRegionsUsingTasks(userId).filterNot(difficultRegionIds.contains(_)).toList

    selectAHighPriorityRegionGeneric(possibleRegionIds) match {
      case Some(region) => Some(region)
      case _ => selectAHighPriorityRegion(userId) // Should only happen if user has completed all easy regions.
    }
  }

  /**
    * Out of the provided regions, picks one of the 5 with highest average priority across their street edges.
    *
    * @param possibleRegionIds
    * @return
    */
  def selectAHighPriorityRegionGeneric(possibleRegionIds: List[Int]): Option[NamedRegion] = db.withSession { implicit session =>

    val highestPriorityRegions: List[Int] =
      StreetEdgeRegionTable.streetEdgeRegionTable
      .filter(_.regionId inSet possibleRegionIds)
      .innerJoin(StreetEdgePriorityTable.streetEdgePriorities).on(_.streetEdgeId === _.streetEdgeId)
      .map { case (_region, _priority) => (_region.regionId, _priority.priority) } // select region_id, priority
      .groupBy(_._1).map { case (_regionId, group) => (_regionId, group.map(_._2).avg) } // get avg priority by region
      .sortBy(_._2.desc).take(5).map(_._1).list // take the 5 with highest average priority, select region_id

    scala.util.Random.shuffle(highestPriorityRegions).headOption.flatMap(selectANamedRegion)
  }

  /**
    * Get the region specified by the region id
    *
    * @param regionId region id
    * @return
    */
  def selectANeighborhood(regionId: Int): Option[Region] = db.withSession { implicit session =>
      neighborhoods.filter(_.regionId === regionId).list.headOption
  }

  /**
    * Get the region specified by the region id
    *
    * @param regionId region id
    * @return
    */
  def selectANamedRegion(regionId: Int): Option[NamedRegion] = db.withSession { implicit session =>
    val filteredNeighborhoods = neighborhoods.filter(_.regionId === regionId)
    val _regions = for {
      (_neighborhoods, _properties) <- filteredNeighborhoods.leftJoin(regionProperties).on(_.regionId === _.regionId)
      if _properties.key === "Neighborhood Name"
    } yield (_neighborhoods.regionId, _properties.value.?, _neighborhoods.geom)
    _regions.list.headOption.map(x => NamedRegion.tupled(x))
  }

  /**
    * Get the neighborhood that is currently assigned to the user.
    *
    * @param userId user id
    * @return
    */
  def selectTheCurrentRegion(userId: UUID): Option[Region] = db.withSession { implicit session =>
    val currentRegions = for {
      (r, ucr) <- regionsWithoutDeleted.filter(_.regionTypeId === 2).innerJoin(userCurrentRegions).on(_.regionId === _.regionId)
      if ucr.userId === userId.toString
    } yield r
    currentRegions.list.headOption
  }

  /**
    * Get the neighborhood that is currently assigned to the user.
    *
    * @param userId user id
    * @return
    */
  def selectTheCurrentNamedRegion(userId: UUID): Option[NamedRegion] = db.withSession { implicit session =>
      val currentRegions = for {
        (r, ucr) <- regionsWithoutDeleted.filter(_.regionTypeId === 2).innerJoin(userCurrentRegions).on(_.regionId === _.regionId)
        if ucr.userId === userId.toString
      } yield r

      val _regions = for {
        (_regions, _properties) <- currentRegions.leftJoin(regionProperties).on(_.regionId === _.regionId)
        if _properties.key === "Neighborhood Name"
      } yield (_regions.regionId, _properties.value.?, _regions.geom)
      _regions.list.headOption.map(x => NamedRegion.tupled(x))
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
      (_regions, _regionTypes) <- regionsWithoutDeleted.innerJoin(regionTypes).on(_.regionTypeId === _.regionTypeId)
      if _regionTypes.regionType === regionType
    } yield _regions


    val _namedRegions = for {
      (_regions, _regionProperties) <- _regions.leftJoin(regionProperties).on(_.regionId === _.regionId)
      if _regionProperties.key === "Neighborhood Name"
    } yield (_regions.regionId, _regionProperties.value.?, _regions.geom)

    _namedRegions.list.map(x => NamedRegion.tupled(x))
  }
}
