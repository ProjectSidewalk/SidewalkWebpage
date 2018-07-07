package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class LabelTag(labelTagId: Int, labelId: Int, tagId: Int)

class LabelTagTable(tagParam: slick.lifted.Tag) extends Table[LabelTag](tagParam, Some("sidewalk"), "label_tag") {
  def labelTagId: Column[Int] = column[Int]("label_tag_id")
  def labelId: Column[Int] = column[Int]("label_id")
  def tagId: Column[Int] = column[Int]("tag_id")

  def * = (labelTagId, labelId, tagId) <> ((LabelTag.apply _).tupled, LabelTag.unapply)

  def label: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("label_tag_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)

  def tag: ForeignKeyQuery[TagTable, Tag] =
    foreignKey("label_tag_tag_id_fkey", tagId, TableQuery[TagTable])(_.tagId)
}

object LabelTagTable {
  val db = play.api.db.slick.DB
  val labelTagTable = TableQuery[LabelTagTable]

  /**
    * Get all records.
    *
    * @return
    */
  def selectAllLabelTags(): List[LabelTag] = db.withSession { implicit session =>
    labelTagTable.list
  }

  /**
    * Save a record.
    *
    * @param labelTag
    * @return
    */
  def save(labelTag: LabelTag) = db.withSession { implicit session =>
    labelTagTable += labelTag
  }
}
