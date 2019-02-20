package models.label

import java.sql.Timestamp
import java.util.UUID

import models.utils.MyPostgresDriver.api._
import play.api.Play
import play.api.db.slick.DatabaseConfigProvider

import slick.driver.JdbcProfile
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

import scala.concurrent.Future

case class LabelValidation(validationId: Int,
                           labelId: Int,
                           labelValidationId: Int,
                           userId: String,
                           missionId: Int,
                           canvasX: Int,
                           canvasY: Int,
                           heading: Float,
                           pitch: Float,
                           zoom: Float,
                           canvasHeight: Int,
                           canvasWidth: Int,
                           startTimestamp: java.sql.Timestamp,
                           endTimestamp: java.sql.Timestamp)


/**
  * Stores data from each validation interaction
  * https://www.programcreek.com/scala/slick.lifted.ForeignKeyQuery
  * @param tag
  */
class LabelValidationTable (tag: slick.lifted.Tag) extends Table[LabelValidation](tag, Some("sidewalk"), "label_validation") {
  def labelValidationId = column[Int]("label_validation_id", O.AutoInc)
  def labelId = column[Int]("label_id")
  def validationResult = column[Int]("validation_result")
  def userId = column[String]("user_id")
  def missionId = column[Int]("mission_id")
  def canvasX = column[Int]("canvas_x")
  def canvasY = column[Int]("canvas_y")
  def heading = column[Float]("heading")
  def pitch = column[Float]("pitch")
  def zoom = column[Float]("zoom")
  def canvasHeight = column[Int]("canvas_height")
  def canvasWidth = column[Int]("canvas_width")
  def startTimestamp = column[java.sql.Timestamp]("start_timestamp")
  def endTimestamp = column[java.sql.Timestamp]("end_timestamp")

  def * = (labelValidationId, labelId, validationResult, userId, missionId, canvasX, canvasY,
    heading, pitch, zoom, canvasHeight, canvasWidth, startTimestamp, endTimestamp) <>
    ((LabelValidation.apply _).tupled, LabelValidation.unapply)
}

/**
  * Data access table for label validation table
  */
object LabelValidationTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val labelValidationTable = TableQuery[LabelValidationTable]

  def save(label: LabelValidation): Future[Int] = db.run {
    (labelValidationTable returning labelValidationTable.map(_.labelValidationId)) += label
  }
}
