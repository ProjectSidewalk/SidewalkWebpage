package models.validation

import java.sql.Timestamp
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class ValidationTaskComment(validationTaskCommentId: Int, missionId: Int, labelId: Int,
                                 userId: String, ipAddress: String, gsvPanoramaId: String,
                                 heading: Double, pitch: Double, zoom: Int, lat: Double,
                                lng: Double, timestamp: Timestamp, comment: String)

class ValidationTaskCommentTable(tag: Tag) extends Table[ValidationTaskComment](tag, "validation_task_comment") {
  def validationTaskCommentId = column[Int]("validation_task_comment_id", O.PrimaryKey, O.AutoInc)
  def missionId = column[Int]("mission_id", O.NotNull)
  def labelId = column[Int]("label_id", O.NotNull)
  def userId = column[String]("user_id", O.NotNull)
  def ipAddress = column[String]("ip_address", O.NotNull)
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.NotNull)
  def heading = column[Double]("heading", O.NotNull)
  def pitch = column[Double]("pitch", O.NotNull)
  def zoom = column[Int]("zoom", O.NotNull)
  def lat = column[Double]("lat", O.NotNull)
  def lng = column[Double]("lng", O.NotNull)
  def timestamp = column[Timestamp]("timestamp", O.Nullable)
  def comment = column[String]("comment", O.NotNull)

  def * = (validationTaskCommentId, missionId, labelId, userId, ipAddress, gsvPanoramaId, heading,
    pitch, zoom, lat, lng, timestamp, comment) <> ((ValidationTaskComment.apply _).tupled,
    ValidationTaskComment.unapply)
}

object ValidationTaskCommentTable {
  val db = play.api.db.slick.DB
  val validationTaskComments = TableQuery[ValidationTaskCommentTable]

  /**
    * Insert an validation_task_comment record.
    */
  def save(comment: ValidationTaskComment): Int = db.withSession { implicit session =>
    (validationTaskComments returning validationTaskComments.map(_.validationTaskCommentId)) += comment
  }

  /**
    * Delete a validation_task_comment record.
    */
  def deleteIfExists(labelId: Int, missionId: Int): Int = db.withSession { implicit session =>
    validationTaskComments.filter(comment => comment.labelId === labelId && comment.missionId === missionId).delete
  }
}
