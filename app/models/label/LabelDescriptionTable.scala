package models.label

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class LabelDescription(labelDescriptionId: Int, labelId: Int, description: String)

class LabelDescriptionTable(tag: slick.lifted.Tag) extends Table[LabelDescription](tag, Some("sidewalk"), "label_description") {
  def labelDescriptionId = column[Int]("label_description_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id")
  def description = column[String]("description")

  def * = (labelDescriptionId, labelId, description) <> ((LabelDescription.apply _).tupled, LabelDescription.unapply)
}

object LabelDescriptionTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val labelDescriptions = TableQuery[LabelDescriptionTable]

  /**
   * Find a label description
   *
   * @param labelId
   * @return
   */
  def find(labelId: Int): Future[Option[LabelDescription]] = {
    db.run(labelDescriptions.filter(_.labelId === labelId).result.headOption)
  }

  /**
   * Saves a new label description to the table
   * @param pd
   * @return Number of rows updated (should be 1)
   */
  def save(pd: LabelDescription): Future[Int] = {
    db.run(((labelDescriptions returning labelDescriptions.map(_.labelDescriptionId)) += pd).transactionally)
  }

  /**
   * Updates description of the specified id to be newDescription.
   *
   * @param descriptionId
   * @param newDescription
   * @return Number of rows updated (should be 1)
   */
  def updateDescription(descriptionId: Int, newDescription: String): Future[Int] = db.run {
    labelDescriptions.filter(_.labelDescriptionId === descriptionId).map(x => x.description).update(newDescription).transactionally
  }
}

