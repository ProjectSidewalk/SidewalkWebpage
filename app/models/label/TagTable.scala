package models.label

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import slick.lifted.ForeignKeyQuery

case class Tag(tagId: Int, labelTypeId: Int, tag: String)

class TagTable(tagParam: slick.lifted.Tag) extends Table[Tag](tagParam, Some("sidewalk"), "tag") {
  def tagId: Rep[Int] = column[Int]("tag_id", O.PrimaryKey, O.AutoInc)
  def labelTypeId: Rep[Int] = column[Int]("label_type_id")
  def tag: Rep[String] = column[String]("tag")

  def * = (tagId, labelTypeId, tag) <> ((Tag.apply _).tupled, Tag.unapply)

  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
    foreignKey("tag_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)
}

object TagTable {
  val db = play.api.db.slick.DB
  val tagTable = TableQuery[TagTable]

  /**
    * Get all records.
    *
    * @return
    */
  def selectAllTags(): List[Tag] = db.withSession { implicit session =>
    tagTable.list
  }
}
