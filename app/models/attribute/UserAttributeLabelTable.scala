package models.attribute

import models.label.{Label, LabelTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick
import scala.slick.lifted.{ForeignKeyQuery, ProvenShape, Tag}
import scala.language.postfixOps

case class UserAttributeLabel(userAttributeLabelId: Int, userAttributeId: Int, labelId: Int)

class UserAttributeLabelTable(tag: Tag) extends Table[UserAttributeLabel](tag, "user_attribute_label") {
  def userAttributeLabelId: Column[Int] = column[Int]("user_attribute_label_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def userAttributeId: Column[Int] = column[Int]("user_attribute_id", O.NotNull)
  def labelId: Column[Int] = column[Int]("label_id", O.NotNull)

  def * : ProvenShape[UserAttributeLabel] = (userAttributeLabelId, userAttributeId, labelId) <>
    ((UserAttributeLabel.apply _).tupled, UserAttributeLabel.unapply)

  def userAttribute: ForeignKeyQuery[UserAttributeTable, UserAttribute] =
    foreignKey("user_attribute_label_user_attribute_id_fkey", userAttributeId, TableQuery[UserAttributeTable])(_.userAttributeId)

  def label: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("user_attribute_label_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)
}

/**
  * Data access object for the UserAttributeLabelTable table.
  */
object UserAttributeLabelTable {
  val db: slick.Database = play.api.db.slick.DB
  val userAttributeLabels: TableQuery[UserAttributeLabelTable] = TableQuery[UserAttributeLabelTable]

  def countUserAttributeLabels: Int = db.withTransaction { implicit session =>
    userAttributeLabels.length.run
  }

  def save(newSess: UserAttributeLabel): Int = db.withTransaction { implicit session =>
    val newId: Int = (userAttributeLabels returning userAttributeLabels.map(_.userAttributeLabelId)) += newSess
    newId
  }
}
