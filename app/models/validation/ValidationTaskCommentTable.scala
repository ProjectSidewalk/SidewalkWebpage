package models.validation

import java.sql.Timestamp

import models.daos.slick.DBTableDefinitions.UserTable
import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresDriver.api._
import play.api.Play
import play.api.db.slick.DatabaseConfigProvider

import slick.driver.JdbcProfile
import play.api.Play.current

import scala.concurrent.Future
import scala.slick.lifted.ForeignKeyQuery

case class ValidationTaskComment(validationTaskCommentId: Int, missionId: Int, labelId: Int,
                                 userId: String, ipAddress: String, gsvPanoramaId: String,
                                 heading: Double, pitch: Double, zoom: Int, lat: Double,
                                lng: Double, timestamp: Option[Timestamp], comment: String)

class ValidationTaskCommentTable(tag: Tag) extends Table[ValidationTaskComment](tag, Some("sidewalk"), "validation_task_comment") {
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
  def timestamp = column[Option[Timestamp]]("timestamp", O.Nullable)
  def comment = column[String]("comment", O.NotNull)

  def * = (validationTaskCommentId, missionId, labelId, userId, ipAddress, gsvPanoramaId, heading,
    pitch, zoom, lat, lng, timestamp, comment) <> ((ValidationTaskComment.apply _).tupled,
    ValidationTaskComment.unapply)
}

object ValidationTaskCommentTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val validationTaskComments = TableQuery[ValidationTaskCommentTable]

  /**
    * Insert an validation_task_comment record.
    * @param comment ValidationTaskComment object
    * @return
    */
  def save(comment: ValidationTaskComment): Future[Int] = db.run {
    (validationTaskComments returning validationTaskComments.map(_.validationTaskCommentId)) += comment
  }
}
