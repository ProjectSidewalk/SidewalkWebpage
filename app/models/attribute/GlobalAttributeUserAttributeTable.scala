package models.attribute

/**
  * Created by misaugstad on 4/27/17.
  */

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import slick.lifted.ProvenShape
import scala.language.postfixOps

case class GlobalAttributeUserAttribute(globalAttributeUserAttributeId: Int, globalAttributeId: Int, userAttributeId: Int)


class GlobalAttributeUserAttributeTable(tag: Tag) extends Table[GlobalAttributeUserAttribute](tag, Some("sidewalk"), "global_attribute_user_attribute") {
  def globalAttributeUserAttributeId: Rep[Int] = column[Int]("global_attribute_user_attribute_id", O.PrimaryKey, O.AutoInc)
  def globalAttributeId: Rep[Int] = column[Int]("global_attribute_id")
  def userAttributeId: Rep[Int] = column[Int]("user_attribute_id")

  def * : ProvenShape[GlobalAttributeUserAttribute] = (globalAttributeUserAttributeId, globalAttributeId, userAttributeId) <>
    ((GlobalAttributeUserAttribute.apply _).tupled, GlobalAttributeUserAttribute.unapply)

  def globalAttribute = foreignKey("global_attribute_user_attribute_global_attribute_id_fkey", globalAttributeId, TableQuery[GlobalAttributeTable])(_.globalAttributeId)

  def userAttribute = foreignKey("global_attribute_user_attribute_user_attribute_id_fkey", userAttributeId, TableQuery[UserAttributeTable])(_.userAttributeId)
}

/**
  * Data access object for the GlobalAttributeUserAttributeTable table
  */
object GlobalAttributeUserAttributeTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val globalAttributeUserAttributes: TableQuery[GlobalAttributeUserAttributeTable] = TableQuery[GlobalAttributeUserAttributeTable]

  def getAllGlobalAttributeUserAttributes: List[GlobalAttributeUserAttribute] = db.withTransaction { implicit session =>
    globalAttributeUserAttributes.list
  }

  def save(newSess: GlobalAttributeUserAttribute): Int = db.withTransaction { implicit session =>
    val newId: Int = (globalAttributeUserAttributes returning globalAttributeUserAttributes.map(_.globalAttributeUserAttributeId)) += newSess
    newId
  }
}
