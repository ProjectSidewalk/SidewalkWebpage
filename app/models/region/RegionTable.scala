package models.region

import java.util.UUID
import com.vividsolutions.jts.geom.{Coordinate, MultiPolygon, Polygon}
import models.audit.AuditTaskTable
import math._
import models.street.{StreetEdgePriorityTable, StreetEdgeRegionTable}
import models.user.UserCurrentRegionTable
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.extras.geojson
import play.extras.geojson.LatLng
import scala.collection.immutable.Seq
import scala.slick.jdbc.{GetResult, StaticQuery => Q}

case class Region(regionId: Int, dataSource: String, name: String, geom: MultiPolygon, deleted: Boolean)

class RegionTable(tag: Tag) extends Table[Region](tag, Some("sidewalk"), "region") {
  def regionId = column[Int]("region_id", O.PrimaryKey, O.AutoInc)
  def dataSource = column[String]("data_source", O.NotNull)
  def name = column[String]("name", O.NotNull)
  def geom = column[MultiPolygon]("geom", O.NotNull)
  def deleted = column[Boolean]("deleted", O.NotNull)

  def * = (regionId, dataSource, name, geom, deleted) <> ((Region.apply _).tupled, Region.unapply)
}

/**
 * Data access object for the region table.
 */
object RegionTable {
  import MyPostgresDriver.plainImplicits._

  implicit val regionConverter = GetResult[Region](r => {
    Region(r.nextInt, r.nextString, r.nextString, r.nextGeometry[MultiPolygon], r.nextBoolean)
  })

  case class StreetCompletion(regionId: Int, regionName: String, streetEdgeId: Int, completionCount: Int, distance: Double)
  implicit val streetCompletionConverter = GetResult[StreetCompletion](r => {
    StreetCompletion(r.nextInt, r.nextString, r.nextInt, r.nextInt, r.nextDouble)
  })

  implicit class MultiPolygonUtils(val multiPolygon: MultiPolygon) {
    // Put MultiPolygon in geojson format, an array[array[array[latlng]]], where each array[array[latlng]] represents a
    // single polygon. In each polygon, the first array contains the latlngs for the outer boundary of the polygon, and
    // the remaining arrays have the latlngs for any holes in the polygon.
    def toJSON: geojson.MultiPolygon[LatLng] = {
      val nPolygons: Int = multiPolygon.getNumGeometries
      val allCoordinates: Seq[Seq[Seq[geojson.LatLng]]] = (0 until nPolygons).map { polygonIndex =>
        val currPolygon: Polygon = multiPolygon.getGeometryN(polygonIndex).asInstanceOf[Polygon]
        val nHoles: Int = currPolygon.getNumInteriorRing
        val outerRing: Seq[Array[Coordinate]] = Seq(currPolygon.getExteriorRing.getCoordinates)
        val holes: Seq[Array[Coordinate]] = (0 until nHoles).map(i => currPolygon.getInteriorRingN(i).getCoordinates)
        val coordinates: Seq[Array[Coordinate]] = outerRing ++ holes
        coordinates.map { ring => ring.map(coord => geojson.LatLng(coord.y, coord.x)).toList }
      }
      geojson.MultiPolygon(allCoordinates)
    }
  }

  val db = play.api.db.slick.DB
  val regions = TableQuery[RegionTable]
  val userCurrentRegions = TableQuery[UserCurrentRegionTable]

  // These regions are buggy, so we steer new users away from them.
  // TODO make this city-agnostic. List(251, 281, 317, 366) for DC.
  val difficultRegionIds: List[Int] = List()
  val regionsWithoutDeleted = regions.filter(_.deleted === false)

  /**
    * Returns a list of all neighborhoods with names.
    */
  def getAllRegions: List[Region] = db.withSession { implicit session =>
    regionsWithoutDeleted.list
  }

  /**
   * Return the name of the given neighborhood.
   */
  def neighborhoodName(regionId: Int): Option[String] = db.withSession { implicit session =>
    regions.filter(_.regionId === regionId).map(_.name).firstOption
  }

  /**
    * Picks one of the regions with highest average priority.
    */
  def selectAHighPriorityRegion: Option[Region] = db.withSession { implicit session =>
    val possibleRegionIds: List[Int] = regionsWithoutDeleted.map(_.regionId).list

    selectAHighPriorityRegionGeneric(possibleRegionIds) match {
      case Some(region) => Some(region)
      case _ => None // Should never happen.
    }
  }

  /**
    * Picks one of the regions with highest average priority out of those that the user has not completed.
    */
  def selectAHighPriorityRegion(userId: UUID): Option[Region] = db.withSession { implicit session =>
    val possibleRegionIds: List[Int] = AuditTaskTable.selectIncompleteRegions(userId).toList

    selectAHighPriorityRegionGeneric(possibleRegionIds) match {
      case Some(region) => Some(region)
      case _ => selectAHighPriorityRegion // Should only happen if user has completed all regions.
    }
  }

  /**
    * Picks one of the easy regions with highest average priority out of those that the user has not completed.
    */
  def selectAHighPriorityEasyRegion(userId: UUID): Option[Region] = db.withSession { implicit session =>
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
  def selectAHighPriorityRegionGeneric(possibleRegionIds: List[Int]): Option[Region] = db.withSession { implicit session =>

    val highestPriorityRegions: List[Int] =
      StreetEdgeRegionTable.streetEdgeRegionTable
      .filter(_.regionId inSet possibleRegionIds)
      .innerJoin(StreetEdgePriorityTable.streetEdgePriorities).on(_.streetEdgeId === _.streetEdgeId)
      .map { case (_region, _priority) => (_region.regionId, _priority.priority) } // select region_id, priority
      .groupBy(_._1).map { case (_regionId, group) => (_regionId, group.map(_._2).avg) } // get avg priority by region
      .sortBy(_._2.desc).take(5).map(_._1).list // take the 5 with highest average priority, select region_id

    scala.util.Random.shuffle(highestPriorityRegions).headOption.flatMap(getRegion)
  }

  /**
    * Get the region specified by the region id.
    */
  def getRegion(regionId: Int): Option[Region] = db.withSession { implicit session =>
    regionsWithoutDeleted.filter(_.regionId === regionId).firstOption
  }

  /**
    * Get the neighborhood that is currently assigned to the user.
    */
  def getCurrentRegion(userId: UUID): Option[Region] = db.withSession { implicit session =>
    val _currentRegion = for {
      _region <- regionsWithoutDeleted
      _userCurrRegion <- userCurrentRegions if _region.regionId === _userCurrRegion.regionId
      if _userCurrRegion.userId === userId.toString
    } yield _region

    _currentRegion.firstOption
  }

  /**
    * Returns a list of neighborhoods within the given bounding box.
    */
  def getNeighborhoodsWithin(lat1: Double, lng1: Double, lat2: Double, lng2: Double): List[Region] = db.withTransaction { implicit session =>
    // http://postgis.net/docs/ST_MakeEnvelope.html
    // geometry ST_MakeEnvelope(double precision xmin, double precision ymin, double precision xmax, double precision ymax, integer srid=unknown);
    val selectNeighborhoodsQuery = Q.query[(Double, Double, Double, Double), Region](
      """SELECT region.region_id, region.data_source, region.name, region.geom, region.deleted
        |FROM region
        |WHERE region.deleted = FALSE
        |    AND ST_Within(region.geom, ST_MakeEnvelope(?,?,?,?,4326))""".stripMargin
    )
    selectNeighborhoodsQuery((min(lng1, lng2), min(lat1, lat2), max(lng1, lng2), max(lat1, lat2))).list
  }

  /**
   * Gets all neighborhoods with a boolean indicating if the given user has fully audited that neighborhood.
   */
  def getNeighborhoodsWithUserCompletionStatus(userId: UUID): List[(Region, Boolean)] = db.withSession { implicit session =>
    val userTasks = AuditTaskTable.auditTasks.filter(a => a.completed && a.userId === userId.toString)
    // Gets regions that the user has not fully audited.
    val incompleteRegionsForUser = StreetEdgeRegionTable.nonDeletedStreetEdgeRegions // FROM street_edge_region
      .leftJoin(userTasks).on(_.streetEdgeId === _.streetEdgeId) // LEFT JOIN audit_task
      .filter(_._2.auditTaskId.?.isEmpty) // WHERE audit_task.audit_task_id IS NULL
      .groupBy(_._1.regionId) // GROUP BY region_id
      .map(_._1) // SELECT region_id

    // Left join regions and incomplete neighborhoods to record completion status.
    regionsWithoutDeleted.leftJoin(incompleteRegionsForUser).on(_.regionId === _).map(x => (x._1, x._2.?.isEmpty)).list
  }

  /**
    * Gets the region id of the neighborhood wherein the lat-lng point is located, the closest neighborhood otherwise.
    */
  def selectRegionIdOfClosestNeighborhood(lng: Float, lat: Float): Int = db.withSession { implicit session =>
    val closestNeighborhoodQuery = Q.query[(Float, Float), Int](
      """SELECT region_id
        |FROM region
        |WHERE deleted = FALSE
        |ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(?, ?), 4326)) ASC
        |LIMIT 1;""".stripMargin
    )
    closestNeighborhoodQuery((lng, lat)).first
  }
}
