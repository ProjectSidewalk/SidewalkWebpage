package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class ProblemSeverity(problemSeverityId: Int, labelId: Int, severity: Int)

class ProblemSeverityTable(tag: Tag) extends Table[ProblemSeverity](tag, Some("sidewalk"), "problem_severity") {
  def problemSeverityId = column[Int]("problem_severity_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def severity = column[Int]("severity", O.NotNull)

  def * = (problemSeverityId, labelId, severity) <> ((ProblemSeverity.apply _).tupled, ProblemSeverity.unapply)
}

object ProblemSeverityTable {
  val db = play.api.db.slick.DB
  val problemSeverities = TableQuery[ProblemSeverityTable]

  /**
    * Find a problem severity
    *
    * @param labelId
    * @return
    */
  def find(labelId: Int): Option[ProblemSeverity] = db.withSession { implicit session =>
    val labelList = problemSeverities.filter(_.labelId === labelId).list
    labelList.headOption
  }

  /**
    * Saves a new problem temporariness to the table
    * @param ps
    * @return
    */
  def save(ps: ProblemSeverity): Int = db.withTransaction { implicit session =>
    val problemSeverityId: Int =
      (problemSeverities returning problemSeverities.map(_.problemSeverityId)) += ps
    problemSeverityId
  }

  /**
    * Updates severity of the specified id to be newSeverity.
    *
    * @param severityId
    * @param newSeverity
    * @return
    */
  def updateSeverity(severityId: Int, newSeverity: Int) = db.withTransaction { implicit session =>
    val severities = problemSeverities.filter(_.problemSeverityId === severityId).map(x => x.severity)
    severities.update(newSeverity)
  }
}

