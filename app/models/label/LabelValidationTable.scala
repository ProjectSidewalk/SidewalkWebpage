package models.label

import java.sql.Timestamp
import java.util.UUID
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.slick.lifted.ForeignKeyQuery

case class LabelValidation(validationId: Int,
                           labelId: Int,
                           labelValidationId: Int,
                           userId: String,
                           missionId: Int,
                           startTimestamp: java.sql.Timestamp,
                           endTimestamp: java.sql.Timestamp)


/**
  * Stores data from each validation interaction
  * https://www.programcreek.com/scala/slick.lifted.ForeignKeyQuery
  * @param tag
  */
class LabelValidationTable (tag: slick.lifted.Tag) extends Table[LabelValidation](tag, Some("sidewalk"), "label_validation") {
  def labelValidationId = column[Int]("label_validation_id", O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def validationResult = column[Int]("validation_result", O.NotNull)
  def userId = column[String]("user_id", O.NotNull)
  def missionId = column[Int]("mission_id", O.NotNull)
  def startTimestamp = column[java.sql.Timestamp]("start_timestamp", O.NotNull)
  def endTimestamp = column[java.sql.Timestamp]("end_timestamp", O.NotNull)

  def * = (labelValidationId, labelId, validationResult, userId, missionId, startTimestamp,
    endTimestamp) <> ((LabelValidation.apply _).tupled, LabelValidation.unapply)
}

/**
  * Data access table for label validation table
  */
object LabelValidationTable {
  val db = play.api.db.slick.DB
  val labelValidationTable = TableQuery[LabelValidationTable]

  /**
    * Finds a validated id from the table
    * @param validationTaskId   TaskID for this label
    * @return
    */
  /*
  def find(validationTaskId: int): Option[LabelValidation] = db.withSession { implicit session =>
    val labelList = List(validatedLabels.filter(_.validationTaskId === validationTaskId))
    labelList.headOption
  }
  */

  def save(label: LabelValidation): Int = db.withTransaction { implicit session =>
    val labelValidationId: Int =
      (labelValidationTable returning labelValidationTable.map(_.labelValidationId)) += label
    labelValidationId
  }
}