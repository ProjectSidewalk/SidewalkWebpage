package models.attribute

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class UserAttribute(
    userAttributeId: Int,
    userClusteringSessionId: Int,
    clusteringThreshold: Float,
    labelTypeId: Int,
    regionId: Int,
    lat: Float,
    lng: Float,
    severity: Option[Int]
)

class UserAttributeTableDef(tag: Tag) extends Table[UserAttribute](tag, "user_attribute") {
  def userAttributeId: Rep[Int]         = column[Int]("user_attribute_id", O.PrimaryKey, O.AutoInc)
  def userClusteringSessionId: Rep[Int] = column[Int]("user_clustering_session_id")
  def clusteringThreshold: Rep[Float]   = column[Float]("clustering_threshold")
  def labelTypeId: Rep[Int]             = column[Int]("label_type_id")
  def regionId: Rep[Int]                = column[Int]("region_id")
  def lat: Rep[Float]                   = column[Float]("lat")
  def lng: Rep[Float]                   = column[Float]("lng")
  def severity: Rep[Option[Int]]        = column[Option[Int]]("severity")

  def * = (userAttributeId, userClusteringSessionId, clusteringThreshold, labelTypeId, regionId, lat, lng, severity) <>
    ((UserAttribute.apply _).tupled, UserAttribute.unapply)

//  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
//    foreignKey("user_attribute_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTableDef])(_.labelTypeId)
//
//  def region: ForeignKeyQuery[RegionTable, Region] =
//    foreignKey("user_attribute_region_id_fkey", regionId, TableQuery[RegionTableDef])(_.regionId)
//
//  def userClusteringSession: ForeignKeyQuery[UserClusteringSessionTable, UserClusteringSession] =
//    foreignKey("user_attribute_user_clustering_session_id_fkey", userClusteringSessionId, TableQuery[UserClusteringSessionTableDef])(_.userClusteringSessionId)
}

@ImplementedBy(classOf[UserAttributeTable])
trait UserAttributeTableRepository {}

@Singleton
class UserAttributeTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends UserAttributeTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val userAttributes = TableQuery[UserAttributeTableDef]

  def countUserAttributes: DBIO[Int] = {
    userAttributes.length.result
  }

  def insert(newSess: UserAttribute): DBIO[Int] = {
    (userAttributes returning userAttributes.map(_.userAttributeId)) += newSess
  }

  def saveMultiple(attributes: Seq[UserAttribute]): DBIO[Seq[Int]] = {
    (userAttributes returning userAttributes.map(_.userAttributeId)) ++= attributes
  }
}
