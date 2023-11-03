package models.attribute

import models.label.{LabelType, LabelTypeTable}
import models.region.{Region, RegionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick
import scala.slick.lifted.{ForeignKeyQuery, ProvenShape, Tag}
import scala.language.postfixOps

case class UserAttribute(userAttributeId: Int,
                         userClusteringSessionId: Int,
                         clusteringThreshold: Float,
                         labelTypeId: Int,
                         regionId: Int,
                         lat: Float,
                         lng: Float,
                         severity: Option[Int],
                         temporary: Boolean)

class UserAttributeTable(tag: Tag) extends Table[UserAttribute](tag, "user_attribute") {
  def userAttributeId: Column[Int] = column[Int]("user_attribute_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def userClusteringSessionId: Column[Int] = column[Int]("user_clustering_session_id", O.NotNull)
  def clusteringThreshold: Column[Float] = column[Float]("clustering_threshold", O.NotNull)
  def labelTypeId: Column[Int] = column[Int]("label_type_id", O.NotNull)
  def regionId: Column[Int] = column[Int]("region_id", O.NotNull)
  def lat: Column[Float] = column[Float]("lat", O.NotNull)
  def lng: Column[Float] = column[Float]("lng", O.NotNull)
  def severity: Column[Option[Int]] = column[Option[Int]]("severity")
  def temporary: Column[Boolean] = column[Boolean]("temporary", O.NotNull)

  def * : ProvenShape[UserAttribute] = (userAttributeId,
                                        userClusteringSessionId,
                                        clusteringThreshold,
                                        labelTypeId,
                                        regionId,
                                        lat, lng,
                                        severity,
                                        temporary) <>
    ((UserAttribute.apply _).tupled, UserAttribute.unapply)

  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
    foreignKey("user_attribute_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)

  def region: ForeignKeyQuery[RegionTable, Region] =
    foreignKey("user_attribute_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)

  def userClusteringSession: ForeignKeyQuery[UserClusteringSessionTable, UserClusteringSession] =
    foreignKey("user_attribute_user_clustering_session_id_fkey", userClusteringSessionId, TableQuery[UserClusteringSessionTable])(_.userClusteringSessionId)
}

/**
  * Data access object for the UserAttributeTable table.
  */
object UserAttributeTable {
  val db: slick.Database = play.api.db.slick.DB
  val userAttributes: TableQuery[UserAttributeTable] = TableQuery[UserAttributeTable]

  def countUserAttributes: Int = db.withTransaction { implicit session =>
    userAttributes.length.run
  }

  def save(newSess: UserAttribute): Int = db.withTransaction { implicit session =>
    val newId: Int = (userAttributes returning userAttributes.map(_.userAttributeId)) += newSess
    newId
  }
}
