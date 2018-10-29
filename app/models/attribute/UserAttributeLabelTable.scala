package models.attribute

/**
  * Created by misaugstad on 4/27/17.
  */

import models.label.{Label, LabelTable}
import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import slick.lifted.{ProvenShape, Tag}
import scala.language.postfixOps

case class UserAttributeLabel(userAttributeLabelId: Int, userAttributeId: Int, labelId: Int)


class UserAttributeLabelTable(tag: Tag) extends Table[UserAttributeLabel](tag, Some("sidewalk"), "user_attribute_label") {
  def userAttributeLabelId: Rep[Int] = column[Int]("user_attribute_label_id", O.PrimaryKey, O.AutoInc)
  def userAttributeId: Rep[Int] = column[Int]("user_attribute_id")
  def labelId: Rep[Int] = column[Int]("label_id")

  def * : ProvenShape[UserAttributeLabel] = (userAttributeLabelId, userAttributeId, labelId) <>
    ((UserAttributeLabel.apply _).tupled, UserAttributeLabel.unapply)

  def userAttribute = foreignKey("user_attribute_label_user_attribute_id_fkey", userAttributeId, TableQuery[UserAttributeTable])(_.userAttributeId)

  def label = foreignKey("user_attribute_label_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)
}

/**
  * Data access object for the UserAttributeLabelTable table
  */
object UserAttributeLabelTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val userAttributeLabels: TableQuery[UserAttributeLabelTable] = TableQuery[UserAttributeLabelTable]

  def getAllUserAttributeLabels: List[UserAttributeLabel] = db.withTransaction { implicit session =>
    userAttributeLabels.list
  }

  def countUserAttributeLabels: Int = db.withTransaction { implicit session =>
    userAttributeLabels.length.run
  }

  def save(newAttribute: UserAttributeLabel): Int = db.withTransaction { implicit session =>
    val newId: Int = (userAttributeLabels returning userAttributeLabels.map(_.userAttributeLabelId)) += newAttribute
    newId
  }
}
