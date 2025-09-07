package models.attribute

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{Json, OFormat}

import javax.inject.{Inject, Singleton}

case class GlobalAttributeUserAttribute(globalAttributeUserAttributeId: Int, globalAttributeId: Int, userAttributeId: Int)

class GlobalAttributeUserAttributeTableDef(tag: Tag) extends Table[GlobalAttributeUserAttribute](tag, "global_attribute_user_attribute") {
  def globalAttributeUserAttributeId: Rep[Int] = column[Int]("global_attribute_user_attribute_id", O.PrimaryKey, O.AutoInc)
  def globalAttributeId: Rep[Int] = column[Int]("global_attribute_id")
  def userAttributeId: Rep[Int] = column[Int]("user_attribute_id")

  def * = (globalAttributeUserAttributeId, globalAttributeId, userAttributeId) <>
    ((GlobalAttributeUserAttribute.apply _).tupled, GlobalAttributeUserAttribute.unapply)

//  def globalAttribute: ForeignKeyQuery[GlobalAttributeTable, GlobalAttribute] =
//    foreignKey("global_attribute_user_attribute_global_attribute_id_fkey", globalAttributeId, TableQuery[GlobalAttributeTableDef])(_.globalAttributeId)
//
//  def userAttribute: ForeignKeyQuery[UserAttributeTable, UserAttribute] =
//    foreignKey("global_attribute_user_attribute_user_attribute_id_fkey", userAttributeId, TableQuery[UserAttributeTableDef])(_.userAttributeId)
}

@ImplementedBy(classOf[GlobalAttributeUserAttributeTable])
trait GlobalAttributeUserAttributeTableRepository { }

@Singleton
class GlobalAttributeUserAttributeTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)
  extends GlobalAttributeUserAttributeTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  val globalAttributeUserAttributes = TableQuery[GlobalAttributeUserAttributeTableDef]

  def insert(newSess: GlobalAttributeUserAttribute): DBIO[Int] = {
    (globalAttributeUserAttributes returning globalAttributeUserAttributes.map(_.globalAttributeUserAttributeId)) += newSess
  }

  def insertMultiple(attributes: Seq[GlobalAttributeUserAttribute]): DBIO[Seq[Int]] = {
    (globalAttributeUserAttributes returning globalAttributeUserAttributes.map(_.globalAttributeUserAttributeId)) ++= attributes
  }
}

class GlobalAttributeUserAttributeCachedTableDef(tag: slick.lifted.Tag)
  extends Table[GlobalAttributeUserAttribute](tag, "global_attribute_user_attribute_cached") {

  def globalAttributeUserAttributeId: Rep[Int] = column[Int]("global_attribute_user_attribute_id", O.PrimaryKey, O.AutoInc)
  def globalAttributeId: Rep[Int] = column[Int]("global_attribute_id")
  def userAttributeId: Rep[Int] = column[Int]("user_attribute_id")

  def * = (globalAttributeUserAttributeId, globalAttributeId, userAttributeId) <> ((GlobalAttributeUserAttribute.apply _).tupled, GlobalAttributeUserAttribute.unapply)
}

object GlobalAttributeUserAttribute {
  implicit val GlobalAttributeUserAttributeFormat: OFormat[GlobalAttributeUserAttribute] = Json.format[GlobalAttributeUserAttribute]
}
