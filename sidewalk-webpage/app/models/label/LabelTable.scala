package models.label

import models.audit.{AuditTask, AuditTaskTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class Label(labelId: Int, auditTaskId: Int, gsvPanoramaId: String, labelTypeId: Int,
                 photographerHeading: Float, photographerPitch: Float, deleted: Boolean)

/**
 *
 */
class LabelTable(tag: Tag) extends Table[Label](tag, Some("sidewalk"), "label") {
  def labelId = column[Int]("label_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.NotNull)
  def labelTypeId = column[Int]("label_type_id", O.NotNull)
  def photographerHeading = column[Float]("photographer_heading", O.NotNull)
  def photographerPitch = column[Float]("photographer_pitch", O.NotNull)
  def deleted = column[Boolean]("deleted", O.NotNull)

  def * = (labelId, auditTaskId, gsvPanoramaId, labelTypeId, photographerHeading, photographerPitch, deleted) <> ((Label.apply _).tupled, Label.unapply)

  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
    foreignKey("label_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)

  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
    foreignKey("label_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)

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

