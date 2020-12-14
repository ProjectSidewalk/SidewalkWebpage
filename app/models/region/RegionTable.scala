package models.region

import java.util.UUID
import com.vividsolutions.jts.geom.Polygon
import models.audit.AuditTaskTable
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
case class NamedRegionAndUserCompletion(regionId: Int, name: Option[String], geom: Polygon, userCompleted: Boolean)

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
 * Data access object for the region table.
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
  val regionProperties = TableQuery[RegionPropertyTable]
  val userCurrentRegions = TableQuery[UserCurrentRegionTable]

  // These regions are buggy, so we steer new users away from them.
  // TODO make this city-agnostic. List(251, 281, 317, 366) for DC.
  val difficultRegionIds: List[Int] = List()
  val regionsWithoutDeleted = regions.filter(_.deleted === false)
  val neighborhoods = regionsWithoutDeleted.filter(_.regionTypeId === 2)
  val namedRegions = for {
    (_neighborhoods, _regionProperties) <- neighborhoods.leftJoin(regionProperties).on(_.regionId === _.regionId)
    if _regionProperties.key === "Neighborhood Name"
  } yield (_neighborhoods.regionId, _regionProperties.value.?, _neighborhoods.geom)
  val namedNeighborhoods = for {
    (_namedRegion, _neighborhood) <- namedRegions.innerJoin(neighborhoods).on(_._1 === _.regionId)
  } yield _namedRegion

  /**
   * Returns a list of all the neighborhood regions.
    *
    * @return A list of Region objects.
   */
  def selectAllNeighborhoods: List[Region] = db.withSession { implicit session =>
    regionsWithoutDeleted.filter(_.regionTypeId === 2).list
  }

  /**
    * Returns a list of all neighborhoods with names.
    */
  def selectAllNamedNeighborhoods: List[NamedRegion] = db.withSession { implicit session =>
    namedRegions.list.map(x => NamedRegion.tupled(x))
  }

  /**
    * Picks one of the regions with highest average priority.
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
    */
  def selectAHighPriorityRegion(userId: UUID): Option[NamedRegion] = db.withSession { implicit session =>
    val possibleRegionIds: List[Int] = AuditTaskTable.selectIncompleteRegions(userId).toList

    selectAHighPriorityRegionGeneric(possibleRegionIds) match {
      case Some(region) => Some(region)
      case _ => selectAHighPriorityRegion // Should only happen if user has completed all regions.
    }
  }

  /**
    * Picks one of the easy regions with highest average priority out of those that the user has not completed.
    */
  def selectAHighPriorityEasyRegion(userId: UUID): Option[NamedRegion] = db.withSession { implicit session =>
    val possibleRegionIds: List[Int] =
      AuditTaskTable.selectIncompleteRegions(userId).filterNot(difficultRegionIds.contains(_)).toList

    selectAHighPriorityRegionGeneric(possibleRegionIds) match {
      case Some(region) => Some(region)
      case _ => selectAHighPriorityRegion(userId) // Should only happen if user has completed all easy regions.
    }
  }

  /**
    * Out of the provided regions, picks one of the 5 with highest average priority across their street edges.
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
    * Get the region specified by the region id.
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

  /**
    * Returns a list of neighborhoods within the given bounding box.
    */
  def selectNamedNeighborhoodsWithin(lat1: Double, lng1: Double, lat2: Double, lng2: Double): List[NamedRegion] = db.withTransaction { implicit session =>
    // http://postgis.net/docs/ST_MakeEnvelope.html
    // geometry ST_MakeEnvelope(double precision xmin, double precision ymin, double precision xmax, double precision ymax, integer srid=unknown);
    val selectNamedNeighborhoodQuery = Q.query[(Double, Double, Double, Double), NamedRegion](
      """SELECT region.region_id, region_property.value, region.geom
        |FROM sidewalk.region
        |LEFT JOIN sidewalk.region_property ON region.region_id = region_property.region_id
        |WHERE region.deleted = FALSE
        |    AND region.region_type_id = 2
        |    AND ST_Within(region.geom, ST_MakeEnvelope(?,?,?,?,4326))""".stripMargin
    )
    val minLat = min(lat1, lat2)
    val minLng = min(lng1, lng2)
    val maxLat = max(lat1, lat2)
    val maxLng = max(lng1, lng2)
    selectNamedNeighborhoodQuery((minLng, minLat, maxLng, maxLat)).list
  }

  /**
   * Gets all named neighborhoods with a boolean indicating if the given user has fully audited that neighborhood.
   */
  def getNeighborhoodsWithUserCompletionStatus(userId: UUID): List[NamedRegionAndUserCompletion] = db.withSession { implicit session =>
    // Gets regions that the user has not fully audited.
    val incompleteRegionsForUser = StreetEdgeRegionTable.streetEdgeRegionTable // FROM street_edge_region
      .leftJoin(AuditTaskTable.completedTasks).on(_.streetEdgeId === _.streetEdgeId) // LEFT JOIN audit_task
      .filter(_._2.auditTaskId.?.isEmpty) // WHERE audit_task.audit_task_id IS NULL
      .groupBy(_._1.regionId) // GROUP BY region_id
      .map(_._1) // SELECT region_id

    // Left join named neighborhoods and incomplete neighborhoods to record completion status.
    namedNeighborhoods
      .leftJoin(incompleteRegionsForUser).on(_._1 === _).map(x => (x._1._1, x._1._2, x._1._3, x._2.?.isEmpty))
      .list.map(NamedRegionAndUserCompletion.tupled)
  }

  /**
    * Gets the region id of the neighborhood wherein the lat-lng point is located, the closest neighborhood otherwise.
    */
  def selectRegionIdOfClosestNeighborhood(lng: Float, lat: Float): Int = db.withSession { implicit session =>
    val closestNeighborhoodQuery = Q.query[(Float, Float, Float, Float), Int](
      """SELECT region_id
        |FROM region,
        |     (
        |         SELECT MIN(st_distance(geom, st_setsrid(st_makepoint(?, ?), 4326))) AS min_dist
        |         FROM region
        |         WHERE region.deleted = FALSE
        |             AND region.region_type_id = 2
        |     ) region_dists
        |WHERE st_distance(geom, st_setsrid(st_makepoint(?, ?), 4326)) = min_dist
        |    AND deleted = FALSE
        |    AND region_type_id = 2;
      """.stripMargin
    )
    closestNeighborhoodQuery((lng, lat, lng, lat)).list.head
  }
}
