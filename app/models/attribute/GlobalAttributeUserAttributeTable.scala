package models.attribute

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick
import scala.slick.lifted.{ForeignKeyQuery, ProvenShape}
import scala.language.postfixOps

case class GlobalAttributeUserAttribute(globalAttributeUserAttributeId: Int, globalAttributeId: Int, userAttributeId: Int)

class GlobalAttributeUserAttributeTable(tag: Tag) extends Table[GlobalAttributeUserAttribute](tag, Some("sidewalk"), "global_attribute_user_attribute") {
  def globalAttributeUserAttributeId: Column[Int] = column[Int]("global_attribute_user_attribute_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def globalAttributeId: Column[Int] = column[Int]("global_attribute_id", O.NotNull)
  def userAttributeId: Column[Int] = column[Int]("user_attribute_id", O.NotNull)

  def * : ProvenShape[GlobalAttributeUserAttribute] = (globalAttributeUserAttributeId, globalAttributeId, userAttributeId) <>
    ((GlobalAttributeUserAttribute.apply _).tupled, GlobalAttributeUserAttribute.unapply)

  def globalAttribute: ForeignKeyQuery[GlobalAttributeTable, GlobalAttribute] =
    foreignKey("global_attribute_user_attribute_global_attribute_id_fkey", globalAttributeId, TableQuery[GlobalAttributeTable])(_.globalAttributeId)

  def userAttribute: ForeignKeyQuery[UserAttributeTable, UserAttribute] =
    foreignKey("global_attribute_user_attribute_user_attribute_id_fkey", userAttributeId, TableQuery[UserAttributeTable])(_.userAttributeId)
}

/**
  * Data access object for the GlobalAttributeUserAttributeTable table.
  */
object GlobalAttributeUserAttributeTable {
  val db: slick.Database = play.api.db.slick.DB
  val globalAttributeUserAttributes: TableQuery[GlobalAttributeUserAttributeTable] = TableQuery[GlobalAttributeUserAttributeTable]

  def save(newSess: GlobalAttributeUserAttribute): Int = db.withTransaction { implicit session =>
    val newId: Int = (globalAttributeUserAttributes returning globalAttributeUserAttributes.map(_.globalAttributeUserAttributeId)) += newSess
    newId
  }
}
