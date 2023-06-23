package models.attribute

import java.sql.Timestamp
import controllers.helper.GoogleMapsHelper
import models.label._
import models.region.{Region, RegionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick
import play.api.libs.json.{JsObject, Json}
import play.extras.geojson
import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.slick.lifted.{ForeignKeyQuery, ProvenShape, Tag}
import scala.language.postfixOps

case class GlobalAttribute(globalAttributeId: Int,
                           globalClusteringSessionId: Int,
                           clusteringThreshold: Float,
                           labelTypeId: Int,
                           streetEdgeId: Int,
                           regionId: Int,
                           lat: Float, lng: Float,
                           severity: Option[Int],
                           temporary: Boolean)

case class GlobalAttributeForAPI(val globalAttributeId: Int,
                                 val labelType: String,
                                 val lat: Float, val lng: Float,
                                 val severity: Option[Int],
                                 val temporary: Boolean,
                                 val agreeCount: Int,
                                 val disagreeCount: Int,
                                 val notsureCount: Int,
                                 val streetEdgeId: Int,
                                 val osmStreetId: Int,
                                 val neighborhoodName: String,
                                 val avgImageCaptureDate: Timestamp,
                                 val avgLabelDate: Timestamp,
                                 val imageCount: Int,
                                 val labelCount: Int,
                                 val usersList: List[String]) {
  def toJSON: JsObject = {
    Json.obj(
      "type" -> "Feature",
      "geometry" -> geojson.Point(geojson.LatLng(lat.toDouble, lng.toDouble)),
      "properties" -> Json.obj(
        "attribute_id" -> globalAttributeId,
        "label_type" -> labelType,
        "street_edge_id" -> streetEdgeId,
        "osm_street_id" -> osmStreetId,
        "neighborhood" -> neighborhoodName,
        "avg_image_capture_date" -> avgImageCaptureDate.toString(),
        "avg_label_date" -> avgLabelDate.toString(),
        "severity" -> severity,
        "is_temporary" -> temporary,
        "agree_count" -> agreeCount,
        "disagree_count" -> disagreeCount,
        "notsure_count" -> notsureCount,
        "users" -> usersList
      )
    )
  }
  val attributesToArray = Array(globalAttributeId, labelType, streetEdgeId, osmStreetId, neighborhoodName, lat.toString,
                                lng.toString, avgImageCaptureDate, avgLabelDate.toString,
                                severity.getOrElse("NA").toString, temporary.toString, agreeCount.toString,
                                disagreeCount.toString, notsureCount.toString, "\"[" + usersList.mkString(",") + "]\"")
}

case class GlobalAttributeWithLabelForAPI(val globalAttributeId: Int,
                                          val labelType: String,
                                          val attributeLatLng: (Float, Float),
                                          val attributeSeverity: Option[Int],
                                          val attributeTemporary: Boolean,
                                          val streetEdgeId: Int,
                                          val osmStreetId: Int,
                                          val neighborhoodName: String,
                                          val labelId: Int,
                                          val labelLatLng: (Float, Float),
                                          val gsvPanoramaId: String,
                                          val headingPitchZoom: (Float, Float, Int),
                                          val canvasXY: (Int, Int),
                                          val agreeDisagreeNotsureCount: (Int, Int, Int),
                                          val labelSeverity: Option[Int],
                                          val labelTemporary: Boolean,
                                          val imageLabelDates: (String, Timestamp),
                                          val labelTags: List[String],
                                          val labelDescription: Option[String],
                                          val userId: String) {
  val gsvUrl = s"""https://maps.googleapis.com/maps/api/streetview?
                  |size=${LabelPointTable.canvasWidth}x${LabelPointTable.canvasHeight}
                  |&pano=${gsvPanoramaId}
                  |&heading=${headingPitchZoom._1}
                  |&pitch=${headingPitchZoom._2}
                  |&fov=${GoogleMapsHelper.getFov(headingPitchZoom._3)}
                  |&key=YOUR_API_KEY
                  |&signature=YOUR_SIGNATURE""".stripMargin.replaceAll("\n", "")
  def toJSON: JsObject = {
    Json.obj(
      "type" -> "Feature",
      "geometry" -> geojson.Point(geojson.LatLng(attributeLatLng._1.toDouble, attributeLatLng._2.toDouble)),
      "label_geometry" -> geojson.Point(geojson.LatLng(labelLatLng._1.toDouble, labelLatLng._2.toDouble)),
      "properties" -> Json.obj(
        "attribute_id" -> globalAttributeId,
        "label_type" -> labelType,
        "street_edge_id" -> streetEdgeId,
        "osm_street_id" -> osmStreetId,
        "neighborhood" -> neighborhoodName,
        "severity" -> attributeSeverity,
        "is_temporary" -> attributeTemporary,
        "label_id" -> labelId,
        "gsv_panorama_id" -> gsvPanoramaId,
        "heading" -> headingPitchZoom._1,
        "pitch" -> headingPitchZoom._2,
        "zoom" -> headingPitchZoom._3,
        "canvas_x" -> canvasXY._1,
        "canvas_y" -> canvasXY._2,
        "canvas_width" -> LabelPointTable.canvasWidth,
        "canvas_height" -> LabelPointTable.canvasHeight,
        "gsv_url" -> gsvUrl,
        "image_capture_date" -> imageLabelDates._1,
        "label_date" -> imageLabelDates._2.toString(),
        "label_severity" -> labelSeverity,
        "label_is_temporary" -> labelTemporary,
        "agree_count" -> agreeDisagreeNotsureCount._1,
        "disagree_count" -> agreeDisagreeNotsureCount._2,
        "notsure_count" -> agreeDisagreeNotsureCount._3,
        "label_tags" -> labelTags,
        "label_description" -> labelDescription,
        "user_id" -> userId
      )
    )
  }
  val attributesToArray = Array(globalAttributeId.toString, labelType, attributeSeverity.getOrElse("NA").toString,
                                attributeTemporary.toString, streetEdgeId.toString, osmStreetId.toString,
                                neighborhoodName, labelId.toString, gsvPanoramaId, attributeLatLng._1.toString,
                                attributeLatLng._2.toString, labelLatLng._1.toString, labelLatLng._2.toString,
                                headingPitchZoom._1.toString, headingPitchZoom._2.toString, headingPitchZoom._3.toString,
                                canvasXY._1.toString, canvasXY._2.toString, LabelPointTable.canvasWidth.toString,
                                LabelPointTable.canvasHeight.toString, "\"" + gsvUrl + "\"", imageLabelDates._1,
                                imageLabelDates._2.toString, labelSeverity.getOrElse("NA").toString,
                                labelTemporary.toString, agreeDisagreeNotsureCount._1.toString,
                                agreeDisagreeNotsureCount._2.toString, agreeDisagreeNotsureCount._3.toString,
                                "\"[" + labelTags.mkString(",") + "]\"", "\"" + labelDescription.getOrElse("NA") + "\"", userId)
}

class GlobalAttributeTable(tag: Tag) extends Table[GlobalAttribute](tag, Some("sidewalk"), "global_attribute") {
  def globalAttributeId: Column[Int] = column[Int]("global_attribute_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def globalClusteringSessionId: Column[Int] = column[Int]("global_clustering_session_id", O.NotNull)
  def clusteringThreshold: Column[Float] = column[Float]("clustering_threshold", O.NotNull)
  def labelTypeId: Column[Int] = column[Int]("label_type_id", O.NotNull)
  def streetEdgeId: Column[Int] = column[Int]("street_edge_id", O.NotNull)
  def regionId: Column[Int] = column[Int]("region_id", O.NotNull)
  def lat: Column[Float] = column[Float]("lat", O.NotNull)
  def lng: Column[Float] = column[Float]("lng", O.NotNull)
  def severity: Column[Option[Int]] = column[Option[Int]]("severity")
  def temporary: Column[Boolean] = column[Boolean]("temporary", O.NotNull)

  def * : ProvenShape[GlobalAttribute] = (globalAttributeId,
                                          globalClusteringSessionId,
                                          clusteringThreshold,
                                          labelTypeId,
                                          streetEdgeId,
                                          regionId,
                                          lat, lng,
                                          severity,
                                          temporary) <>
    ((GlobalAttribute.apply _).tupled, GlobalAttribute.unapply)

  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
    foreignKey("global_attribute_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)

  def region: ForeignKeyQuery[RegionTable, Region] =
    foreignKey("global_attribute_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)

  def globalClusteringSession: ForeignKeyQuery[GlobalClusteringSessionTable, GlobalClusteringSession] =
    foreignKey("global_attribute_global_clustering_session_id_fkey", globalClusteringSessionId, TableQuery[GlobalClusteringSessionTable])(_.globalClusteringSessionId)
}

/**
  * Data access object for the GlobalAttributeTable table.
  */
object GlobalAttributeTable {
  val db: slick.Database = play.api.db.slick.DB
  val globalAttributes: TableQuery[GlobalAttributeTable] = TableQuery[GlobalAttributeTable]

  implicit val GlobalAttributeForAPIConverter = GetResult[GlobalAttributeForAPI](r =>
    GlobalAttributeForAPI(
      r.nextInt, r.nextString, r.nextFloat, r.nextFloat, r.nextIntOption, r.nextBoolean, r.nextInt, r.nextInt,
      r.nextInt, r.nextInt, r.nextInt, r.nextString, r.nextTimestamp, r.nextTimestamp, r.nextInt, r.nextInt,
      r.nextString.split(",").toList.distinct
    )
  )

  implicit val GlobalAttributeWithLabelForAPIConverter = GetResult[GlobalAttributeWithLabelForAPI](r =>
    GlobalAttributeWithLabelForAPI(
      r.nextInt, r.nextString, (r.nextFloat, r.nextFloat), r.nextIntOption, r.nextBoolean, r.nextInt, r.nextInt, r.nextString,
      r.nextInt, (r.nextFloat, r.nextFloat), r.nextString, (r.nextFloat, r.nextFloat, r.nextInt),
      (r.nextInt, r.nextInt), (r.nextInt, r.nextInt, r.nextInt), r.nextIntOption, r.nextBoolean,
      (r.nextString, r.nextTimestamp), r.nextStringOption.map(tags => tags.split(",").toList).getOrElse(List()),
      r.nextStringOption(), r.nextString
    )
  )

  def getAllGlobalAttributes: List[GlobalAttribute] = db.withTransaction { implicit session =>
    globalAttributes.list
  }

  def toInt(s: Option[String]): Option[Int] = {
    try {
      Some(s.getOrElse("-1").toInt)
    } catch {
      case e: Exception => None
    }
  }

  /**
    * Gets global attributes within a bounding box for the public API.
    */
  def getGlobalAttributesInBoundingBox(minLat: Float, minLng: Float, maxLat: Float, maxLng: Float, severity: Option[String]): List[GlobalAttributeForAPI] = db.withSession { implicit session =>
    // Sum the validations counts, average date, and the number of the labels that make up each global attribute.
    val validationCounts =
      """SELECT global_attribute.global_attribute_id AS global_attribute_id,
        |       SUM(label.agree_count) AS agree_count,
        |       SUM(label.disagree_count) AS disagree_count,
        |       SUM(label.notsure_count) AS notsure_count,
        |       TO_TIMESTAMP(AVG(extract(epoch from label.time_created))) AS avg_label_date,
        |       COUNT(label.label_id) AS label_count
        |FROM global_attribute
        |INNER JOIN global_attribute_user_attribute ON global_attribute.global_attribute_id = global_attribute_user_attribute.global_attribute_id
        |INNER JOIN user_attribute_label ON global_attribute_user_attribute.user_attribute_id = user_attribute_label.user_attribute_id
        |INNER JOIN label ON user_attribute_label.label_id = label.label_id
        |GROUP BY global_attribute.global_attribute_id""".stripMargin
    // Select the average image date and number of images for each attribute. Subquery selects the dates of all images
    // of interest and a list of user_ids associated with the attribute, once per attribute. The users_list might have
    // duplicate id's, but we fix this in the `GlobalAttributeForAPIConverter`.
    val imageCaptureDatesAndUserIds =
      """SELECT capture_dates.global_attribute_id AS global_attribute_id,
        |       TO_TIMESTAMP(AVG(EXTRACT(epoch from capture_dates.capture_date))) AS avg_capture_date,
        |       COUNT(capture_dates.capture_date) AS image_count,
        |       string_agg(capture_dates.users_list, ',') AS users_list
        |FROM (
        |    SELECT global_attribute.global_attribute_id,
        |           TO_TIMESTAMP(AVG(EXTRACT(epoch from CAST(gsv_data.capture_date || '-01' AS DATE)))) AS capture_date,
        |           array_to_string(array_agg(DISTINCT audit_task.user_id), ',') AS users_list
        |    FROM global_attribute
        |    INNER JOIN global_attribute_user_attribute ON global_attribute.global_attribute_id = global_attribute_user_attribute.global_attribute_id
        |    INNER JOIN user_attribute_label ON global_attribute_user_attribute.user_attribute_id = user_attribute_label.user_attribute_id
        |    INNER JOIN label ON user_attribute_label.label_id = label.label_id
        |    INNER JOIN sidewalk.gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
        |    INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
        |    GROUP BY global_attribute.global_attribute_id, gsv_data.gsv_panorama_id
        |) capture_dates
        |GROUP BY capture_dates.global_attribute_id""".stripMargin
    val attributes = Q.queryNA[GlobalAttributeForAPI](
      s"""SELECT global_attribute.global_attribute_id,
         |       label_type.label_type,
         |       global_attribute.lat,
         |       global_attribute.lng,
         |       global_attribute.severity,
         |       global_attribute.temporary,
         |       validation_counts.agree_count,
         |       validation_counts.disagree_count,
         |       validation_counts.notsure_count,
         |       global_attribute.street_edge_id,
         |       osm_way_street_edge.osm_way_id,
         |       region.name,
         |       image_capture_dates.avg_capture_date,
         |       validation_counts.avg_label_date,
         |       validation_counts.label_count,
         |       image_capture_dates.image_count,
         |       image_capture_dates.users_list
         |FROM global_attribute
         |INNER JOIN label_type ON global_attribute.label_type_id = label_type.label_type_id
         |INNER JOIN region ON global_attribute.region_id = region.region_id
         |INNER JOIN osm_way_street_edge ON global_attribute.street_edge_id = osm_way_street_edge.street_edge_id
         |INNER JOIN ($validationCounts) validation_counts ON global_attribute.global_attribute_id = validation_counts.global_attribute_id
         |INNER JOIN ($imageCaptureDatesAndUserIds) image_capture_dates ON global_attribute.global_attribute_id = image_capture_dates.global_attribute_id
         |WHERE label_type.label_type <> 'Problem'
         |    AND global_attribute.lat > $minLat
         |    AND global_attribute.lat < $maxLat
         |    AND global_attribute.lng > $minLng
         |    AND global_attribute.lng < $maxLng
         |    AND (
         |        global_attribute.severity IS NULL
         |        AND ${severity.getOrElse("") == "none"}
         |        OR ${severity.isEmpty}
         |        OR global_attribute.severity = ${toInt(severity).getOrElse(-1)}
         |    );""".stripMargin
    )
    attributes.list
  }

  /**
    * Gets global attributes within a bounding box with the labels that make up those attributes for the public API.
    */
  def getGlobalAttributesWithLabelsInBoundingBox(minLat: Float, minLng: Float, maxLat: Float, maxLng: Float, severity: Option[String], startIndex: Option[Int] = None, n: Option[Int] = None): List[GlobalAttributeWithLabelForAPI] = db.withSession { implicit session =>
    val attributesWithLabels = Q.queryNA[GlobalAttributeWithLabelForAPI](
      s"""SELECT global_attribute.global_attribute_id,
         |       label_type.label_type,
         |       global_attribute.lat,
         |       global_attribute.lng,
         |       global_attribute.severity,
         |       global_attribute.temporary,
         |       global_attribute.street_edge_id,
         |       osm_way_street_edge.osm_way_id,
         |       region.name,
         |       label.label_id,
         |       label_point.lat,
         |       label_point.lng,
         |       label.gsv_panorama_id,
         |       label_point.heading,
         |       label_point.pitch,
         |       label_point.zoom,
         |       label_point.canvas_x,
         |       label_point.canvas_y,
         |       label.agree_count,
         |       label.disagree_count,
         |       label.notsure_count,
         |       label.severity,
         |       label.temporary,
         |       gsv_data.capture_date,
         |       label.time_created,
         |       the_tags.tag_list,
         |       label.description,
         |       audit_task.user_id
         |FROM global_attribute
         |INNER JOIN label_type ON global_attribute.label_type_id = label_type.label_type_id
         |INNER JOIN region ON global_attribute.region_id = region.region_id
         |INNER JOIN global_attribute_user_attribute ON global_attribute.global_attribute_id = global_attribute_user_attribute.global_attribute_id
         |INNER JOIN user_attribute_label ON global_attribute_user_attribute.user_attribute_id = user_attribute_label.user_attribute_id
         |INNER JOIN label ON user_attribute_label.label_id = label.label_id
         |INNER JOIN label_point ON label.label_id = label_point.label_id
         |INNER JOIN osm_way_street_edge ON global_attribute.street_edge_id = osm_way_street_edge.street_edge_id
         |INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
         |INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
         |LEFT JOIN (
         |    -- Puts set of tag_ids associated with the label in a comma-separated list in a string.
         |    SELECT label_id, array_to_string(array_agg(tag.tag), ',') AS tag_list
         |    FROM label_tag
         |    INNER JOIN tag ON label_tag.tag_id = tag.tag_id
         |    GROUP BY label_id
         |) the_tags ON label.label_id = the_tags.label_id
         |WHERE label_type.label_type <> 'Problem'
         |    AND global_attribute.lat > $minLat
         |    AND global_attribute.lat < $maxLat
         |    AND global_attribute.lng > $minLng
         |    AND global_attribute.lng < $maxLng
         |    AND (global_attribute.severity IS NULL
         |         AND ${severity.getOrElse("") == "none"}
         |         OR ${severity.isEmpty}
         |         OR global_attribute.severity = ${toInt(severity).getOrElse(-1)}
         |        )
         |ORDER BY user_attribute_label_id
         |${if (n.isDefined && startIndex.isDefined) s"LIMIT ${n.get} OFFSET ${startIndex.get}" else ""};""".stripMargin
    )
    attributesWithLabels.list
  }

  /**
    * Counts the number of NoCurbRamp/SurfaceProb/Obstacle/NoSidewalk attribute counts in each region.
    */
  def selectNegativeAttributeCountsByRegion(): List[(Int, String, Int)] = db.withSession { implicit session =>
    globalAttributes
      .filter(_.labelTypeId inSet List(2, 3, 4, 7))
      .groupBy(a => (a.regionId, a.labelTypeId)).map { case ((rId, typeId), group) => (rId, typeId, group.length) }
      .list.map{ case (rId, typeId, count) => (rId, LabelTypeTable.labelTypeIdToLabelType(typeId), count) }
  }

  def countGlobalAttributes: Int = db.withTransaction { implicit session =>
    globalAttributes.length.run
  }

  def save(newSess: GlobalAttribute): Int = db.withTransaction { implicit session =>
    val newId: Int = (globalAttributes returning globalAttributes.map(_.globalAttributeId)) += newSess
    newId
  }
}
