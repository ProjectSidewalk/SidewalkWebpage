package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class ProblemDescription(problemSeverityId: Int, labelId: Int, description: String)

class ProblemDescriptionTable(tag: Tag) extends Table[ProblemDescription](tag, Some("sidewalk"), "problem_description") {
  def problemDescriptionId = column[Int]("problem_description_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def description = column[String]("description", O.NotNull)

  def * = (problemDescriptionId, labelId, description) <> ((ProblemDescription.apply _).tupled, ProblemDescription.unapply)
}

object ProblemDescriptionTable {
  val db = play.api.db.slick.DB
  val problemDescriptions = TableQuery[ProblemDescriptionTable]

  /**
    * Saves a new problem temporariness to the table
    * @param pd
    * @return
    */
  def save(pd: ProblemDescription): Int = db.withTransaction { implicit session =>
    val problemDescriptionId: Int =
      (problemDescriptions returning problemDescriptions.map(_.problemDescriptionId)) += pd
    problemDescriptionId
  }
}

