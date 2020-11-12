package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class LabelDescription(labelDescriptionId: Int, labelId: Int, description: String)

class LabelDescriptionTable(tag: slick.lifted.Tag) extends Table[LabelDescription](tag, Some("sidewalk"), "label_description") {
  def labelDescriptionId = column[Int]("label_description_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def description = column[String]("description", O.NotNull)

  def * = (labelDescriptionId, labelId, description) <> ((LabelDescription.apply _).tupled, LabelDescription.unapply)
}

object LabelDescriptionTable {
  val db = play.api.db.slick.DB
  val labelDescriptions = TableQuery[LabelDescriptionTable]

  /**
    * Find a label description.
    */
  def find(labelId: Int): Option[LabelDescription] = db.withSession { implicit session =>
    val descriptions = labelDescriptions.filter(_.labelId === labelId).list
    descriptions.headOption
  }

  /**
    * Saves a new label description to the table.
    */
  def save(pd: LabelDescription): Int = db.withTransaction { implicit session =>
    val labelDescriptionId: Int =
      (labelDescriptions returning labelDescriptions.map(_.labelDescriptionId)) += pd
    labelDescriptionId
  }

  /**
    * Updates description of the specified id to be newDescription.
    */
  def updateDescription(descriptionId: Int, newDescription: String): Int = db.withTransaction { implicit session =>
    val description = labelDescriptions.filter(_.labelDescriptionId === descriptionId).map(x => x.description)
    description.update(newDescription)
  }
}
