package models.cluster

import com.google.inject.ImplementedBy
import formats.json.ApiFormats
import models.api.{LabelClusterFiltersForApi, LabelClusterForApi, RawLabelInClusterDataForApi}
import models.computation.StreamingApiType
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

case class ClusterForApi(
    clusterId: Int,
    labelType: String,
    geom: Point,
    severity: Option[Int],
    agreeCount: Int,
    disagreeCount: Int,
    unsureCount: Int,
    streetEdgeId: Int,
    osmStreetId: Long,
    neighborhoodName: String,
    avgImageCaptureDate: OffsetDateTime,
    avgLabelDate: OffsetDateTime,
    imageCount: Int,
    labelCount: Int,
    usersList: Seq[String]
) extends StreamingApiType {
  def toJson: JsObject = ApiFormats.clusterToJson(this)
  def toCsvRow: String = ApiFormats.clusterToCsvRow(this)
}

object ClusterForApi {
  val csvHeader: String = "Attribute ID,Label Type,Street ID,OSM Street ID,Neighborhood Name,Cluster Latitude," +
    "Cluster Longitude,Avg Image Capture Date,Avg Label Date,Severity,Agree Count,Disagree Count,Unsure Count," +
    "Cluster Size,User IDs\n"
}

class ClusterTableDef(tag: slick.lifted.Tag) extends Table[Cluster](tag, "cluster") {
  def clusterId: Rep[Int]           = column[Int]("cluster_id", O.PrimaryKey, O.AutoInc)
  def clusteringSessionId: Rep[Int] = column[Int]("clustering_session_id")
  def labelTypeId: Rep[Int]         = column[Int]("label_type_id")
  def streetEdgeId: Rep[Int]        = column[Int]("street_edge_id")
  def geom: Rep[Point]           = column[Point]("geom")
  def severity: Rep[Option[Int]] = column[Option[Int]]("severity")

  def * = (clusterId, clusteringSessionId, labelTypeId, streetEdgeId, geom, severity) <> (
    (Cluster.apply _).tupled,
    Cluster.unapply
  )

//  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
//    foreignKey("cluster_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTableDef])(_.labelTypeId)
//
//  def clusteringSession: ForeignKeyQuery[ClusteringSessionTable, ClusteringSession] =
//    foreignKey("cluster_clustering_session_id_fkey", clusteringSessionId, TableQuery[ClusteringSessionTableDef])(_.clusteringSessionId)
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
   * Gets clusters within a bounding box for the public API.
   */
  def getClustersInBoundingBox(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      severity: Option[String]
  ): SqlStreamingAction[Vector[ClusterForApi], ClusterForApi, Effect]

  def countClusters: DBIO[Int]

  def saveMultiple(newClusters: Seq[Cluster]): DBIO[Seq[Int]]
}

@Singleton
class ClusterTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends ClusterTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val clusters: TableQuery[ClusterTableDef] = TableQuery[ClusterTableDef]

  implicit val ClusterForApiConverter: GetResult[ClusterForApi] = GetResult[ClusterForApi](r =>
    ClusterForApi(
      r.nextInt(),
      r.nextString(),
      r.nextGeometry[Point](),
      r.nextIntOption(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextLong(),
      r.nextString(),
      OffsetDateTime.ofInstant(r.nextTimestamp().toInstant, ZoneOffset.UTC),
      OffsetDateTime.ofInstant(r.nextTimestamp().toInstant, ZoneOffset.UTC),
      r.nextInt(),
      r.nextInt(),
      r.nextString().split(",").toSeq.distinct
    )
  )

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

    // Parse user IDs and remove duplicates.
    val userIds = r.nextString().split(",").toSeq.distinct

    val avgLatitude  = r.nextDouble()
    val avgLongitude = r.nextDouble()

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
      disagreeCount = disagreeCount, unsureCount = unsureCount, clusterSize = clusterSize, userIds = userIds,
      labels = labels, avgLatitude = avgLatitude, avgLongitude = avgLongitude
    )
  }

  private def toInt(s: Option[String]): Option[Int] = {
    try { Some(s.getOrElse("-1").toInt) }
    catch { case e: Exception => None }
  }

  def getClustersInBoundingBox(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      severity: Option[String]
  ): SqlStreamingAction[Vector[ClusterForApi], ClusterForApi, Effect] = {
    val locationFilter: String = if (spatialQueryType == SpatialQueryType.Region) {
      s"ST_Within(region.geom, ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
    } else if (spatialQueryType == SpatialQueryType.Street) {
      s"ST_Intersects(street_edge.geom, ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
    } else {
      s"cluster.geom && ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)"
    }

    // Sum the validations counts, average date, and the number of the labels that make up each cluster.
    val validationCounts =
      """SELECT cluster.cluster_id AS cluster_id,
        |       SUM(label.agree_count) AS agree_count,
        |       SUM(label.disagree_count) AS disagree_count,
        |       SUM(label.unsure_count) AS unsure_count,
        |       TO_TIMESTAMP(AVG(extract(epoch from label.time_created))) AS avg_label_date,
        |       COUNT(label.label_id) AS label_count
        |FROM cluster
        |INNER JOIN cluster_label ON cluster.cluster_id = cluster_label.cluster_id
        |INNER JOIN label ON cluster_label.label_id = label.label_id
        |GROUP BY cluster.cluster_id""".stripMargin

    // Select the average image date and number of images for each cluster. Subquery selects the dates of all images of
    // interest and a list of user_ids associated with the cluster, once per cluster. The users_list might have
    // duplicate id's, but we fix this in the `ClusterForApiConverter`.
    val imageCaptureDatesAndUserIds =
      """SELECT capture_dates.cluster_id AS cluster_id,
        |       TO_TIMESTAMP(AVG(EXTRACT(epoch from capture_dates.capture_date))) AS avg_capture_date,
        |       COUNT(capture_dates.capture_date) AS image_count,
        |       string_agg(capture_dates.users_list, ',') AS users_list
        |FROM (
        |    SELECT cluster.cluster_id,
        |           TO_TIMESTAMP(AVG(EXTRACT(epoch from CAST(gsv_data.capture_date || '-01' AS DATE)))) AS capture_date,
        |           array_to_string(array_agg(DISTINCT label.user_id), ',') AS users_list
        |    FROM cluster
        |    INNER JOIN cluster_label ON cluster.cluster_id = cluster_label.cluster_id
        |    INNER JOIN label ON cluster_label.label_id = label.label_id
        |    INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
        |    GROUP BY cluster.cluster_id, gsv_data.gsv_panorama_id
        |) capture_dates
        |GROUP BY capture_dates.cluster_id""".stripMargin

    sql"""
      SELECT cluster.cluster_id,
             label_type.label_type,
             cluster.geom,
             cluster.severity,
             validation_counts.agree_count,
             validation_counts.disagree_count,
             validation_counts.unsure_count,
             cluster.street_edge_id,
             osm_way_street_edge.osm_way_id,
             region.name,
             image_capture_dates.avg_capture_date,
             validation_counts.avg_label_date,
             validation_counts.label_count,
             image_capture_dates.image_count,
             image_capture_dates.users_list
      FROM cluster
      INNER JOIN label_type ON cluster.label_type_id = label_type.label_type_id
      INNER JOIN street_edge ON cluster.street_edge_id = street_edge.street_edge_id
      INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
      INNER JOIN region ON street_edge_region.region_id = region.region_id
      INNER JOIN osm_way_street_edge ON cluster.street_edge_id = osm_way_street_edge.street_edge_id
      INNER JOIN (#$validationCounts) validation_counts ON cluster.cluster_id = validation_counts.cluster_id
      INNER JOIN (#$imageCaptureDatesAndUserIds) image_capture_dates ON cluster.cluster_id = image_capture_dates.cluster_id
      WHERE label_type.label_type <> 'Problem'
          AND #$locationFilter
          AND (
              cluster.severity IS NULL
                  AND #${severity.getOrElse("") == "none"}
                  OR #${severity.isEmpty}
                  OR cluster.severity = #${toInt(severity).getOrElse(-1)}
              );
    """.as[ClusterForApi]
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
      val labelTypeList = filters.labelTypes.get.map(lt => s"'$lt'").mkString(", ")
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

    // Sum the validations counts, average date, and the number of the labels that make up each cluster.
    val validationCounts =
      """SELECT cluster.cluster_id AS cluster_id,
        |       SUM(label.agree_count) AS agree_count,
        |       SUM(label.disagree_count) AS disagree_count,
        |       SUM(label.unsure_count) AS unsure_count,
        |       TO_TIMESTAMP(AVG(extract(epoch from label.time_created))) AS avg_label_date,
        |       COUNT(label.label_id) AS label_count
        |FROM cluster
        |INNER JOIN cluster_label ON cluster.cluster_id = cluster_label.cluster_id
        |INNER JOIN label ON cluster_label.label_id = label.label_id
        |GROUP BY cluster.cluster_id""".stripMargin

    // Select the average image date and number of images for each cluster.
    val imageCaptureDatesAndUserIds =
      """SELECT capture_dates.cluster_id AS cluster_id,
        |       TO_TIMESTAMP(AVG(EXTRACT(epoch from capture_dates.capture_date))) AS avg_capture_date,
        |       COUNT(capture_dates.capture_date) AS image_count,
        |       string_agg(capture_dates.users_list, ',') AS users_list
        |FROM (
        |    SELECT cluster.cluster_id,
        |           TO_TIMESTAMP(AVG(EXTRACT(epoch from CAST(gsv_data.capture_date || '-01' AS DATE)))) AS capture_date,
        |           array_to_string(array_agg(DISTINCT label.user_id), ',') AS users_list
        |    FROM cluster
        |    INNER JOIN cluster_label ON cluster.cluster_id = cluster_label.cluster_id
        |    INNER JOIN label ON cluster_label.label_id = label.label_id
        |    INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
        |    GROUP BY cluster.cluster_id, gsv_data.gsv_panorama_id
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
          image_capture_dates.avg_capture_date AS avg_image_capture_date,
          validation_counts.avg_label_date,
          cluster.severity,
          validation_counts.agree_count,
          validation_counts.disagree_count,
          validation_counts.unsure_count,
          validation_counts.label_count AS cluster_size,
          image_capture_dates.users_list,
          ST_Y(cluster.geom) AS lat,
          ST_X(cluster.geom) AS lng
    FROM cluster
    INNER JOIN label_type ON cluster.label_type_id = label_type.label_type_id
    INNER JOIN street_edge ON cluster.street_edge_id = street_edge.street_edge_id
    INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
    INNER JOIN region ON street_edge_region.region_id = region.region_id
    INNER JOIN osm_way_street_edge ON cluster.street_edge_id = osm_way_street_edge.street_edge_id
    INNER JOIN (${validationCounts}) validation_counts ON cluster.cluster_id = validation_counts.cluster_id
    INNER JOIN (${imageCaptureDatesAndUserIds}) image_capture_dates ON cluster.cluster_id = image_capture_dates.cluster_id
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
                       'gsvPanoramaId', l.gsv_panorama_id,
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
        LEFT JOIN gsv_data gd ON l.gsv_panorama_id = gd.gsv_panorama_id
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
            base_query.users_list,
            base_query.lat,
            base_query.lng
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
