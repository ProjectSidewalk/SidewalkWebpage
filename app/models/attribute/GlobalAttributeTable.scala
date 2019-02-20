package models.attribute

/**
  * Created by misaugstad on 4/27/17.
  */

import models.label.LabelTypeTable
import play.api.db.slick.DatabaseConfigProvider
import models.label._
import models.region.RegionTable
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}
import play.extras.geojson

import models.utils.MyPostgresDriver.api._
import play.api.Play
import slick.driver.JdbcProfile
import scala.concurrent.Future
import scala.language.postfixOps

import scala.concurrent.ExecutionContext.Implicits.global


case class GlobalAttribute(globalAttributeId: Int,
                           globalClusteringSessionId: Int,
                           clusteringThreshold: Float,
                           labelTypeId: Int,
                           regionId: Int,
                           lat: Float, lng: Float,
                           severity: Option[Int],
                           temporary: Boolean)

case class GlobalAttributeForAPI(globalAttributeId: Int,
                                 labelType: String,
                                 lat: Float, lng: Float,
                                 severity: Option[Int],
                                 temporary: Boolean,
                                 neighborhoodName: String) {
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
}

case class GlobalAttributeWithLabelForAPI(globalAttributeId: Int,
                                          labelType: String,
                                          attributeLat: Float, attributeLng: Float,
                                          attributeSeverity: Option[Int],
                                          attributeTemporary: Boolean,
                                          neighborhoodName: String,
                                          labelId: Int,
                                          labelLat: Float, labelLng: Float,
                                          gsvPanoramaId: String,
                                          labelSeverity: Option[Int],
                                          labelTemporary: Boolean) {
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
        "label_severity" -> labelSeverity,
        "label_is_temporary" -> labelTemporary
      )
    )
  }
}


class GlobalAttributeTable(tag: slick.lifted.Tag) extends Table[GlobalAttribute](tag, Some("sidewalk"), "global_attribute") {
  def globalAttributeId: Rep[Int] = column[Int]("global_attribute_id", O.PrimaryKey, O.AutoInc)
  def globalClusteringSessionId: Rep[Int] = column[Int]("global_clustering_session_id")
  def clusteringThreshold: Rep[Float] = column[Float]("clustering_threshold")
  def labelTypeId: Rep[Int] = column[Int]("label_type_id")
  def regionId: Rep[Int] = column[Int]("region_id")
  def lat: Rep[Float] = column[Float]("lat")
  def lng: Rep[Float] = column[Float]("lng")
  def severity: Rep[Option[Int]] = column[Option[Int]]("severity")
  def temporary: Rep[Boolean] = column[Boolean]("temporary")

  def * = (globalAttributeId,
           globalClusteringSessionId,
           clusteringThreshold,
           labelTypeId,
           regionId,
           lat, lng,
           severity,
           temporary) <>
    ((GlobalAttribute.apply _).tupled, GlobalAttribute.unapply)

  def labelType = foreignKey("global_attribute_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)

  def region = foreignKey("global_attribute_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)

  def globalClusteringSession = foreignKey("global_attribute_global_clustering_session_id_fkey", globalClusteringSessionId, TableQuery[GlobalClusteringSessionTable])(_.globalClusteringSessionId)
}

/**
  * Data access object for the GlobalAttributeTable table
  */
object GlobalAttributeTable {
  import models.utils.MyPostgresDriver.api._
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val globalAttributes: TableQuery[GlobalAttributeTable] = TableQuery[GlobalAttributeTable]

  def getAllGlobalAttributes: Future[Seq[GlobalAttribute]] = {
    val action = globalAttributes.result
    val result: Future[Seq[GlobalAttribute]] = db.run(action)
    result
  }

  def countGlobalAttributes: Future[Int] = db.run {
    globalAttributes.length.result
  }

  /**
    * Gets global attributes within a bounding box for the public API.
    *
    * @param minLat
    * @param minLng
    * @param maxLat
    * @param maxLng
    * @return
    */
  def getGlobalAttributesInBoundingBox(minLat: Float, minLng: Float, maxLat: Float, maxLng: Float): Future[List[GlobalAttributeForAPI]] = {
    val attributes = for {
      _att <- globalAttributes if _att.lat > minLat && _att.lat < maxLat && _att.lng > minLng && _att.lng < maxLng
      _labType <- LabelTypeTable.labelTypes if _att.labelTypeId === _labType.labelTypeId
      _nbhd <- RegionTable.namedNeighborhoods if _att.regionId === _nbhd._1
      if _labType.labelType =!= "Problem"
    } yield (_att.globalAttributeId, _labType.labelType, _att.lat, _att.lng, _att.severity, _att.temporary, _nbhd._2)
    db.run(attributes.to[List].result).map(_.map(a => GlobalAttributeForAPI(a._1, a._2, a._3, a._4, a._5, a._6, a._7.get)))
  }

  /**
    * Gets global attributes within a bounding box with the labels that make up those attributes for the public API.
    *
    * @param minLat
    * @param minLng
    * @param maxLat
    * @param maxLng
    * @return
    */
  def getGlobalAttributesWithLabelsInBoundingBox(minLat: Float, minLng: Float, maxLat: Float, maxLng: Float): Future[List[GlobalAttributeWithLabelForAPI]] = {
    val attributesWithLabels = for {
      _att <- globalAttributes if _att.lat > minLat && _att.lat < maxLat && _att.lng > minLng && _att.lng < maxLng
      _labType <- LabelTypeTable.labelTypes if _att.labelTypeId === _labType.labelTypeId
      _nbhd <- RegionTable.namedNeighborhoods if _att.regionId === _nbhd._1
      _gaua <- GlobalAttributeUserAttributeTable.globalAttributeUserAttributes if _att.globalAttributeId === _gaua.globalAttributeId
      _ual <- UserAttributeLabelTable.userAttributeLabels if _gaua.userAttributeId === _ual.userAttributeId
      _lab <- LabelTable.labels if _ual.labelId === _lab.labelId
      _labPnt <- LabelTable.labelPoints if _lab.labelId === _labPnt.labelId
      if _labType.labelType =!= "Problem"
    } yield (_att.globalAttributeId, _labType.labelType, _att.lat, _att.lng, _att.severity, _att.temporary, _nbhd._2, _lab.labelId, _labPnt.lat, _labPnt.lng, _lab.gsvPanoramaId)

    val withSeverity = for {
      (_l, _s) <- attributesWithLabels.joinLeft(LabelSeverityTable.labelSeverities).on(_._8 === _.labelId)
    } yield (_l._1, _l._2, _l._3, _l._4, _l._5, _l._6, _l._7, _l._8, _l._9, _l._10, _l._11, _s.map(_.severity))

    val withTemporary = for {
      (_l, _t) <- withSeverity.joinLeft(LabelTemporarinessTable.labelTemporarinesses).on(_._8 === _.labelId)
    } yield (_l._1, _l._2, _l._3, _l._4, _l._5, _l._6, _l._7, _l._8, _l._9, _l._10, _l._11, _l._12, _t.map(_.temporary))

    db.run(withTemporary.to[List].result).map(_.map(a =>
      GlobalAttributeWithLabelForAPI(a._1, a._2, a._3, a._4, a._5, a._6, a._7.get, a._8, a._9.get, a._10.get, a._11, a._12, a._13.getOrElse(false))
    ))
  }

  /**
    * Counts the number of NoCurbRamp/SurfaceProb/Obstacle/NoSidewalk attribute counts in the given region.
    *
    * @param regionId
    * @return
    */
  def selectNegativeAttributeCountsByRegion(): Future[List[(Int, String, Int)]] = {
    db.run(
      globalAttributes
        .filter(_.labelTypeId inSet List(2, 3, 4, 7))
        .groupBy(a => (a.regionId, a.labelTypeId)).map { case ((rId, typeId), group) => (rId, typeId, group.length) }
        .to[List].result
    ).flatMap { attributes =>
      Future.sequence(attributes.map { case (rId, typeId, count) =>
        LabelTypeTable.labelTypeIdToLabelType(typeId).map { typeStr => (rId, typeStr, count) }
      })
    }
  }

  def save(newAttribute: GlobalAttribute): Future[Int] = {
    db.run((globalAttributes returning globalAttributes.map(_.globalAttributeId)) += newAttribute)
  }
}
