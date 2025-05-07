
package models.region

import com.google.inject.ImplementedBy
import scala.concurrent.ExecutionContext
import models.utils.LatLngBBox
import models.audit.AuditTaskTableDef
import models.street.{StreetEdgePriorityTableDef, StreetEdgeRegionTable}
import models.label.LabelTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.MultiPolygon
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._

case class Region(regionId: Int, dataSource: String, name: String, geom: MultiPolygon, deleted: Boolean)

class RegionTableDef(tag: Tag) extends Table[Region](tag, "region") {
  def regionId: Rep[Int] = column[Int]("region_id", O.PrimaryKey, O.AutoInc)
  def dataSource: Rep[String] = column[String]("data_source")
  def name: Rep[String] = column[String]("name")
  def geom: Rep[MultiPolygon] = column[MultiPolygon]("geom")
  def deleted: Rep[Boolean] = column[Boolean]("deleted")

  def * = (regionId, dataSource, name, geom, deleted) <> ((Region.apply _).tupled, Region.unapply)
}

@ImplementedBy(classOf[RegionTable])
trait RegionTableRepository { }

@Singleton
class RegionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                            streetEdgeRegionTable: StreetEdgeRegionTable
                           )(implicit val ec: ExecutionContext)
  extends RegionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {

  val regions = TableQuery[RegionTableDef]
  val auditTasks = TableQuery[AuditTaskTableDef]
  val streetEdgePriorities = TableQuery[StreetEdgePriorityTableDef]
  val regionsWithoutDeleted = regions.filter(_.deleted === false)

  def getAllRegions: DBIO[Seq[Region]] = regionsWithoutDeleted.result

  /**
   * Picks one of the 5 with highest average priority across their street edges.
   */
  def selectAHighPriorityRegion(excludedRegionIds: Seq[Int]): DBIO[Option[Region]] = {
    streetEdgeRegionTable.streetEdgeRegionTable
      .filterNot(_.regionId inSet excludedRegionIds)
      .join(streetEdgePriorities).on(_.streetEdgeId === _.streetEdgeId)
      .groupBy(_._1.regionId).map { case (rId, group) => (rId, group.map(_._2.priority).avg) } // Get avg priority by region
      .join(regionsWithoutDeleted).on(_._1 === _.regionId) // Get the full region instead of just the region_id
      .sortBy(_._1._2.desc).take(5).map(_._2) // Take the 5 with highest average priority
      .sortBy(_ => SimpleFunction.nullary[Double]("random")).result.headOption // Randomly select one of the 5
  }

  /**
   * Retrieves a region from the database based on the provided region ID.
   *
   * @param regionId The unique identifier of the region to retrieve.
   * @return A database action (DBIO) that resolves to an Option containing the Region
   *         if found, or None if no region with the given ID exists.
   */
  def getRegion(regionId: Int): DBIO[Option[Region]] = {
    regionsWithoutDeleted.filter(_.regionId === regionId).result.headOption
  }

  /**
   * Retrieves a region from the database by its name.
   *
   * @param regionName The name of the region to retrieve.
   * @return A DBIO action that, when executed, yields an Option containing the Region
   *         if found, or None if no region with the given name exists.
   */
  def getRegionByName(regionName: String): DBIO[Option[Region]] = {
    regionsWithoutDeleted.filter(_.name === regionName).result.headOption
  }

  /**
   * Returns a list of neighborhoods within the given bounding box.
   */
  def getNeighborhoodsWithin(bbox: LatLngBBox): DBIO[Seq[Region]] = {
    regionsWithoutDeleted
      .filter(_.geom.within(makeEnvelope(bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat, Some(4326))))
      .result
  }

  /**
   * Returns the bounding box of a specified region as an LatLngBBox.
   *
   * @param regionId The ID of the region to get the bounding box for
   * @return DBIO action that returns Option[LatLngBBox] representing the bounding box
   */
  def getBoundingBoxForRegion(regionId: Int): DBIO[Option[LatLngBBox]] = {
    sql"""
      SELECT 
        ST_XMin(ST_Envelope(geom)) as min_lng, 
        ST_YMin(ST_Envelope(geom)) as min_lat,
        ST_XMax(ST_Envelope(geom)) as max_lng, 
        ST_YMax(ST_Envelope(geom)) as max_lat
      FROM region
      WHERE region_id = $regionId AND deleted = FALSE
    """.as[(Double, Double, Double, Double)]
      .headOption
      .map(_.map(bbox => LatLngBBox(
        minLat = bbox._2.toFloat, 
        minLng = bbox._1.toFloat, 
        maxLat = bbox._4.toFloat, 
        maxLng = bbox._3.toFloat
      )))
  }

  /**
   * Gets regions w/ boolean noting if given user fully audited the region. If provided, filter for only given regions.
   */
  def getNeighborhoodsWithUserCompletionStatus(userId: String, regionIds: Seq[Int]): DBIO[Seq[(Region, Boolean)]] = {
    val userTasks = auditTasks.filter(a => a.completed && a.userId === userId)
    // Get regions that the user has not fully audited.
    val incompleteRegionsForUser = streetEdgeRegionTable.nonDeletedStreetEdgeRegions // FROM street_edge_region
      .joinLeft(userTasks).on(_.streetEdgeId === _.streetEdgeId) // LEFT JOIN audit_task
      .filter(_._2.isEmpty) // WHERE audit_task.audit_task_id IS NULL
      .groupBy(_._1.regionId) // GROUP BY region_id
      .map(_._1) // SELECT region_id

    // Left join regions and incomplete neighborhoods to record completion status.
    regionsWithoutDeleted
      .filter(_r => (_r.regionId inSet regionIds) || regionIds.isEmpty) // WHERE region_id IN regionIds
      .joinLeft(incompleteRegionsForUser).on(_.regionId === _)
      .map(x => (x._1, x._2.isEmpty)).result
  }

  /**
  * Returns the region with the highest number of labels.
  * This method joins regions with label data to count labels per region,
  * then returns the region with the most labels.
  *
  * @return DBIO action that returns the region with the most labels
  */
  def getRegionWithMostLabels: DBIO[Option[Region]] = {
    val labelsByRegion = for {
      _ser <- streetEdgeRegionTable.streetEdgeRegionTable
      _lb <- TableQuery[LabelTableDef] if _lb.streetEdgeId === _ser.streetEdgeId && !_lb.deleted && !_lb.tutorial
      _r <- regionsWithoutDeleted if _r.regionId === _ser.regionId
    } yield (_r, _lb.labelId)

    // Group by region and count labels
    labelsByRegion
      .groupBy(_._1)
      .map { case (region, group) => (region, group.map(_._2).countDistinct) }
      .sortBy(_._2.desc)
      .map(_._1)
      .result
      .headOption
  }

  /**
   * Select region_id of the region containing (or closest to) the lat/lng position for every lat/lng.
   *
   * Note that an attempt to take copy the Slick code from the function above and take a union between all the lat/lngs
   * to turn it into one query was unsuccessful, resulting in a stack overflow error. Maybe there is some other way to
   * use Slick syntax that more closely mirrors what we're doing in raw SQL below. Ultimately resorted to batching.
   * @param latLngs Seq of lat/lng pairs to find the closest region for.
   * @return Seq of region_ids that are the closest region to the corresponding lat/lng in the input Seq.
   */
  def getRegionIdClosestToLatLngs(latLngs: Seq[(Float, Float)]): DBIO[Seq[Int]] = {
    if (latLngs.isEmpty) {
      DBIO.successful(Seq.empty)
    } else {
      // Run the query in batches. We were hitting errors when running on too many lat/lngs at once.
//      DBIO.sequence(
//        latLngs.grouped(batchSize).map { latLngBatch => // Size of 25 worked when testing, but performance is better now.
          // Build a VALUES clause with all points.
          val pointDataSql = latLngs.zipWithIndex.map { case ((lat, lng), idx) =>
            s"($idx, ST_SetSRID(ST_MakePoint($lng, $lat), 4326))"
          }.mkString(", ")

          sql"""
            SELECT closest_region.region_id
            FROM (VALUES #$pointDataSql) AS point_data(idx, geom)
            CROSS JOIN LATERAL (
              SELECT region_id
              FROM region
              WHERE deleted = FALSE
              ORDER BY geom <-> point_data.geom
              LIMIT 1
            ) closest_region
            ORDER BY point_data.idx;
          """.as[Int]
//        }.toSeq
//      ).map(_.flatten)
    }
  }
}
