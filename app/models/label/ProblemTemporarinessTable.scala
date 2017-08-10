package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class ProblemTemporariness(problemTemporarinessId: Int, labelId: Int, temporaryProblem: Boolean)

class ProblemTemporarinessTable(tag: Tag) extends Table[ProblemTemporariness](tag, Some("sidewalk"), "problem_temporariness") {
  def problemTemporarinessId = column[Int]("problem_temporariness_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def temporaryProblem = column[Boolean]("temporary_problem", O.NotNull)

  def * = (problemTemporarinessId, labelId, temporaryProblem) <> ((ProblemTemporariness.apply _).tupled, ProblemTemporariness.unapply)
}

object ProblemTemporarinessTable {
  val db = play.api.db.slick.DB
  val problemTemporarinesses = TableQuery[ProblemTemporarinessTable]

  /**
    * Find a problem temporariness
    *
    * @param labelId
    * @return
    */
  def find(labelId: Int): Option[ProblemTemporariness] = db.withSession { implicit session =>
    val labelList = problemTemporarinesses.filter(_.labelId === labelId).list
    labelList.headOption
  }

  /**
    * Saves a new problem temporariness to the table
    * @param pt
    * @return
    */
  def save(pt: ProblemTemporariness): Int = db.withTransaction { implicit session =>
    val problemTemporarinessId: Int =
      (problemTemporarinesses returning problemTemporarinesses.map(_.problemTemporarinessId)) += pt
    problemTemporarinessId
  }

  /**
    * Updates temporariness of the specified id to be newTemp.
    *
    * @param tempId
    * @param newTemp
    * @return
    */
  def updateTemporariness(tempId: Int, newTemp: Boolean) = db.withTransaction { implicit session =>
    val temporaryLabelRecords = problemTemporarinesses.filter(_.problemTemporarinessId === tempId).map(x => x.temporaryProblem)
    temporaryLabelRecords.update(newTemp)
  }
}

