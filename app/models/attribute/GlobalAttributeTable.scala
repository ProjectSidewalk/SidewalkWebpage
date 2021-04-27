package models.attribute

import models.label._
import models.region.{Region, RegionTable}
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
                           regionId: Int,
                           lat: Float, lng: Float,
                           severity: Option[Int],
                           temporary: Boolean)

case class GlobalAttributeForAPI(val globalAttributeId: Int,
                                 val labelType: String,
                                 val lat: Float, val lng: Float,
                                 val severity: Option[Int],
                                 val temporary: Boolean,
                                 val neighborhoodName: String) {
  def toJSON: JsObject = {
    Json.obj(
      "type" -> "Feature",
      "geometry" -> geojson.Point(geojson.LatLng(lat.toDouble, lng.toDouble)),
      "properties" -> Json.obj(
        "attribute_id" -> globalAttributeId,
        "label_type" -> labelType,
        "neighborhood" -> neighborhoodName,
        "severity" -> severity,
        "is_temporary" -> temporary
      )
    )
  }
  val attributesToArray = Array(globalAttributeId, labelType, neighborhoodName,
                                lat.toString, lng.toString, severity.getOrElse("NA").toString, temporary.toString)
}

case class GlobalAttributeWithLabelForAPI(val globalAttributeId: Int,
                                          val labelType: String,
                                          val attributeLat: Float, val attributeLng: Float,
                                          val attributeSeverity: Option[Int],
                                          val attributeTemporary: Boolean,
                                          val neighborhoodName: String,
                                          val labelId: Int,
                                          val labelLat: Float, labelLng: Float,
                                          val gsvPanoramaId: String,
                                          val heading: Float,
                                          val pitch: Float,
                                          val zoom: Int,
                                          val canvasX: Int, val canvasY: Int,
                                          val canvasWidth: Int, val canvasHeight: Int,
                                          val labelSeverity: Option[Int],
                                          val labelTemporary: Boolean) {
  def toJSON: JsObject = {
    Json.obj(
      "type" -> "Feature",
      "geometry" -> geojson.Point(geojson.LatLng(attributeLat.toDouble, attributeLng.toDouble)),
      "label_geometry" -> geojson.Point(geojson.LatLng(labelLat.toDouble, labelLng.toDouble)),
      "properties" -> Json.obj(
        "attribute_id" -> globalAttributeId,
        "label_type" -> labelType,
        "neighborhood" -> neighborhoodName,
        "severity" -> attributeSeverity,
        "is_temporary" -> attributeTemporary,
        "label_id" -> labelId,
        "gsv_panorama_id" -> gsvPanoramaId,
        "heading" -> heading,
        "pitch" -> pitch,
        "zoom" -> zoom,
        "canvas_x" -> canvasX,
        "canvas_y" -> canvasY,
        "canvas_width" -> canvasWidth,
        "canvas_height" -> canvasHeight,
        "label_severity" -> labelSeverity,
        "label_is_temporary" -> labelTemporary
      )
    )
  }
  val attributesToArray = Array(globalAttributeId.toString, labelType, attributeSeverity.getOrElse("NA").toString,
                                attributeTemporary.toString, neighborhoodName, labelId.toString, gsvPanoramaId,
                                attributeLat.toString, attributeLng.toString, labelLat.toString, labelLng.toString,
                                heading.toString, pitch.toString, zoom.toString, canvasX.toString, canvasY.toString,
                                canvasWidth.toString, canvasHeight.toString,
                                attributeSeverity.getOrElse("NA").toString, labelTemporary.toString)
}

class GlobalAttributeTable(tag: Tag) extends Table[GlobalAttribute](tag, Some("sidewalk"), "global_attribute") {
  def globalAttributeId: Column[Int] = column[Int]("global_attribute_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def globalClusteringSessionId: Column[Int] = column[Int]("global_clustering_session_id", O.NotNull)
  def clusteringThreshold: Column[Float] = column[Float]("clustering_threshold", O.NotNull)
  def labelTypeId: Column[Int] = column[Int]("label_type_id", O.NotNull)
  def regionId: Column[Int] = column[Int]("region_id", O.NotNull)
  def lat: Column[Float] = column[Float]("lat", O.NotNull)
  def lng: Column[Float] = column[Float]("lng", O.NotNull)
  def severity: Column[Option[Int]] = column[Option[Int]]("severity")
  def temporary: Column[Boolean] = column[Boolean]("temporary", O.NotNull)

  def * : ProvenShape[GlobalAttribute] = (globalAttributeId,
                                          globalClusteringSessionId,
                                          clusteringThreshold,
                                          labelTypeId,
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
    val attributes = for {
      _ga <- globalAttributes if _ga.lat > minLat && _ga.lat < maxLat && _ga.lng > minLng && _ga.lng < maxLng &&
        (_ga.severity.isEmpty && severity.getOrElse("") == "none" || severity.isEmpty || _ga.severity === toInt(severity))
      // The line above gets attributes with null severity if severity = "none", all attributes if severity is unspecified,
      // and attributes with the specified severity (e.g. severity = 3) otherwise.
      _lt <- LabelTypeTable.labelTypes if _ga.labelTypeId === _lt.labelTypeId
      _r <- RegionTable.regions if _ga.regionId === _r.regionId
      if _lt.labelType =!= "Problem"
    } yield (_ga.globalAttributeId, _lt.labelType, _ga.lat, _ga.lng, _ga.severity, _ga.temporary, _r.description)
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
      if _lt.labelType =!= "Problem"
    } yield (
      _ga.globalAttributeId, _lt.labelType, _ga.lat, _ga.lng, _ga.severity, _ga.temporary, _r.description, _l.labelId,
      _lp.lat, _lp.lng, _l.gsvPanoramaId, _lp.heading, _lp.pitch, _lp.zoom,
      _lp.canvasX, _lp.canvasY, _lp.canvasWidth, _lp.canvasHeight
    )

    val withSeverity = for {
      (_l, _s) <- attributesWithLabels.leftJoin(LabelSeverityTable.labelSeverities).on(_._8 === _.labelId)
    } yield (_l._1, _l._2, _l._3, _l._4, _l._5, _l._6, _l._7, _l._8, _l._9, _l._10, _l._11, _l._12, _l._13, _l._14, _l._15, _l._16, _l._17, _l._18, _s.severity.?)

    val withTemporary = for {
      (_l, _t) <- withSeverity.leftJoin(LabelTemporarinessTable.labelTemporarinesses).on(_._8 === _.labelId)
    } yield (_l._1, _l._2, _l._3, _l._4, _l._5, _l._6, _l._7, _l._8, _l._9, _l._10, _l._11, _l._12, _l._13, _l._14, _l._15, _l._16, _l._17, _l._18, _l._19, _t.temporary.?)

    withTemporary.list.map(a =>
      GlobalAttributeWithLabelForAPI(a._1, a._2, a._3, a._4, a._5, a._6, a._7, a._8, a._9.get, a._10.get, a._11, a._12, a._13, a._14, a._15, a._16, a._17, a._18, a._19, a._20.getOrElse(false))
    )
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
