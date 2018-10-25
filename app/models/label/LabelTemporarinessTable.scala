package models.label

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class LabelTemporariness(labelTemporarinessId: Int, labelId: Int, temporary: Boolean)

class LabelTemporarinessTable(tag: slick.lifted.Tag) extends Table[LabelTemporariness](tag, Some("sidewalk"), "label_temporariness") {
  def labelTemporarinessId = column[Int]("label_temporariness_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id")
  def temporary = column[Boolean]("temporary")

  def * = (labelTemporarinessId, labelId, temporary) <> ((LabelTemporariness.apply _).tupled, LabelTemporariness.unapply)
}

object LabelTemporarinessTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val labelTemporarinesses = TableQuery[LabelTemporarinessTable]

  /**
    * Find a label temporariness
    *
    * @param labelId
    * @return
    */
  def find(labelId: Int): Option[LabelTemporariness] = db.withSession { implicit session =>
    val labelList = labelTemporarinesses.filter(_.labelId === labelId).list
    labelList.headOption
  }

  /**
    * Saves a new label temporariness to the table
    *
    * @param labelTemp
    * @return
    */
  def save(labelTemp: LabelTemporariness): Int = db.withTransaction { implicit session =>
    val labelTemporarinessId: Int =
      (labelTemporarinesses returning labelTemporarinesses.map(_.labelTemporarinessId)) += labelTemp
    labelTemporarinessId
  }

  /**
    * Updates temporariness of the specified id to be newTemp.
    *
    * @param tempId
    * @param newTemp
    * @return
    */
  def updateTemporariness(tempId: Int, newTemp: Boolean) = db.withTransaction { implicit session =>
    val temporaryLabelRecords = labelTemporarinesses.filter(_.labelTemporarinessId === tempId).map(x => x.temporary)
    temporaryLabelRecords.update(newTemp)
  }
}

