package models.label

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class LabelSeverity(labelSeverityId: Int, labelId: Int, severity: Int)

class LabelSeverityTable(tag: slick.lifted.Tag) extends Table[LabelSeverity](tag, Some("sidewalk"), "label_severity") {
  def labelSeverityId = column[Int]("label_severity_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id")
  def severity = column[Int]("severity")

  def * = (labelSeverityId, labelId, severity) <> ((LabelSeverity.apply _).tupled, LabelSeverity.unapply)
}

object LabelSeverityTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val labelSeverities = TableQuery[LabelSeverityTable]

  /**
    * Find a label severity
    *
    * @param labelId
    * @return
    */
  def find(labelId: Int): Future[Option[LabelSeverity]] = {
    db.run(labelSeverities.filter(_.labelId === labelId).result.headOption)
  }

  /**
    * Saves a new label severity to the table.
    *
    * @param labelSev
    * @return
    */
  def save(labelSev: LabelSeverity): Future[Int] = {
    db.run((labelSeverities returning labelSeverities.map(_.labelSeverityId)) += labelSev)
  }

  /**
    * Updates severity of the specified id to be newSeverity.
    *
    * @param severityId
    * @param newSeverity
    * @return
    */
  def updateSeverity(severityId: Int, newSeverity: Int): Future[Int] = {
    db.run(labelSeverities.filter(_.labelSeverityId === severityId).map(sev => sev.severity).update(newSeverity))
  }
}

