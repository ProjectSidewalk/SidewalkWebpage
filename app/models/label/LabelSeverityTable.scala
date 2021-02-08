package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class LabelSeverity(labelSeverityId: Int, labelId: Int, severity: Int)

class LabelSeverityTable(tag: slick.lifted.Tag) extends Table[LabelSeverity](tag, Some("sidewalk"), "label_severity") {
  def labelSeverityId = column[Int]("label_severity_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def severity = column[Int]("severity", O.NotNull)

  def * = (labelSeverityId, labelId, severity) <> ((LabelSeverity.apply _).tupled, LabelSeverity.unapply)
}

object LabelSeverityTable {
  val db = play.api.db.slick.DB
  val labelSeverities = TableQuery[LabelSeverityTable]

  /**
    * Find a label severity.
    */
  def find(labelId: Int): Option[LabelSeverity] = db.withSession { implicit session =>
    val labelList = labelSeverities.filter(_.labelId === labelId).list
    labelList.headOption
  }

  /**
    * Saves a new label severity to the table.
    */
  def save(labelSev: LabelSeverity): Int = db.withTransaction { implicit session =>
    val labelSeverityId: Int =
      (labelSeverities returning labelSeverities.map(_.labelSeverityId)) += labelSev
    labelSeverityId
  }

  /**
    * Updates severity of the specified id to be newSeverity.
    */
  def updateSeverity(severityId: Int, newSeverity: Int) = db.withTransaction { implicit session =>
    val severities = for { label <- labelSeverities if label.labelSeverityId === severityId } yield label.severity
    severities.update(newSeverity)
  }
}
