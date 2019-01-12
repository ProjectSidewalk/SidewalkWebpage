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
  def labelId = column[Int]("label_id", O.NotNull)
  def validationResult = column[Int]("validation_result", O.NotNull)
  def userId = column[String]("user_id", O.NotNull)
  def missionId = column[Int]("mission_id", O.NotNull)
  def canvasX = column[Int]("canvas_x", O.NotNull)
  def canvasY = column[Int]("canvas_y", O.NotNull)
  def heading = column[Float]("heading", O.NotNull)
  def pitch = column[Float]("pitch", O.NotNull)
  def zoom = column[Float]("zoom", O.NotNull)
  def canvasHeight = column[Int]("canvas_height", O.NotNull)
  def canvasWidth = column[Int]("canvas_width", O.NotNull)
  def startTimestamp = column[java.sql.Timestamp]("start_timestamp", O.NotNull)
  def endTimestamp = column[java.sql.Timestamp]("end_timestamp", O.NotNull)

  def * = (labelValidationId, labelId, validationResult, userId, missionId, canvasX, canvasY,
    heading, pitch, zoom, canvasHeight, canvasWidth, startTimestamp, endTimestamp) <>
    ((LabelValidation.apply _).tupled, LabelValidation.unapply)
}

/**
  * Data access table for label validation table
  */
object LabelValidationTable {
  val db = play.api.db.slick.DB
  val labelValidationTable = TableQuery[LabelValidationTable]

  def save(label: LabelValidation): Int = db.withTransaction { implicit session =>
    val labelValidationId: Int =
      (labelValidationTable returning labelValidationTable.map(_.labelValidationId)) += label
    labelValidationId
  }
}
