package models.attribute

//import models.label.{LabelType, LabelTypeTable}
import com.google.inject.ImplementedBy
import models.region.{Region, RegionTable}
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current
import play.api.db.slick

import javax.inject.{Inject, Singleton}
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

class UserAttributeTableDef(tag: Tag) extends Table[UserAttribute](tag, "user_attribute") {
  def userAttributeId: Rep[Int] = column[Int]("user_attribute_id", O.PrimaryKey, O.AutoInc)
  def userClusteringSessionId: Rep[Int] = column[Int]("user_clustering_session_id")
  def clusteringThreshold: Rep[Float] = column[Float]("clustering_threshold")
  def labelTypeId: Rep[Int] = column[Int]("label_type_id")
  def regionId: Rep[Int] = column[Int]("region_id")
  def lat: Rep[Float] = column[Float]("lat")
  def lng: Rep[Float] = column[Float]("lng")
  def severity: Rep[Option[Int]] = column[Option[Int]]("severity")
  def temporary: Rep[Boolean] = column[Boolean]("temporary")

  def * = (userAttributeId,
                                        userClusteringSessionId,
                                        clusteringThreshold,
                                        labelTypeId,
                                        regionId,
                                        lat, lng,
                                        severity,
                                        temporary) <>
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
trait UserAttributeTableRepository {
  def insert(newSess: UserAttribute): DBIO[Int]
}

@Singleton
class UserAttributeTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends UserAttributeTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val userAttributes = TableQuery[UserAttributeTableDef]

//  def countUserAttributes: Int = {
//    userAttributes.size.run
//  }

  def insert(newSess: UserAttribute): DBIO[Int] = {
      (userAttributes returning userAttributes.map(_.userAttributeId)) += newSess
  }
}
