package models.attribute

/**
  * Created by misaugstad on 4/27/17.
  */

import models.label.{LabelType, LabelTypeTable}
import models.region.RegionTable
import play.api.db.slick.DatabaseConfigProvider

import models.utils.MyPostgresDriver.api._
import play.api.Play
import slick.driver.JdbcProfile
import scala.concurrent.Future
import scala.language.postfixOps


case class GlobalAttribute(globalAttributeId: Int,
                           globalClusteringSessionId: Int,
                           clusteringThreshold: Float,
                           labelTypeId: Int,
                           regionId: Int,
                           lat: Float, lng: Float,
                           severity: Option[Int],
                           temporary: Boolean)


class GlobalAttributeTable(tag: Tag) extends Table[GlobalAttribute](tag, Some("sidewalk"), "global_attribute") {
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

  def save(newAttribute: GlobalAttribute): Future[Int] = {
    db.run((globalAttributes returning globalAttributes.map(_.globalAttributeId)) += newAttribute)
  }
}
