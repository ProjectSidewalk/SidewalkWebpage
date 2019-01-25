package models.attribute

/**
 * Created by misaugstad on 4/27/17.
 */

import models.label.{ LabelType, LabelTypeTable }
import models.region.{ Region, RegionTable }
import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import slick.lifted.{ ProvenShape, Tag }
import scala.language.postfixOps

case class UserAttribute(
  userAttributeId: Int,
  userClusteringSessionId: Int,
  clusteringThreshold: Float,
  labelTypeId: Int,
  regionId: Int,
  lat: Float,
  lng: Float,
  severity: Option[Int],
  temporary: Boolean)

class UserAttributeTable(tag: Tag) extends Table[UserAttribute](tag, Some("sidewalk"), "user_attribute") {
  def userAttributeId: Rep[Int] = column[Int]("user_attribute_id", O.PrimaryKey, O.AutoInc)
  def userClusteringSessionId: Rep[Int] = column[Int]("user_clustering_session_id")
  def clusteringThreshold: Rep[Float] = column[Float]("clustering_threshold")
  def labelTypeId: Rep[Int] = column[Int]("label_type_id")
  def regionId: Rep[Int] = column[Int]("region_id")
  def lat: Rep[Float] = column[Float]("lat")
  def lng: Rep[Float] = column[Float]("lng")
  def severity: Rep[Option[Int]] = column[Option[Int]]("severity")
  def temporary: Rep[Boolean] = column[Boolean]("temporary")

  def * : ProvenShape[UserAttribute] = (
    userAttributeId,
    userClusteringSessionId,
    clusteringThreshold,
    labelTypeId,
    regionId,
    lat, lng,
    severity,
    temporary) <>
    ((UserAttribute.apply _).tupled, UserAttribute.unapply)

  def labelType = foreignKey("user_attribute_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)

  def region = foreignKey("user_attribute_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)

  def userClusteringSession = foreignKey("user_attribute_user_clustering_session_id_fkey", userClusteringSessionId, TableQuery[UserClusteringSessionTable])(_.userClusteringSessionId)
}

/**
 * Data access object for the UserAttributeTable table
 */
object UserAttributeTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val userAttributes: TableQuery[UserAttributeTable] = TableQuery[UserAttributeTable]

  def getAllUserAttributes: Future[Seq[UserAttribute]] = {
    db.run(userAttributes.result)
  }

  def countUserAttributes: Future[Int] = {
    db.run(userAttributes.length.result)
  }

  def save(newAttribute: UserAttribute): Future[Int] = {
    db.run((userAttributes returning userAttributes.map(_.userAttributeId)) += newAttribute)
  }
}
