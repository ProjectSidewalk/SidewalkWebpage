package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class LabelType(labelTypeId: Int, labelType: String, description: String)

/**
 *
 */
class LabelTypeTable(tag: Tag) extends Table[LabelType](tag, Some("sidewalk"), "label_type") {
  def labelTypeId = column[Int]("label_type_id", O.PrimaryKey)
  def labelType = column[String]("label_type", O.NotNull)
  def description = column[String]("description")

  def * = (labelTypeId, labelType, description) <> ((LabelType.apply _).tupled, LabelType.unapply)
}

/**
 * Data access object for the label table
 */
object LabelTypeTable {
  val db = play.api.db.slick.DB
  val labelTypes = TableQuery[LabelTypeTable]
}

