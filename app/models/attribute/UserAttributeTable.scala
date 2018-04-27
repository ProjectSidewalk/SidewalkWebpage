package models.attribute

/**
  * Created by misaugstad on 4/27/17.
  */

import models.label.{LabelType, LabelTypeTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick

import scala.slick.lifted.{ForeignKeyQuery, ProvenShape}
import scala.language.postfixOps

case class UserAttribute(userAttributeId: Int,
                         userClusteringSessionId: Int,
                         clusteringThreshold: Float,
                         labelTypeId: Int,
                         lat: Float, lng: Float,
                         severity: Option[Int],
                         temporary: Boolean)


class UserAttributeTable(tag: Tag) extends Table[UserAttribute](tag, Some("sidewalk"), "user_attribute") {
  def userAttributeId: Column[Int] = column[Int]("user_attribute_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def userClusteringSessionId: Column[Int] = column[Int]("user_clustering_session_id", O.NotNull)
  def clusteringThreshold: Column[Float] = column[Float]("clustering_threshold", O.NotNull)
  def labelTypeId: Column[Int] = column[Int]("label_type_id", O.NotNull)
  def lat: Column[Float] = column[Float]("lat", O.NotNull)
  def lng: Column[Float] = column[Float]("lng", O.NotNull)
  def severity: Column[Option[Int]] = column[Option[Int]]("user_id")
  def temporary: Column[Boolean] = column[Boolean]("temporary", O.NotNull)

  def * : ProvenShape[UserAttribute] = (userAttributeId,
                                        userClusteringSessionId,
                                        clusteringThreshold,
                                        labelTypeId,
                                        lat, lng,
                                        severity,
                                        temporary) <>
    ((UserAttribute.apply _).tupled, UserAttribute.unapply)

  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
    foreignKey("user_attribute_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)

  def userClusteringSession: ForeignKeyQuery[UserClusteringSessionTable, UserClusteringSession] =
    foreignKey("user_attribute_user_clustering_session_id_fkey", userClusteringSessionId, TableQuery[UserClusteringSessionTable])(_.userClusteringSessionId)
}

/**
  * Data access object for the UserAttributeTable table
  */
object UserAttributeTable {
  val db: slick.Database = play.api.db.slick.DB
  val userAttributes: TableQuery[UserAttributeTable] = TableQuery[UserAttributeTable]

  def getAllSessions: List[UserAttribute] = db.withTransaction { implicit session =>
    userAttributes.list
  }

  def save(newSess: UserAttribute): Int = db.withTransaction { implicit session =>
    val newId: Int = (userAttributes returning userAttributes.map(_.userAttributeId)) += newSess
    newId
  }
}
