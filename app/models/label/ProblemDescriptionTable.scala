package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class ProblemDescription(problemDescriptionId: Int, labelId: Int, description: String)

class ProblemDescriptionTable(tag: slick.lifted.Tag) extends Table[ProblemDescription](tag, Some("sidewalk"), "problem_description") {
  def problemDescriptionId = column[Int]("problem_description_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def description = column[String]("description", O.NotNull)

  def * = (problemDescriptionId, labelId, description) <> ((ProblemDescription.apply _).tupled, ProblemDescription.unapply)
}

object ProblemDescriptionTable {
  val db = play.api.db.slick.DB
  val problemDescriptions = TableQuery[ProblemDescriptionTable]

  /**
    * Find a problem description
    *
    * @param labelId
    * @return
    */
  def find(labelId: Int): Option[ProblemDescription] = db.withSession { implicit session =>
    val descriptions = problemDescriptions.filter(_.labelId === labelId).list
    descriptions.headOption
  }

  /**
    * Saves a new problem description to the table
    * @param pd
    * @return
    */
  def save(pd: ProblemDescription): Int = db.withTransaction { implicit session =>
    val problemDescriptionId: Int =
      (problemDescriptions returning problemDescriptions.map(_.problemDescriptionId)) += pd
    problemDescriptionId
  }

  /**
    * Updates description of the specified id to be newDescription.
    *
    * @param descriptionId
    * @param newDescription
    * @return
    */
  def updateDescription(descriptionId: Int, newDescription: String) = db.withTransaction { implicit session =>
    val description = problemDescriptions.filter(_.problemDescriptionId === descriptionId).map(x => x.description)
    description.update(newDescription)
  }
}

