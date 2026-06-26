package models.region

import com.google.inject.ImplementedBy
import models.api.{RegionDataForApi, RegionFiltersForApi}
import models.audit.AuditTaskTableDef
import models.label.LabelTable
import models.street.{StreetEdgePriorityTableDef, StreetEdgeRegionTable}
import models.utils.MyPostgresProfile.api._
import models.utils.{LatLngBBox, MyPostgresProfile}
import org.locationtech.jts.geom.MultiPolygon
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.dbio.Effect
import slick.jdbc.GetResult
import slick.sql.SqlStreamingAction

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject._
import scala.concurrent.ExecutionContext

case class Region(regionId: Int, dataSource: String, name: String, geom: MultiPolygon, deleted: Boolean)

class RegionTableDef(tag: Tag) extends Table[Region](tag, "region") {
  def regionId: Rep[Int]      = column[Int]("region_id", O.PrimaryKey, O.AutoInc)
  def dataSource: Rep[String] = column[String]("data_source")
  def name: Rep[String]       = column[String]("name")
  def geom: Rep[MultiPolygon] = column[MultiPolygon]("geom")
  def deleted: Rep[Boolean]   = column[Boolean]("deleted")

  def * = (regionId, dataSource, name, geom, deleted) <> ((Region.apply _).tupled, Region.unapply)
}

@ImplementedBy(classOf[RegionTable])
trait RegionTableRepository {}

@Singleton
class RegionTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    streetEdgeRegionTable: StreetEdgeRegionTable,
    labelTable: LabelTable
)(implicit val ec: ExecutionContext)
    extends RegionTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val regions               = TableQuery[RegionTableDef]
  val auditTasks            = TableQuery[AuditTaskTableDef]
  val streetEdgePriorities  = TableQuery[StreetEdgePriorityTableDef]
  val regionsWithoutDeleted = regions.filter(_.deleted === false)

  def getAllRegions: DBIO[Seq[Region]] = regionsWithoutDeleted.result

  /**
   * Picks one of the 5 with highest average priority across their street edges.
   */
  def selectAHighPriorityRegion(excludedRegionIds: Seq[Int]): DBIO[Option[Region]] = {
    streetEdgeRegionTable.streetEdgeRegionTable
      .filterNot(_.regionId inSetBind excludedRegionIds)
      .join(streetEdgePriorities)
      .on(_.streetEdgeId === _.streetEdgeId)
      .groupBy(_._1.regionId)
      .map { case (rId, group) => (rId, group.map(_._2.priority).avg) } // Get avg priority by region
      .join(regionsWithoutDeleted)
      .on(_._1 === _.regionId) // Get the full region instead of just the region_id
      .sortBy(_._1._2.desc)
      .take(5)
      .map(_._2) // Take the 5 with highest average priority
      .sortBy(_ => SimpleFunction.nullary[Double]("random"))
      .result
      .headOption // Randomly select one of the 5
  }

  /**
   * Retrieves a region from the database based on the provided region ID.
   *
   * @param regionId The unique identifier of the region to retrieve.
   * @return A database action (DBIO) that resolves to the Region if it exists and is not marked as deleted.
   */
  def getRegion(regionId: Int): DBIO[Option[Region]] = {
    regionsWithoutDeleted.filter(_.regionId === regionId).result.headOption
  }

  /**
   * Retrieves a region from the database by its name.
   *
   * @param regionName The name of the region to retrieve.
   * @return A database action (DBIO) that resolves to the Region if it exists and is not marked as deleted.
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
   * Gets regions w/ boolean noting if given user fully audited the region. If provided, filter for only given regions.
   */
  def getNeighborhoodsWithUserCompletionStatus(userId: String, regionIds: Seq[Int]): DBIO[Seq[(Region, Boolean)]] = {
    val userTasks = auditTasks.filter(a => a.completed && a.userId === userId)
    // Get regions that the user has not fully audited.
    val incompleteRegionsForUser = streetEdgeRegionTable.nonDeletedStreetEdgeRegions // FROM street_edge_region
      .joinLeft(userTasks)
      .on(_.streetEdgeId === _.streetEdgeId) // LEFT JOIN audit_task
      .filter(_._2.isEmpty)                  // WHERE audit_task.audit_task_id IS NULL
      .groupBy(_._1.regionId)                // GROUP BY region_id
      .map(_._1)                             // SELECT region_id

    // Left join regions and incomplete neighborhoods to record completion status.
    regionsWithoutDeleted
      .filter(_r => (_r.regionId inSetBind regionIds) || regionIds.isEmpty) // WHERE region_id IN regionIds
      .joinLeft(incompleteRegionsForUser)
      .on(_.regionId === _)
      .map(x => (x._1, x._2.isEmpty))
      .result
  }

  /**
   * Returns the non-deleted region with the highest number of labels, if any have labels.
   *
   * @return DBIO action containing the region with the most labels
   */
  def getRegionWithMostLabels: DBIO[Option[Region]] = {
    labelTable.labelsWithAuditTasksAndUserStats
      .join(streetEdgeRegionTable.streetEdgeRegionTable)
      .on(_._1.streetEdgeId === _.streetEdgeId)
      .groupBy(_._2.regionId) // Group by region_id
      .map { case (regionId, group) => (regionId, group.length) } // Count labels per region.
      .join(regionsWithoutDeleted)
      .on(_._1 === _.regionId) // Join with regions to get full region info.
      .sortBy(_._1._2.desc)    // Sort by label count descending.
      .map(_._2)
      .result
      .headOption // Output first region.
  }

  /**
   * Gets all region (neighborhood) data for the API with filters applied, designed for streaming.
   *
   * @param filters The filters to apply when retrieving regions.
   * @return        A streaming database action that yields RegionDataForApi objects.
   */
  def getRegionsForApi(
      filters: RegionFiltersForApi
  ): SqlStreamingAction[Vector[RegionDataForApi], RegionDataForApi, Effect.Read] = {
    // Set up query filters. User-supplied string values (regionName) are single-quote-escaped and numeric filters are
    // safe; see #2756 for migrating these raw builders to bound parameters.
    val bboxFilter = filters.bbox
      .map { bbox =>
        s"AND ST_Intersects(region.geom, " +
          s"ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
      }
      .getOrElse("")

    val regionIdFilter = filters.regionId.map { regionId => s"AND region.region_id = $regionId" }.getOrElse("")

    val regionNameFilter =
      filters.regionName.map { regionName => s"AND LOWER(region.name) = LOWER('${regionName.replace("'", "''")}')" }
        .getOrElse("")

    val minLabelCountFilter =
      filters.minLabelCount.map { count => s"AND COALESCE(region_labels.label_count, 0) >= $count" }.getOrElse("")

    val queryStr = s"""
      WITH filtered_regions AS (
        SELECT region.region_id, region.name, region.geom
        FROM region
        WHERE region.deleted = FALSE
            $bboxFilter
            $regionIdFilter
            $regionNameFilter
      ),
      -- Get the number of (non-deleted, non-tutorial) streets in each region.
      region_streets AS (
        SELECT street_edge_region.region_id, COUNT(DISTINCT street_edge.street_edge_id) AS street_count
        FROM street_edge_region
        JOIN street_edge ON street_edge_region.street_edge_id = street_edge.street_edge_id
        WHERE street_edge.deleted = FALSE
            AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
            AND street_edge_region.region_id IN (SELECT region_id FROM filtered_regions)
        GROUP BY street_edge_region.region_id
      ),
      -- Get the number of completed audits of streets in each region.
      region_audits AS (
        SELECT street_edge_region.region_id, COUNT(audit_task.audit_task_id) AS audit_count
        FROM street_edge_region
        JOIN street_edge ON street_edge_region.street_edge_id = street_edge.street_edge_id
            AND street_edge.deleted = FALSE
            AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
        JOIN audit_task ON street_edge_region.street_edge_id = audit_task.street_edge_id
            AND audit_task.completed = TRUE
        WHERE street_edge_region.region_id IN (SELECT region_id FROM filtered_regions)
        GROUP BY street_edge_region.region_id
      ),
      -- Get label counts, distinct user counts, and label timestamps for each region.
      region_labels AS (
        SELECT street_edge_region.region_id,
               COUNT(label.label_id) AS label_count,
               COUNT(DISTINCT label.user_id) AS user_count,
               MIN(label.time_created) AS first_label_date,
               MAX(label.time_created) AS last_label_date
        FROM street_edge_region
        JOIN street_edge ON street_edge_region.street_edge_id = street_edge.street_edge_id
            AND street_edge.deleted = FALSE
            AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
        JOIN label ON street_edge_region.street_edge_id = label.street_edge_id
            AND label.deleted = FALSE
            AND label.tutorial = FALSE
        JOIN user_stat ON label.user_id = user_stat.user_id
            AND user_stat.excluded = FALSE
        WHERE street_edge_region.region_id IN (SELECT region_id FROM filtered_regions)
        GROUP BY street_edge_region.region_id
      )
      -- Final selection with all aggregates joined back to the filtered regions. Distance-based completion comes from
      -- the maintained region_completion table (one source of truth) rather than being re-derived live here; missing
      -- rows COALESCE to 0 so regions absent from that table simply report 0% complete.
      SELECT filtered_regions.region_id, filtered_regions.name,
             COALESCE(region_labels.label_count, 0) AS label_count,
             COALESCE(region_streets.street_count, 0) AS street_count,
             COALESCE(region_labels.user_count, 0) AS user_count,
             COALESCE(region_audits.audit_count, 0) AS audit_count,
             COALESCE(region_completion.total_distance, 0) AS total_distance_m,
             COALESCE(region_completion.audited_distance, 0) AS audited_distance_m,
             CASE WHEN COALESCE(region_completion.total_distance, 0) > 0
                  THEN region_completion.audited_distance / region_completion.total_distance
                  ELSE 0 END AS completion_rate,
             region_labels.first_label_date,
             region_labels.last_label_date,
             filtered_regions.geom
      FROM filtered_regions
      LEFT JOIN region_streets ON filtered_regions.region_id = region_streets.region_id
      LEFT JOIN region_audits ON filtered_regions.region_id = region_audits.region_id
      LEFT JOIN region_labels ON filtered_regions.region_id = region_labels.region_id
      LEFT JOIN region_completion ON filtered_regions.region_id = region_completion.region_id
      WHERE 1=1
        $minLabelCountFilter
      ORDER BY filtered_regions.region_id
    """

    implicit val getRegionDataForApi: GetResult[RegionDataForApi] = GetResult { r =>
      RegionDataForApi(
        regionId = r.nextInt(),
        name = r.nextString(),
        labelCount = r.nextInt(),
        streetCount = r.nextInt(),
        userCount = r.nextInt(),
        auditCount = r.nextInt(),
        totalDistanceM = r.nextDouble(),
        auditedDistanceM = r.nextDouble(),
        completionRate = r.nextDouble(),
        firstLabelDate = r.nextTimestampOption().map(t => OffsetDateTime.ofInstant(t.toInstant, ZoneOffset.UTC)),
        lastLabelDate = r.nextTimestampOption().map(t => OffsetDateTime.ofInstant(t.toInstant, ZoneOffset.UTC)),
        geometry = r.nextGeometry[MultiPolygon]()
      )
    }

    sql"""#$queryStr""".as[RegionDataForApi]
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
  def getRegionIdClosestToLatLngs(latLngs: Seq[(Double, Double)]): DBIO[Seq[Int]] = {
    if (latLngs.isEmpty) {
      DBIO.successful(Seq.empty)
    } else {
      // Build a VALUES clause with all points.
      val pointDataSql = latLngs.zipWithIndex
        .map { case ((lat, lng), idx) =>
          s"($idx, ST_SetSRID(ST_MakePoint($lng, $lat), 4326))"
        }
        .mkString(", ")

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
    }
  }
}
