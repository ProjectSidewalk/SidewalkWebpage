package models.label

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class LabelTag(labelTagId: Int, labelId: Int, tagId: Int)

class LabelTagTable(tagParam: slick.lifted.Tag) extends Table[LabelTag](tagParam, Some("sidewalk"), "label_tag") {
  def labelTagId: Rep[Int] = column[Int]("label_tag_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int] = column[Int]("label_id")
  def tagId: Rep[Int] = column[Int]("tag_id")

  def * = (labelTagId, labelId, tagId) <> ((LabelTag.apply _).tupled, LabelTag.unapply)

  def label = foreignKey("label_tag_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)

  def tag = foreignKey("label_tag_tag_id_fkey", tagId, TableQuery[TagTable])(_.tagId)
}

object LabelTagTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val labelTagTable = TableQuery[LabelTagTable]

  /**
   * Get all records.
   *
   * @return
   */
  def selectAllLabelTags(): Future[Seq[LabelTag]] = {
    db.run(labelTagTable.result)
  }

  /**
   * Get all records for the given label_id.
   *
   * @param labelId
   * @return
   */
  def selectTagIdsForLabelId(labelId: Int): Future[Seq[Int]] = {
    db.run(labelTagTable.filter(_.labelId === labelId).map(_.tagId).result)
  }

  /**
   * Delete a record with the given label_id and tag_id.
   *
   * @param labelId
   * @param tagId
   * @return Number of deleted rows.
   */
  def delete(labelId: Int, tagId: Int): Future[Int] = {
    db.run(labelTagTable.filter(labelTag => labelTag.labelId === labelId && labelTag.tagId === tagId).delete)
  }

  /**
   * Save a record.
   *
   * @param labelTag
   * @return Number of added rows (should be 1)
   */
  def save(labelTag: LabelTag): Future[Int] = {
    db.run(labelTagTable += labelTag)
  }
}
