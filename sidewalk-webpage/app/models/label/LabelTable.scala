package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class Label(labelId: Int, auditTaskId: Int, gsvPanoramaId: String, labelTypeId: Int,
                 photographerHeading: Float, photographerPitch: Float, deleted: Boolean)

/**
 *
 */
class LabelTable(tag: Tag) extends Table[Label](tag, Some("sidewalk"), "label") {
  def labelId = column[Int]("label_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id")
  def gsvPanoramaId = column[String]("gsv_panorama_id")
  def labelTypeId = column[Int]("label_type_id")
  def photographerHeading = column[Float]("photographer_heading")
  def photographerPitch = column[Float]("photographer_pitch")
  def deleted = column[Boolean]("deleted")

  def * = (labelId, auditTaskId, gsvPanoramaId, labelTypeId, photographerHeading, photographerPitch, deleted) <> ((Label.apply _).tupled, Label.unapply)
}

/**
 * Data access object for the label table
 */
object LabelTable {
  val db = play.api.db.slick.DB
  val labels = TableQuery[LabelTable]

  /**
   * Saves a new labe in the table
   * @param label
   * @return
   */
  def save(label: Label): Int = db.withTransaction { implicit session =>
    val labelId: Int =
      (labels returning labels.map(_.labelId)) += label
    labelId
  }
}

