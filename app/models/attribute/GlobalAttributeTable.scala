package models.attribute

import com.google.inject.ImplementedBy
import models.utils.SpatialQueryType
import models.utils.SpatialQueryType.SpatialQueryType
import models.utils.LatLngBBox
import models.api.{LabelClusterForApi, RawLabelInClusterDataForApi, LabelClusterFiltersForApi}
import models.computation.StreamingApiType
import formats.json.ApiFormats
import models.label._
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.JsObject
import service.GsvDataService
import slick.jdbc.{GetResult, PositionedParameters, SQLActionBuilder}
import slick.sql.SqlStreamingAction
import slick.dbio.Effect

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}

case class GlobalAttribute(globalAttributeId: Int, globalClusteringSessionId: Int, clusteringThreshold: Float,
                           labelTypeId: Int, streetEdgeId: Int, regionId: Int, lat: Float, lng: Float,
                           severity: Option[Int], temporary: Boolean)

case class GlobalAttributeForApi(globalAttributeId: Int, labelType: String, lat: Float, lng: Float,
                                 severity: Option[Int], temporary: Boolean, agreeCount: Int, disagreeCount: Int,
                                 unsureCount: Int, streetEdgeId: Int, osmStreetId: Long, neighborhoodName: String,
                                 avgImageCaptureDate: OffsetDateTime, avgLabelDate: OffsetDateTime, imageCount: Int,
                                 labelCount: Int, usersList: Seq[String]) extends StreamingApiType {
  def toJSON: JsObject = ApiFormats.globalAttributeToJSON(this)
  def toCSVRow: String = ApiFormats.globalAttributeToCSVRow(this)
}

object GlobalAttributeForApi {
  val csvHeader: String = {
    "Attribute ID,Label Type,Street ID,OSM Street ID,Neighborhood Name,Attribute Latitude,Attribute Longitude," +
      "Avg Image Capture Date,Avg Label Date,Severity,Temporary,Agree Count,Disagree Count,Unsure Count,Cluster Size," +
      "User IDs\n"
  }
}

case class GlobalAttributeWithLabelForApi(globalAttributeId: Int, labelType: String, attributeLatLng: (Float, Float),
                                          attributeSeverity: Option[Int], attributeTemporary: Boolean,
                                          streetEdgeId: Int, osmStreetId: Long, neighborhoodName: String, labelId: Int,
                                          labelLatLng: (Float, Float), gsvPanoramaId: String, pov: POV,
                                          canvasXY: LocationXY, agreeDisagreeUnsureCount: (Int, Int, Int),
                                          labelSeverity: Option[Int], labelTemporary: Boolean,
                                          imageLabelDates: (String, OffsetDateTime), labelTags: List[String],
                                          labelDescription: Option[String], userId: String) extends StreamingApiType {
  val gsvUrl = s"""https://maps.googleapis.com/maps/api/streetview?
                  |size=${LabelPointTable.canvasWidth}x${LabelPointTable.canvasHeight}
                  |&pano=${gsvPanoramaId}
                  |&heading=${pov.heading}
                  |&pitch=${pov.pitch}
                  |&fov=${GsvDataService.getFov(pov.zoom)}
                  |&key=YOUR_API_KEY
                  |&signature=YOUR_SIGNATURE""".stripMargin.replaceAll("\n", "")
  def toJSON: JsObject = ApiFormats.globalAttributeWithLabelToJSON(this)
  def toCSVRow: String = ApiFormats.globalAttributeWithLabelToCSVRow(this)
}

object GlobalAttributeWithLabelForApi {
  val csvHeader: String = {
    "Attribute ID,Label Type,Attribute Severity,Attribute Temporary,Street ID,OSM Street ID,Neighborhood Name," +
      "Label ID,Panorama ID,Attribute Latitude,Attribute Longitude,Label Latitude,Label Longitude,Heading,Pitch,Zoom," +
      "Canvas X,Canvas Y,Canvas Width,Canvas Height,GSV URL,Image Capture Date,Label Date,Label Severity," +
      "Label Temporary,Agree Count,Disagree Count,Unsure Count,Label Tags,Label Description,User ID\n"
  }
}

class GlobalAttributeTableDef(tag: slick.lifted.Tag) extends Table[GlobalAttribute](tag, "global_attribute") {
  def globalAttributeId: Rep[Int] = column[Int]("global_attribute_id", O.PrimaryKey, O.AutoInc)
  def globalClusteringSessionId: Rep[Int] = column[Int]("global_clustering_session_id")
  def clusteringThreshold: Rep[Float] = column[Float]("clustering_threshold")
  def labelTypeId: Rep[Int] = column[Int]("label_type_id")
  def streetEdgeId: Rep[Int] = column[Int]("street_edge_id")
  def regionId: Rep[Int] = column[Int]("region_id")
  def lat: Rep[Float] = column[Float]("lat")
  def lng: Rep[Float] = column[Float]("lng")
  def severity: Rep[Option[Int]] = column[Option[Int]]("severity")
  def temporary: Rep[Boolean] = column[Boolean]("temporary")

  def * = (globalAttributeId, globalClusteringSessionId, clusteringThreshold, labelTypeId, streetEdgeId, regionId,
    lat, lng, severity, temporary) <> ((GlobalAttribute.apply _).tupled, GlobalAttribute.unapply)

//  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
//    foreignKey("global_attribute_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTableDef])(_.labelTypeId)
//
//  def region: ForeignKeyQuery[RegionTable, Region] =
//    foreignKey("global_attribute_region_id_fkey", regionId, TableQuery[RegionTableDef])(_.regionId)
//
//  def globalClusteringSession: ForeignKeyQuery[GlobalClusteringSessionTable, GlobalClusteringSession] =
//    foreignKey("global_attribute_global_clustering_session_id_fkey", globalClusteringSessionId, TableQuery[GlobalClusteringSessionTableDef])(_.globalClusteringSessionId)
}

@ImplementedBy(classOf[GlobalAttributeTable])
trait GlobalAttributeTableRepository { }

@Singleton
class GlobalAttributeTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)
  extends GlobalAttributeTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  val globalAttributes: TableQuery[GlobalAttributeTableDef] = TableQuery[GlobalAttributeTableDef]

  implicit val GlobalAttributeForApiConverter: GetResult[GlobalAttributeForApi] = GetResult[GlobalAttributeForApi](r =>
    GlobalAttributeForApi(
      r.nextInt(), r.nextString(), r.nextFloat(), r.nextFloat(), r.nextIntOption(), r.nextBoolean(), r.nextInt(),
      r.nextInt(), r.nextInt(), r.nextInt(), r.nextLong(), r.nextString(),
      OffsetDateTime.ofInstant(r.nextTimestamp().toInstant, ZoneOffset.UTC),
      OffsetDateTime.ofInstant(r.nextTimestamp().toInstant, ZoneOffset.UTC), r.nextInt(), r.nextInt(),
      r.nextString().split(",").toSeq.distinct
    )
  )

  implicit val GlobalAttributeWithLabelForApiConverter: GetResult[GlobalAttributeWithLabelForApi] = GetResult[GlobalAttributeWithLabelForApi](r =>
    GlobalAttributeWithLabelForApi(
      r.nextInt(), r.nextString(), (r.nextFloat(), r.nextFloat()), r.nextIntOption(), r.nextBoolean(), r.nextInt(),
      r.nextLong(), r.nextString(), r.nextInt(), (r.nextFloat(), r.nextFloat()), r.nextString(),
      POV(r.nextDouble(), r.nextDouble(), r.nextInt()), LocationXY(r.nextInt(), r.nextInt()),
      (r.nextInt(), r.nextInt(), r.nextInt()), r.nextIntOption(), r.nextBoolean(),
      (r.nextString(), OffsetDateTime.ofInstant(r.nextTimestamp().toInstant, ZoneOffset.UTC)),
      r.nextStringOption().map(tags => tags.split(",").toList).getOrElse(List()), r.nextStringOption(), r.nextString()
    )
  )

  // Create an implicit converter for LabelClusterForApi
  implicit val labelClusterForApiConverter: GetResult[LabelClusterForApi] = GetResult[LabelClusterForApi] { r =>
    val labelClusterId = r.nextInt()
    val labelType = r.nextString()
    val streetEdgeId = r.nextInt()
    val osmStreetId = r.nextLong()
    val regionId = r.nextInt()
    val regionName = r.nextString()
    
    // Parse dates with null handling
    val avgImageCaptureDate = r.nextTimestampOption().map(ts => 
      OffsetDateTime.ofInstant(ts.toInstant, ZoneOffset.UTC))
    
    val avgLabelDate = r.nextTimestampOption().map(ts => 
      OffsetDateTime.ofInstant(ts.toInstant, ZoneOffset.UTC))
    
    val medianSeverity = r.nextIntOption()
    val isTemporary = r.nextBoolean()
    val agreeCount = r.nextInt()
    val disagreeCount = r.nextInt()
    val unsureCount = r.nextInt()
    val clusterSize = r.nextInt()
    
    // Parse user IDs and remove duplicates
    val userIds = r.nextString().split(",").toSeq.distinct
    
    val avgLatitude = r.nextDouble()
    val avgLongitude = r.nextDouble()
    
    // Parse labels if included (only when includeRawLabels=true)
    val labels = if (r.hasMoreColumns) {
      import play.api.libs.json._
      
      r.nextStringOption().map { labelsJson =>
        implicit val rawLabelReads = Json.reads[RawLabelInClusterDataForApi]
        Json.parse(labelsJson).as[Seq[RawLabelInClusterDataForApi]]
      }
    } else {
      None
    }
    
    LabelClusterForApi(
      labelClusterId = labelClusterId,
      labelType = labelType,
      streetEdgeId = streetEdgeId,
      osmStreetId = osmStreetId,
      regionId = regionId,
      regionName = regionName,
      avgImageCaptureDate = avgImageCaptureDate,
      avgLabelDate = avgLabelDate,
      medianSeverity = medianSeverity,
      agreeCount = agreeCount,
      disagreeCount = disagreeCount,
      unsureCount = unsureCount,
      clusterSize = clusterSize,
      userIds = userIds,
      labels = labels,
      avgLatitude = avgLatitude,
      avgLongitude = avgLongitude
    )
  }

  def getAllGlobalAttributes: DBIO[Seq[GlobalAttribute]] = {
    globalAttributes.result
  }

  def toInt(s: Option[String]): Option[Int] = {
    try { Some(s.getOrElse("-1").toInt) }
    catch { case e: Exception => None }
  }

  /**
   * Gets global attributes within a bounding box for the public API.
   */
  def getAttributesInBoundingBox(spatialQueryType: SpatialQueryType, bbox: LatLngBBox, severity: Option[String]): SqlStreamingAction[Vector[GlobalAttributeForApi], GlobalAttributeForApi, Effect] = {
    val locationFilter: String = if (spatialQueryType == SpatialQueryType.Region) {
      s"ST_Within(region.geom, ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
    } else if (spatialQueryType == SpatialQueryType.Street) {
      s"ST_Intersects(street_edge.geom, ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
    } else {
      s"global_attribute.lat > ${bbox.minLat} AND global_attribute.lat < ${bbox.maxLat} AND global_attribute.lng > ${bbox.minLng} AND global_attribute.lng < ${bbox.maxLng}"
    }

    // Sum the validations counts, average date, and the number of the labels that make up each global attribute.
    val validationCounts =
      """SELECT global_attribute.global_attribute_id AS global_attribute_id,
        |       SUM(label.agree_count) AS agree_count,
        |       SUM(label.disagree_count) AS disagree_count,
        |       SUM(label.unsure_count) AS unsure_count,
        |       TO_TIMESTAMP(AVG(extract(epoch from label.time_created))) AS avg_label_date,
        |       COUNT(label.label_id) AS label_count
        |FROM global_attribute
        |INNER JOIN global_attribute_user_attribute ON global_attribute.global_attribute_id = global_attribute_user_attribute.global_attribute_id
        |INNER JOIN user_attribute_label ON global_attribute_user_attribute.user_attribute_id = user_attribute_label.user_attribute_id
        |INNER JOIN label ON user_attribute_label.label_id = label.label_id
        |GROUP BY global_attribute.global_attribute_id""".stripMargin
    // Select the average image date and number of images for each attribute. Subquery selects the dates of all images
    // of interest and a list of user_ids associated with the attribute, once per attribute. The users_list might have
    // duplicate id's, but we fix this in the `GlobalAttributeForApiConverter`.
    val imageCaptureDatesAndUserIds =
      """SELECT capture_dates.global_attribute_id AS global_attribute_id,
        |       TO_TIMESTAMP(AVG(EXTRACT(epoch from capture_dates.capture_date))) AS avg_capture_date,
        |       COUNT(capture_dates.capture_date) AS image_count,
        |       string_agg(capture_dates.users_list, ',') AS users_list
        |FROM (
        |    SELECT global_attribute.global_attribute_id,
        |           TO_TIMESTAMP(AVG(EXTRACT(epoch from CAST(gsv_data.capture_date || '-01' AS DATE)))) AS capture_date,
        |           array_to_string(array_agg(DISTINCT label.user_id), ',') AS users_list
        |    FROM global_attribute
        |    INNER JOIN global_attribute_user_attribute ON global_attribute.global_attribute_id = global_attribute_user_attribute.global_attribute_id
        |    INNER JOIN user_attribute_label ON global_attribute_user_attribute.user_attribute_id = user_attribute_label.user_attribute_id
        |    INNER JOIN label ON user_attribute_label.label_id = label.label_id
        |    INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
        |    GROUP BY global_attribute.global_attribute_id, gsv_data.gsv_panorama_id
        |) capture_dates
        |GROUP BY capture_dates.global_attribute_id""".stripMargin

    sql"""
      SELECT global_attribute.global_attribute_id,
             label_type.label_type,
             global_attribute.lat,
             global_attribute.lng,
             global_attribute.severity,
             global_attribute.temporary,
             validation_counts.agree_count,
             validation_counts.disagree_count,
             validation_counts.unsure_count,
             global_attribute.street_edge_id,
             osm_way_street_edge.osm_way_id,
             region.name,
             image_capture_dates.avg_capture_date,
             validation_counts.avg_label_date,
             validation_counts.label_count,
             image_capture_dates.image_count,
             image_capture_dates.users_list
      FROM global_attribute
      INNER JOIN label_type ON global_attribute.label_type_id = label_type.label_type_id
      INNER JOIN street_edge ON global_attribute.street_edge_id = street_edge.street_edge_id
      INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
      INNER JOIN region ON street_edge_region.region_id = region.region_id
      INNER JOIN osm_way_street_edge ON global_attribute.street_edge_id = osm_way_street_edge.street_edge_id
      INNER JOIN (#$validationCounts) validation_counts ON global_attribute.global_attribute_id = validation_counts.global_attribute_id
      INNER JOIN (#$imageCaptureDatesAndUserIds) image_capture_dates ON global_attribute.global_attribute_id = image_capture_dates.global_attribute_id
      WHERE label_type.label_type <> 'Problem'
          AND #$locationFilter
          AND (
              global_attribute.severity IS NULL
                  AND #${severity.getOrElse("") == "none"}
                  OR #${severity.isEmpty}
                  OR global_attribute.severity = #${toInt(severity).getOrElse(-1)}
              );
    """.as[GlobalAttributeForApi]
  }

  /**
   * Gets global attributes within a bounding box with the labels that make up those attributes for the public API.
   */
  def getGlobalAttributesWithLabelsInBoundingBox(bbox: LatLngBBox, severity: Option[String]): SqlStreamingAction[Vector[GlobalAttributeWithLabelForApi], GlobalAttributeWithLabelForApi, Effect] = {
    sql"""
      SELECT global_attribute.global_attribute_id,
             label_type.label_type,
             global_attribute.lat,
             global_attribute.lng,
             global_attribute.severity,
             global_attribute.temporary,
             global_attribute.street_edge_id,
             osm_way_street_edge.osm_way_id,
             region.name,
             label.label_id,
             label_point.lat,
             label_point.lng,
             label.gsv_panorama_id,
             label_point.heading,
             label_point.pitch,
             label_point.zoom,
             label_point.canvas_x,
             label_point.canvas_y,
             label.agree_count,
             label.disagree_count,
             label.unsure_count,
             label.severity,
             label.temporary,
             gsv_data.capture_date,
             label.time_created,
             array_to_string(label.tags, ','),
             label.description,
             label.user_id
      FROM global_attribute
      INNER JOIN label_type ON global_attribute.label_type_id = label_type.label_type_id
      INNER JOIN region ON global_attribute.region_id = region.region_id
      INNER JOIN global_attribute_user_attribute ON global_attribute.global_attribute_id = global_attribute_user_attribute.global_attribute_id
      INNER JOIN user_attribute_label ON global_attribute_user_attribute.user_attribute_id = user_attribute_label.user_attribute_id
      INNER JOIN label ON user_attribute_label.label_id = label.label_id
      INNER JOIN label_point ON label.label_id = label_point.label_id
      INNER JOIN osm_way_street_edge ON global_attribute.street_edge_id = osm_way_street_edge.street_edge_id
      INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
      WHERE label_type.label_type <> 'Problem'
          AND global_attribute.lat > #${bbox.minLat}
          AND global_attribute.lat < #${bbox.maxLat}
          AND global_attribute.lng > #${bbox.minLng}
          AND global_attribute.lng < #${bbox.maxLng}
          AND (global_attribute.severity IS NULL
               AND #${severity.getOrElse("") == "none"}
               OR #${severity.isEmpty}
               OR global_attribute.severity = #${toInt(severity).getOrElse(-1)}
              )
      ORDER BY user_attribute_label_id;""".as[GlobalAttributeWithLabelForApi]
  }

  /**
   * Gets label clusters based on the provided filter criteria for the v3 API.
   *
   * @param filters The filter criteria to apply to the query
   * @return A database streaming action that yields LabelClusterForApi objects
   */
  def getLabelClustersV3(filters: LabelClusterFiltersForApi): SqlStreamingAction[Vector[LabelClusterForApi], LabelClusterForApi, Effect] = {
    // Build the base query conditions
    var whereConditions = Seq(
      "label_type.label_type <> 'Problem'"  // Exclude internal-only problem type
    )
    
    // Apply location filters based on precedence logic
    if (filters.bbox.isDefined) {
      val bbox = filters.bbox.get
      whereConditions :+= s"global_attribute.lat > ${bbox.minLat}"
      whereConditions :+= s"global_attribute.lat < ${bbox.maxLat}"
      whereConditions :+= s"global_attribute.lng > ${bbox.minLng}"
      whereConditions :+= s"global_attribute.lng < ${bbox.maxLng}"
    } else if (filters.regionId.isDefined) {
      whereConditions :+= s"global_attribute.region_id = ${filters.regionId.get}"
    } else if (filters.regionName.isDefined) {
      whereConditions :+= s"region.name = '${filters.regionName.get.replace("'", "''")}'"
    }
    
    // Apply the rest of the filters
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
      whereConditions :+= s"global_attribute.severity >= ${filters.minSeverity.get}"
    }
    
    if (filters.maxSeverity.isDefined) {
      whereConditions :+= s"global_attribute.severity <= ${filters.maxSeverity.get}"
    }
    
    // Combine all conditions
    val whereClause = whereConditions.mkString(" AND ")
    
    // Sum the validations counts, average date, and the number of the labels that make up each global attribute.
    val validationCounts =
      """SELECT global_attribute.global_attribute_id AS global_attribute_id,
        |       SUM(label.agree_count) AS agree_count,
        |       SUM(label.disagree_count) AS disagree_count,
        |       SUM(label.unsure_count) AS unsure_count,
        |       TO_TIMESTAMP(AVG(extract(epoch from label.time_created))) AS avg_label_date,
        |       COUNT(label.label_id) AS label_count
        |FROM global_attribute
        |INNER JOIN global_attribute_user_attribute ON global_attribute.global_attribute_id = global_attribute_user_attribute.global_attribute_id
        |INNER JOIN user_attribute_label ON global_attribute_user_attribute.user_attribute_id = user_attribute_label.user_attribute_id
        |INNER JOIN label ON user_attribute_label.label_id = label.label_id
        |GROUP BY global_attribute.global_attribute_id""".stripMargin
    
    // Select the average image date and number of images for each attribute
    val imageCaptureDatesAndUserIds =
      """SELECT capture_dates.global_attribute_id AS global_attribute_id,
        |       TO_TIMESTAMP(AVG(EXTRACT(epoch from capture_dates.capture_date))) AS avg_capture_date,
        |       COUNT(capture_dates.capture_date) AS image_count,
        |       string_agg(capture_dates.users_list, ',') AS users_list
        |FROM (
        |    SELECT global_attribute.global_attribute_id,
        |           TO_TIMESTAMP(AVG(EXTRACT(epoch from CAST(gsv_data.capture_date || '-01' AS DATE)))) AS capture_date,
        |           array_to_string(array_agg(DISTINCT label.user_id), ',') AS users_list
        |    FROM global_attribute
        |    INNER JOIN global_attribute_user_attribute ON global_attribute.global_attribute_id = global_attribute_user_attribute.global_attribute_id
        |    INNER JOIN user_attribute_label ON global_attribute_user_attribute.user_attribute_id = user_attribute_label.user_attribute_id
        |    INNER JOIN label ON user_attribute_label.label_id = label.label_id
        |    INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
        |    GROUP BY global_attribute.global_attribute_id, gsv_data.gsv_panorama_id
        |) capture_dates
        |GROUP BY capture_dates.global_attribute_id""".stripMargin
    
    // Base query for label clusters with proper string interpolation
    var finalQuery = s"""
    SELECT global_attribute.global_attribute_id AS label_cluster_id,
          label_type.label_type,
          global_attribute.street_edge_id,
          osm_way_street_edge.osm_way_id,
          global_attribute.region_id,
          region.name AS region_name,
          image_capture_dates.avg_capture_date AS avg_image_capture_date,
          validation_counts.avg_label_date,
          global_attribute.severity,
          global_attribute.temporary AS is_temporary,
          validation_counts.agree_count,
          validation_counts.disagree_count,
          validation_counts.unsure_count,
          validation_counts.label_count AS cluster_size,
          image_capture_dates.users_list,
          global_attribute.lat,
          global_attribute.lng
    FROM global_attribute
    INNER JOIN label_type ON global_attribute.label_type_id = label_type.label_type_id
    INNER JOIN street_edge ON global_attribute.street_edge_id = street_edge.street_edge_id
    INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
    INNER JOIN region ON street_edge_region.region_id = region.region_id
    INNER JOIN osm_way_street_edge ON global_attribute.street_edge_id = osm_way_street_edge.street_edge_id
    INNER JOIN (${validationCounts}) validation_counts ON global_attribute.global_attribute_id = validation_counts.global_attribute_id
    INNER JOIN (${imageCaptureDatesAndUserIds}) image_capture_dates ON global_attribute.global_attribute_id = image_capture_dates.global_attribute_id
    WHERE ${whereClause}
    ORDER BY global_attribute.global_attribute_id
    """
    
    // If includeRawLabels is true, modify the query to fetch raw label data
    if (filters.includeRawLabels) {
      finalQuery = s"""
        WITH base_query AS (
          ${finalQuery}
        )
        SELECT
          base_query.*,
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
        LEFT JOIN global_attribute_user_attribute gaua 
          ON base_query.label_cluster_id = gaua.global_attribute_id
        LEFT JOIN user_attribute_label ual 
          ON gaua.user_attribute_id = ual.user_attribute_id
        LEFT JOIN label l 
          ON ual.label_id = l.label_id
        LEFT JOIN label_point lp 
          ON l.label_id = lp.label_id
        LEFT JOIN gsv_data gd 
          ON l.gsv_panorama_id = gd.gsv_panorama_id
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
          base_query.is_temporary,
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

  def countGlobalAttributes: DBIO[Int] = {
    globalAttributes.length.result
  }

  def insert(newSess: GlobalAttribute): DBIO[Int] = {
    (globalAttributes returning globalAttributes.map(_.globalAttributeId)) += newSess
  }

  def saveMultiple(attributes: Seq[GlobalAttribute]): DBIO[Seq[Int]] = {
    (globalAttributes returning globalAttributes.map(_.globalAttributeId)) ++= attributes
  }
}