package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class Label(labelId: Int, auditTaskId: Int, gsvPanoramaId: String, labelTypeId: Int,
                 photographerHeading: Double, photographerPitch: Double, deleted: Boolean)

/**
 *
 */
class LabelTable(tag: Tag) extends Table[Label](tag, Some("sidewalk"), "label") {
  def labelId = column[Int]("label_id", O.PrimaryKey)
  def auditTaskId = column[Int]("audit_task_id")
  def gsvPanoramaId = column[String]("gsv_panorama_id")
  def labelTypeId = column[Int]("label_type_id")
  def photographerHeading = column[Double]("photographer_heading")
  def photographerPitch = column[Double]("photographer_pitch")
  def deleted = column[Boolean]("deleted")

  def * = (labelId, auditTaskId, gsvPanoramaId, labelTypeId, deleted) <> ((Label.apply _).tupled, Label.unapply)
}

/**
 * Data access object for the label table
 */
object LabelTable {
  val db = play.api.db.slick.DB
  val labels = TableQuery[LabelTable]
}

