package models.attribute

import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current
import play.api.db.slick

import javax.inject.{Inject, Singleton}
import scala.language.postfixOps

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
trait GlobalAttributeUserAttributeTableRepository {
}

@Singleton
class GlobalAttributeUserAttributeTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends GlobalAttributeUserAttributeTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val globalAttributeUserAttributes = TableQuery[GlobalAttributeUserAttributeTableDef]

//  def save(newSess: GlobalAttributeUserAttribute): Int = {
//    val newId: Int = (globalAttributeUserAttributes returning globalAttributeUserAttributes.map(_.globalAttributeUserAttributeId)) += newSess
//    newId
//  }
}
