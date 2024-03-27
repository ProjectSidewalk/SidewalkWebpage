package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.cache.Cache
import scala.slick.lifted.ForeignKeyQuery

case class Tag(tagId: Int, labelTypeId: Int, tag: String)

class TagTable(tagParam: slick.lifted.Tag) extends Table[Tag](tagParam, "tag") {
  def tagId: Column[Int] = column[Int]("tag_id", O.PrimaryKey, O.AutoInc)
  def labelTypeId: Column[Int] = column[Int]("label_type_id")
  def tag: Column[String] = column[String]("tag")

  def * = (tagId, labelTypeId, tag) <> ((Tag.apply _).tupled, Tag.unapply)

  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
    foreignKey("tag_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)
}

object TagTable {
  val db = play.api.db.slick.DB
  val tagTable = TableQuery[TagTable]

  /**
    * Get all records.
    */
  def selectAllTags: List[Tag] = db.withSession { implicit session =>
    Cache.getOrElse("selectAllTags()") {
      tagTable.list
    }
  }

  def selectTagsByLabelType(labelType: String): List[Tag] = db.withSession { implicit session =>
    tagTable
      .innerJoin(LabelTypeTable.labelTypes).on(_.labelTypeId === _.labelTypeId)
      .filter(_._2.labelType === labelType)
      .map(_._1).list
  }
}
