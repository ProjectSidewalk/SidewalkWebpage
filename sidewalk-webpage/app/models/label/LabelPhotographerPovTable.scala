package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class LabelPhotographerPov(labelPhotographerPovId: Int, labelId: Int, heading: Float, pitch: Float)

/**
 *
 */
class LabelPhotographerPovTable(tag: Tag) extends Table[LabelPhotographerPov](tag, Some("sidewalk"), "label_photographer_pov") {
  def labelPhotographerPovId = column[Int]("label_photographer_pov_id", O.PrimaryKey)
  def labelId = column[Int]("label_id")
  def heading = column[Float]("heading")
  def pitch = column[Float]("pitch")

  def * = (labelPhotographerPovId, labelId, heading, pitch) <> ((LabelPhotographerPov.apply _).tupled, LabelPhotographerPov.unapply)
}

/**
 * Data access object for the label table
 */
object LabelPhotographerPovTable {
  val db = play.api.db.slick.DB
  val photographerPovs = TableQuery[LabelPhotographerPovTable]
}
