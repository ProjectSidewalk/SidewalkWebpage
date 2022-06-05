package models.attribute

import controllers.helper.GoogleMapsHelper
import models.label._
import models.region.{Region, RegionTable}
import models.street.OsmWayStreetEdgeTable
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick
import play.api.libs.json.{JsObject, Json}
import play.extras.geojson
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
                                 val neighborhoodName: String) {
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
        "severity" -> severity,
        "is_temporary" -> temporary,
        "agree_count" -> agreeCount,
        "disagree_count" -> disagreeCount,
        "notsure_count" -> notsureCount
      )
    )
  }
  val attributesToArray = Array(globalAttributeId, labelType, streetEdgeId, osmStreetId, neighborhoodName, lat.toString,
                                lng.toString, severity.getOrElse("NA").toString, temporary.toString,
                                agreeCount.toString, disagreeCount.toString, notsureCount.toString)
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
                                          val heading: Float,
                                          val pitch: Float,
                                          val zoom: Int,
                                          val canvasXY: (Int, Int),
                                          val canvasWidth: Int, val canvasHeight: Int,
                                          val agreeCount: Int,
                                          val disagreeCount: Int,
                                          val notsureCount: Int,
                                          val labelSeverity: Option[Int],
                                          val labelTemporary: Boolean) {
  val gsvUrl = s"""https://maps.googleapis.com/maps/api/streetview?
                  |size=${canvasWidth}x${canvasHeight}
                  |&pano=${gsvPanoramaId}
                  |&heading=${heading}
                  |&pitch=${pitch}
                  |&fov=${GoogleMapsHelper.getFov(zoom)}
                  |&key=YOUR_API_KEY
                  |&signature=YOUR_SIGNATURE""".stripMargin.replaceAll("\n", "")
  val labelTags: List[String] = LabelTagTable.selectTagsForLabelId(labelId)
  val labelDescription: String = LabelTable.selectDescriptionForLabelId(labelId)
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
        "heading" -> heading,
        "pitch" -> pitch,
        "zoom" -> zoom,
        "canvas_x" -> canvasXY._1,
        "canvas_y" -> canvasXY._2,
        "canvas_width" -> canvasWidth,
        "canvas_height" -> canvasHeight,
        "gsv_url" -> gsvUrl,
        "label_severity" -> labelSeverity,
        "label_is_temporary" -> labelTemporary,
        "agree_count" -> agreeCount,
        "disagree_count" -> disagreeCount,
        "notsure_count" -> notsureCount,
        "label_tags" -> labelTags,
        "label_description" -> labelDescription
      )
    )
  }
  val attributesToArray = Array(globalAttributeId.toString, labelType, attributeSeverity.getOrElse("NA").toString,
                                attributeTemporary.toString, streetEdgeId.toString, osmStreetId.toString,
                                neighborhoodName, labelId.toString, gsvPanoramaId, attributeLatLng._1.toString,
                                attributeLatLng._2.toString, labelLatLng._1.toString, labelLatLng._2.toString,
                                heading.toString, pitch.toString, zoom.toString, canvasXY._1.toString,
                                canvasXY._2.toString, canvasWidth.toString, canvasHeight.toString, "\"" + gsvUrl + "\"",
                                labelSeverity.getOrElse("NA").toString, labelTemporary.toString, agreeCount.toString,
                                disagreeCount.toString, notsureCount.toString, "\"[" + labelTags.mkString(",") + "]\"",
                                "\"" + labelDescription + "\"")
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
    // Sums the validations counts of the labels that make up each global attribute.
    val validationCounts = (for {
      _ga <- globalAttributes
      _gaua <- GlobalAttributeUserAttributeTable.globalAttributeUserAttributes if _ga.globalAttributeId === _gaua.globalAttributeId
      _ual <- UserAttributeLabelTable.userAttributeLabels if _gaua.userAttributeId === _ual.userAttributeId
      _l <- LabelTable.labels if _ual.labelId === _l.labelId
    } yield (_ga.globalAttributeId, _l.agreeCount, _l.disagreeCount, _l.notsureCount))
      .groupBy(_._1)
      .map { case (attrId, group) => (attrId, group.map(_._2).sum, group.map(_._3).sum, group.map(_._4).sum) }

    val attributes = for {
      _ga <- globalAttributes if _ga.lat > minLat && _ga.lat < maxLat && _ga.lng > minLng && _ga.lng < maxLng &&
        (_ga.severity.isEmpty && severity.getOrElse("") == "none" || severity.isEmpty || _ga.severity === toInt(severity))
      // The line above gets attributes with null severity if severity = "none", all attributes if severity is unspecified,
      // and attributes with the specified severity (e.g. severity = 3) otherwise.
      _vc <- validationCounts if _ga.globalAttributeId === _vc._1
      _lt <- LabelTypeTable.labelTypes if _ga.labelTypeId === _lt.labelTypeId
      _r <- RegionTable.regions if _ga.regionId === _r.regionId
      _osm <- OsmWayStreetEdgeTable.osmStreetTable if _ga.streetEdgeId === _osm.streetEdgeId
      if _lt.labelType =!= "Problem"
    } yield (
      _ga.globalAttributeId, _lt.labelType, _ga.lat, _ga.lng, _ga.severity, _ga.temporary,
      _vc._2.getOrElse(0), _vc._3.getOrElse(0), _vc._4.getOrElse(0), _ga.streetEdgeId, _osm.osmWayId, _r.description
    )
    attributes.list.map(GlobalAttributeForAPI.tupled)
  }

  /**
    * Gets global attributes within a bounding box with the labels that make up those attributes for the public API.
    */
  def getGlobalAttributesWithLabelsInBoundingBox(minLat: Float, minLng: Float, maxLat: Float, maxLng: Float, severity: Option[String]): List[GlobalAttributeWithLabelForAPI] = db.withSession { implicit session =>
    val attributesWithLabels = for {
      _ga <- globalAttributes if _ga.lat > minLat && _ga.lat < maxLat && _ga.lng > minLng && _ga.lng < maxLng &&
        (_ga.severity.isEmpty && severity.getOrElse("") == "none" || severity.isEmpty || _ga.severity === toInt(severity))
      _lt <- LabelTypeTable.labelTypes if _ga.labelTypeId === _lt.labelTypeId
      _r <- RegionTable.regions if _ga.regionId === _r.regionId
      _gaua <- GlobalAttributeUserAttributeTable.globalAttributeUserAttributes if _ga.globalAttributeId === _gaua.globalAttributeId
      _ual <- UserAttributeLabelTable.userAttributeLabels if _gaua.userAttributeId === _ual.userAttributeId
      _l <- LabelTable.labels if _ual.labelId === _l.labelId
      _lp <- LabelTable.labelPoints if _l.labelId === _lp.labelId
      _osm <- OsmWayStreetEdgeTable.osmStreetTable if _ga.streetEdgeId === _osm.streetEdgeId
      if _lt.labelType =!= "Problem"
    } yield (
      _ga.globalAttributeId, _lt.labelType, (_ga.lat, _ga.lng), _ga.severity, _ga.temporary, _ga.streetEdgeId,
      _osm.osmWayId, _r.description, _l.labelId, (_lp.lat.get, _lp.lng.get), _l.gsvPanoramaId, _lp.heading, _lp.pitch,
      _lp.zoom, (_lp.canvasX, _lp.canvasY), _lp.canvasWidth, _lp.canvasHeight, _l.agreeCount, _l.disagreeCount,
      _l.notsureCount, _l.severity, _l.temporary
    )

    attributesWithLabels.list.map(GlobalAttributeWithLabelForAPI.tupled)
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
