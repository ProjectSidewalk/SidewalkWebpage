package models.attribute

/**
  * Created by misaugstad on 4/27/17.
  */

import models.label.{LabelType, LabelTypeTable}
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
  * Data access object for the GlobalAttributeTable table
  */
object GlobalAttributeTable {
  val db: slick.Database = play.api.db.slick.DB
  val globalAttributes: TableQuery[GlobalAttributeTable] = TableQuery[GlobalAttributeTable]

  def getAllGlobalAttributes: List[GlobalAttribute] = db.withTransaction { implicit session =>
    globalAttributes.list
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
  def getGlobalAttributesInBoundingBox(minLat: Float, minLng: Float, maxLat: Float, maxLng: Float): List[GlobalAttributeForAPI] = db.withSession { implicit session =>
    val attributes = for {
      _att <- globalAttributes if _att.lat > minLat && _att.lat < maxLat && _att.lng > minLng && _att.lng < maxLng
      _labType <- LabelTypeTable.labelTypes if _att.labelTypeId === _labType.labelTypeId
      _nbhd <- RegionTable.namedNeighborhoods if _att.regionId === _nbhd._1
    } yield (_att.globalAttributeId, _labType.labelType, _att.lat, _att.lng, _att.severity, _att.temporary, _nbhd._2)
    attributes.list.map(a => GlobalAttributeForAPI(a._1, a._2, a._3, a._4, a._5, a._6, a._7.get))
  }

  def countGlobalAttributes: Int = db.withTransaction { implicit session =>
    globalAttributes.length.run
  }

  def save(newSess: GlobalAttribute): Int = db.withTransaction { implicit session =>
    val newId: Int = (globalAttributes returning globalAttributes.map(_.globalAttributeId)) += newSess
    newId
  }
}
