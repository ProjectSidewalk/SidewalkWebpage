package models.cluster

import com.google.inject.ImplementedBy
import models.api.{LabelClusterFiltersForApi, LabelClusterForApi, RawLabelInClusterDataForApi}
import models.label.LabelTypeTableDef
import models.street.StreetEdgeTableDef
import models.utils.MyPostgresProfile.api._
import models.utils.SpatialQueryType.SpatialQueryType
import models.utils.{LatLngBBox, MyPostgresProfile, SpatialQueryType}
import org.locationtech.jts.geom.Point
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json._
import slick.dbio.Effect
import slick.jdbc.GetResult
import slick.sql.SqlStreamingAction

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}

case class Cluster(
    clusterId: Int,
    clusteringSessionId: Int,
    labelTypeId: Int,
    streetEdgeId: Int,
    geom: Point,
    severity: Option[Int]
)

/**
 * Lean per-cluster inputs for the v3 AccessScore computation (#3855).
 *
 * Deliberately minimal — only what the scoring engine needs — so the query can skip the expensive validation/image-date/
 * user-list aggregation that the general cluster query computes.
 *
 * @param streetEdgeId The street the cluster sits on (clusters are grouped by street to score it).
 * @param labelType    The cluster's label type name (e.g. "CurbRamp").
 * @param severity     Median severity 1..3 of the cluster's labels, or None for presence-only/unrated clusters.
 * @param labelCount   Number of member labels (denominator for the tag-active threshold).
 * @param tagCounts    Map of tag name → number of member labels carrying that tag.
 */
case class ClusterScoreRow(
    streetEdgeId: Int,
    labelType: String,
    severity: Option[Int],
    labelCount: Int,
    tagCounts: Map[String, Int]
)

class ClusterTableDef(tag: slick.lifted.Tag) extends Table[Cluster](tag, "cluster") {
  def clusterId: Rep[Int]           = column[Int]("cluster_id", O.PrimaryKey, O.AutoInc)
  def clusteringSessionId: Rep[Int] = column[Int]("clustering_session_id")
  def labelTypeId: Rep[Int]         = column[Int]("label_type_id")
  def streetEdgeId: Rep[Int]        = column[Int]("street_edge_id")
  def geom: Rep[Point]              = column[Point]("geom")
  def severity: Rep[Option[Int]]    = column[Option[Int]]("severity")

  def * = (clusterId, clusteringSessionId, labelTypeId, streetEdgeId, geom, severity) <> (
    (Cluster.apply _).tupled,
    Cluster.unapply
  )

  def labelType = foreignKey("cluster_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTableDef])(_.labelTypeId)
  def clusteringSession =
    foreignKey("cluster_clustering_session_id_fkey", clusteringSessionId, TableQuery[ClusteringSessionTableDef])(
      _.clusteringSessionId,
      onDelete = ForeignKeyAction.Cascade
    )
  def streetEdge =
    foreignKey("cluster_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
}

@ImplementedBy(classOf[ClusterTable]) trait ClusterTableRepository {

  /**
   * Gets label clusters based on the provided filter criteria for the v3 API.
   *
   * @param filters The filter criteria to apply to the query
   * @return A database streaming action that yields LabelClusterForApi objects
   */
  def getLabelClustersV3(
      filters: LabelClusterFiltersForApi
  ): SqlStreamingAction[Vector[LabelClusterForApi], LabelClusterForApi, Effect]

  /**
   * Streams lean per-cluster scoring inputs for the v3 AccessScore endpoints.
   *
   * @param spatialQueryType Whether the bbox filters on region geometry or street geometry.
   * @param bbox             The bounding box to score within.
   * @param labelTypes       The label type names to include (the scoring engine's scored-type set).
   * @return                 A streaming action yielding one [[ClusterScoreRow]] per in-scope cluster.
   */
  def getClusterScoreRows(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      labelTypes: Set[String]
  ): SqlStreamingAction[Vector[ClusterScoreRow], ClusterScoreRow, Effect]

  def countClusters: DBIO[Int]

  def saveMultiple(newClusters: Seq[Cluster]): DBIO[Seq[Int]]
}

@Singleton
class ClusterTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends ClusterTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val clusters: TableQuery[ClusterTableDef] = TableQuery[ClusterTableDef]

  // Create an implicit converter for LabelClusterForApi
  implicit val labelClusterForApiConverter: GetResult[LabelClusterForApi] = GetResult[LabelClusterForApi] { r =>
    val labelClusterId = r.nextInt()
    val labelType      = r.nextString()
    val streetEdgeId   = r.nextInt()
    val osmWayId       = r.nextLong()
    val regionId       = r.nextInt()
    val regionName     = r.nextString()

    // Parse dates with null handling.
    val avgImageCaptureDate = r.nextTimestampOption().map(ts => OffsetDateTime.ofInstant(ts.toInstant, ZoneOffset.UTC))
    val avgLabelDate        = r.nextTimestampOption().map(ts => OffsetDateTime.ofInstant(ts.toInstant, ZoneOffset.UTC))

    val medianSeverity = r.nextIntOption()
    val agreeCount     = r.nextInt()
    val disagreeCount  = r.nextInt()
    val unsureCount    = r.nextInt()
    val clusterSize    = r.nextInt()

    // Parse comma-separated label IDs and user IDs.
    val labelIds = r.nextString().split(",").map(_.toInt).toSeq
    val userIds  = r.nextString().split(",").toSeq

    val avgLatitude  = r.nextDouble()
    val avgLongitude = r.nextDouble()

    // Parse tag counts JSON object into a Map (e.g., {"narrow": 2} -> Map("narrow" -> 2)).
    val tagCounts =
      r.nextStringOption().map { tagCountsJson => Json.parse(tagCountsJson).as[Map[String, Int]] }.getOrElse(Map.empty)

    // Parse labels if included (only when includeRawLabels=true).
    val labels = if (r.hasMoreColumns) {
      r.nextStringOption().map { labelsJson =>
        implicit val rawLabelReads: Reads[RawLabelInClusterDataForApi] = Json.reads[RawLabelInClusterDataForApi]
        Json.parse(labelsJson).as[Seq[RawLabelInClusterDataForApi]]
      }
    } else {
      None
    }

    LabelClusterForApi(
      labelClusterId = labelClusterId, labelType = labelType, streetEdgeId = streetEdgeId, osmWayId = osmWayId,
      regionId = regionId, regionName = regionName, avgImageCaptureDate = avgImageCaptureDate,
      avgLabelDate = avgLabelDate, medianSeverity = medianSeverity, agreeCount = agreeCount,
      disagreeCount = disagreeCount, unsureCount = unsureCount, clusterSize = clusterSize, labelIds = labelIds,
      userIds = userIds, tagCounts = tagCounts, labels = labels, avgLatitude = avgLatitude, avgLongitude = avgLongitude
    )
  }

  implicit val clusterScoreRowConverter: GetResult[ClusterScoreRow] = GetResult[ClusterScoreRow] { r =>
    ClusterScoreRow(
      streetEdgeId = r.nextInt(),
      labelType = r.nextString(),
      severity = r.nextIntOption(),
      labelCount = r.nextInt(),
      tagCounts = r.nextStringOption().map(json => Json.parse(json).as[Map[String, Int]]).getOrElse(Map.empty)
    )
  }

  def getClusterScoreRows(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      labelTypes: Set[String]
  ): SqlStreamingAction[Vector[ClusterScoreRow], ClusterScoreRow, Effect] = {
    val locationFilter: String = if (spatialQueryType == SpatialQueryType.Region) {
      s"ST_Within(region.geom, ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
    } else {
      s"ST_Intersects(street_edge.geom, ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
    }

    // Restrict to the scored label types. Single-quote-escaped; empty set short-circuits to no rows.
    val labelTypeFilter: String =
      if (labelTypes.isEmpty) "FALSE"
      else s"label_type.label_type IN (${labelTypes.map(lt => s"'${lt.replace("'", "''")}'").mkString(", ")})"

    // Number of member labels per cluster (the denominator for the tag-active threshold).
    val labelCounts =
      """SELECT cluster_label.cluster_id AS cluster_id,
        |       COUNT(label.label_id) AS label_count
        |FROM cluster_label
        |INNER JOIN label ON cluster_label.label_id = label.label_id
        |GROUP BY cluster_label.cluster_id""".stripMargin

    // Per-cluster tag counts as a JSON object (e.g. {"steep": 2, "narrow": 1}), unnesting the label.tags TEXT[] array.
    // Same technique as getLabelClustersV3, kept separate so the access-score query carries only what scoring needs.
    val tagCounts =
      """SELECT cluster.cluster_id AS cluster_id,
        |       COALESCE(jsonb_object_agg(tag_counts.tag, tag_counts.cnt) FILTER (WHERE tag_counts.tag IS NOT NULL), '{}') AS tag_counts
        |FROM cluster
        |LEFT JOIN (
        |    SELECT cluster_label.cluster_id, t.tag, COUNT(*) AS cnt
        |    FROM cluster_label
        |    INNER JOIN label ON cluster_label.label_id = label.label_id
        |    CROSS JOIN LATERAL unnest(label.tags) AS t(tag)
        |    GROUP BY cluster_label.cluster_id, t.tag
        |) tag_counts ON cluster.cluster_id = tag_counts.cluster_id
        |GROUP BY cluster.cluster_id""".stripMargin

    sql"""
      SELECT cluster.street_edge_id,
             label_type.label_type,
             cluster.severity,
             label_counts.label_count,
             cluster_tag_counts.tag_counts
      FROM cluster
      INNER JOIN label_type ON cluster.label_type_id = label_type.label_type_id
      INNER JOIN street_edge ON cluster.street_edge_id = street_edge.street_edge_id
      INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
      INNER JOIN region ON street_edge_region.region_id = region.region_id
      INNER JOIN (#$labelCounts) label_counts ON cluster.cluster_id = label_counts.cluster_id
      INNER JOIN (#$tagCounts) cluster_tag_counts ON cluster.cluster_id = cluster_tag_counts.cluster_id
      WHERE #$labelTypeFilter
          AND #$locationFilter;
    """.as[ClusterScoreRow]
  }

  def getLabelClustersV3(
      filters: LabelClusterFiltersForApi
  ): SqlStreamingAction[Vector[LabelClusterForApi], LabelClusterForApi, Effect] = {
    // Build the base query conditions.
    var whereConditions = Seq(
      "label_type.label_type <> 'Problem'" // Exclude internal-only problem type.
    )

    // Apply location filters based on precedence logic.
    if (filters.bbox.isDefined) {
      val bbox = filters.bbox.get
      whereConditions :+= s"cluster.geom && ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)"
    } else if (filters.regionId.isDefined) {
      whereConditions :+= s"street_edge_region.region_id = ${filters.regionId.get}"
    } else if (filters.regionName.isDefined) {
      whereConditions :+= s"region.name = '${filters.regionName.get.replace("'", "''")}'"
    }

    // Apply the rest of the filters.
    if (filters.labelTypes.isDefined && filters.labelTypes.get.nonEmpty) {
      val labelTypeList = filters.labelTypes.get.map(lt => s"'${lt.replace("'", "''")}'").mkString(", ")
      whereConditions :+= s"label_type.label_type IN ($labelTypeList)"
    }

    if (filters.minClusterSize.isDefined) {
      whereConditions :+= s"label_counts.label_count >= ${filters.minClusterSize.get}"
    }

    if (filters.minAvgImageCaptureDate.isDefined) {
      val dateStr = filters.minAvgImageCaptureDate.get.toString
      whereConditions :+= s"image_capture_dates.avg_capture_date >= '$dateStr'"
    }

    if (filters.minAvgLabelDate.isDefined) {
      val dateStr = filters.minAvgLabelDate.get.toString
      whereConditions :+= s"validation_counts.avg_label_date >= '$dateStr'"
    }

    if (filters.minSeverity.isDefined) {
      whereConditions :+= s"cluster.severity >= ${filters.minSeverity.get}"
    }

    if (filters.maxSeverity.isDefined) {
      whereConditions :+= s"cluster.severity <= ${filters.maxSeverity.get}"
    }

    // Combine all conditions.
    val whereClause = whereConditions.mkString(" AND ")

    // Aggregate per-label data for each cluster: validation counts, dates, label IDs, and user IDs.
    val labelAggregates =
      """SELECT cluster.cluster_id AS cluster_id,
        |       SUM(label.agree_count) AS agree_count,
        |       SUM(label.disagree_count) AS disagree_count,
        |       SUM(label.unsure_count) AS unsure_count,
        |       TO_TIMESTAMP(AVG(extract(epoch from label.time_created))) AS avg_label_date,
        |       COUNT(label.label_id) AS label_count,
        |       array_to_string(array_agg(label.label_id ORDER BY label.label_id), ',') AS label_ids,
        |       array_to_string(array_agg(DISTINCT label.user_id ORDER BY label.user_id), ',') AS users_list
        |FROM cluster
        |INNER JOIN cluster_label ON cluster.cluster_id = cluster_label.cluster_id
        |INNER JOIN label ON cluster_label.label_id = label.label_id
        |GROUP BY cluster.cluster_id""".stripMargin

    // Aggregate tag counts for each cluster as a JSON object (e.g., {"missing tactile warning": 2, "narrow": 1}).
    // Tags are stored as a TEXT[] array on the label table; unnest to count occurrences across labels in each cluster.
    val tagCounts =
      """SELECT cluster.cluster_id AS cluster_id,
        |       COALESCE(jsonb_object_agg(tag_counts.tag, tag_counts.cnt) FILTER (WHERE tag_counts.tag IS NOT NULL), '{}') AS tag_counts
        |FROM cluster
        |LEFT JOIN (
        |    SELECT cluster_label.cluster_id, t.tag, COUNT(*) AS cnt
        |    FROM cluster_label
        |    INNER JOIN label ON cluster_label.label_id = label.label_id
        |    CROSS JOIN LATERAL unnest(label.tags) AS t(tag)
        |    GROUP BY cluster_label.cluster_id, t.tag
        |) tag_counts ON cluster.cluster_id = tag_counts.cluster_id
        |GROUP BY cluster.cluster_id""".stripMargin

    // Compute the average image capture date per cluster by first averaging per pano, then averaging those.
    val avgImageCaptureDates =
      """SELECT capture_dates.cluster_id AS cluster_id,
        |       TO_TIMESTAMP(AVG(EXTRACT(epoch from capture_dates.capture_date))) AS avg_capture_date
        |FROM (
        |    SELECT cluster.cluster_id,
        |           TO_TIMESTAMP(AVG(EXTRACT(epoch from TO_DATE(pano_data.capture_date, 'YYYY-MM')))) AS capture_date
        |    FROM cluster
        |    INNER JOIN cluster_label ON cluster.cluster_id = cluster_label.cluster_id
        |    INNER JOIN label ON cluster_label.label_id = label.label_id
        |    INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
        |    GROUP BY cluster.cluster_id, pano_data.pano_id
        |) capture_dates
        |GROUP BY capture_dates.cluster_id""".stripMargin

    // Base query for label clusters.
    var finalQuery = s"""
    SELECT cluster.cluster_id AS label_cluster_id,
          label_type.label_type,
          cluster.street_edge_id,
          osm_way_street_edge.osm_way_id,
          street_edge_region.region_id,
          region.name AS region_name,
          avg_image_capture_dates.avg_capture_date AS avg_image_capture_date,
          label_aggregates.avg_label_date,
          cluster.severity,
          label_aggregates.agree_count,
          label_aggregates.disagree_count,
          label_aggregates.unsure_count,
          label_aggregates.label_count AS cluster_size,
          label_aggregates.label_ids,
          label_aggregates.users_list,
          ST_Y(cluster.geom) AS lat,
          ST_X(cluster.geom) AS lng,
          cluster_tag_counts.tag_counts
    FROM cluster
    INNER JOIN label_type ON cluster.label_type_id = label_type.label_type_id
    INNER JOIN street_edge ON cluster.street_edge_id = street_edge.street_edge_id
    INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
    INNER JOIN region ON street_edge_region.region_id = region.region_id
    INNER JOIN osm_way_street_edge ON cluster.street_edge_id = osm_way_street_edge.street_edge_id
    INNER JOIN (${labelAggregates}) label_aggregates ON cluster.cluster_id = label_aggregates.cluster_id
    INNER JOIN (${avgImageCaptureDates}) avg_image_capture_dates ON cluster.cluster_id = avg_image_capture_dates.cluster_id
    INNER JOIN (${tagCounts}) cluster_tag_counts ON cluster.cluster_id = cluster_tag_counts.cluster_id
    WHERE ${whereClause}
    ORDER BY cluster.cluster_id
    """

    // If includeRawLabels is true, modify the query to fetch raw label data.
    if (filters.includeRawLabels) {
      finalQuery = s"""
        WITH base_query AS (
          ${finalQuery}
        )
        SELECT base_query.*,
               COALESCE(jsonb_agg(
                   jsonb_build_object(
                       'labelId', l.label_id,
                       'userId', l.user_id,
                       'panoId', l.pano_id,
                       'severity', l.severity,
                       'timeCreated', l.time_created,
                       'latitude', lp.lat,
                       'longitude', lp.lng,
                       'correct', l.correct,
                       'imageCaptureDate', gd.capture_date
                   )
               ) FILTER (WHERE l.label_id IS NOT NULL), '[]') AS raw_labels
        FROM base_query
        LEFT JOIN cluster_label cl ON base_query.label_cluster_id = cl.cluster_id
        LEFT JOIN label l ON cl.label_id = l.label_id
        LEFT JOIN label_point lp ON l.label_id = lp.label_id
        LEFT JOIN pano_data gd ON l.pano_id = gd.pano_id
        GROUP BY
            base_query.label_cluster_id,
            base_query.label_type,
            base_query.street_edge_id,
            base_query.osm_way_id,
            base_query.region_id,
            base_query.region_name,
            base_query.avg_image_capture_date,
            base_query.avg_label_date,
            base_query.severity,
            base_query.agree_count,
            base_query.disagree_count,
            base_query.unsure_count,
            base_query.cluster_size,
            base_query.label_ids,
            base_query.users_list,
            base_query.lat,
            base_query.lng,
            base_query.tag_counts
      """
    }

    sql"""#$finalQuery""".as[LabelClusterForApi]
  }

  def countClusters: DBIO[Int] = {
    clusters.length.result
  }

  def saveMultiple(newClusters: Seq[Cluster]): DBIO[Seq[Int]] = {
    (clusters returning clusters.map(_.clusterId)) ++= newClusters
  }
}
