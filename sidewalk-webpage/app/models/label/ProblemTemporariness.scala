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
    * Saves a new problem temporariness to the table
    * @param pt
    * @return
    */
  def save(pt: ProblemTemporariness): Int = db.withTransaction { implicit session =>
    val problemTemporarinessId: Int =
      (problemTemporarinesses returning problemTemporarinesses.map(_.problemTemporarinessId)) += pt
    problemTemporarinessId
  }
}

