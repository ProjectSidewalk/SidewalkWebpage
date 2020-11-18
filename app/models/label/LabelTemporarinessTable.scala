package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class LabelTemporariness(labelTemporarinessId: Int, labelId: Int, temporary: Boolean)

class LabelTemporarinessTable(tag: slick.lifted.Tag) extends Table[LabelTemporariness](tag, Some("sidewalk"), "label_temporariness") {
  def labelTemporarinessId = column[Int]("label_temporariness_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def temporary = column[Boolean]("temporary", O.NotNull)

  def * = (labelTemporarinessId, labelId, temporary) <> ((LabelTemporariness.apply _).tupled, LabelTemporariness.unapply)
}

object LabelTemporarinessTable {
  val db = play.api.db.slick.DB
  val labelTemporarinesses = TableQuery[LabelTemporarinessTable]

  /**
    * Find a label temporariness.
    */
  def find(labelId: Int): Option[LabelTemporariness] = db.withSession { implicit session =>
    val labelList = labelTemporarinesses.filter(_.labelId === labelId).list
    labelList.headOption
  }

  /**
    * Saves a new label temporariness to the table.
    */
  def save(labelTemp: LabelTemporariness): Int = db.withTransaction { implicit session =>
    val labelTemporarinessId: Int =
      (labelTemporarinesses returning labelTemporarinesses.map(_.labelTemporarinessId)) += labelTemp
    labelTemporarinessId
  }

  /**
    * Updates temporariness of the specified id to be newTemp.
    */
  def updateTemporariness(tempId: Int, newTemp: Boolean): Int = db.withTransaction { implicit session =>
    val temporaryLabelRecords = labelTemporarinesses.filter(_.labelTemporarinessId === tempId).map(x => x.temporary)
    temporaryLabelRecords.update(newTemp)
  }
}
