package models.validation

import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver

import java.sql.Timestamp
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import javax.inject.{Inject, Singleton}

case class ValidationTaskComment(validationTaskCommentId: Int, missionId: Int, labelId: Int,
                                 userId: String, ipAddress: String, gsvPanoramaId: String,
                                 heading: Double, pitch: Double, zoom: Int, lat: Double,
                                lng: Double, timestamp: Timestamp, comment: String)

class ValidationTaskCommentTableDef(tag: Tag) extends Table[ValidationTaskComment](tag, "validation_task_comment") {
  def validationTaskCommentId: Rep[Int] = column[Int]("validation_task_comment_id", O.PrimaryKey, O.AutoInc)
  def missionId: Rep[Int] = column[Int]("mission_id")
  def labelId: Rep[Int] = column[Int]("label_id")
  def userId: Rep[String] = column[String]("user_id")
  def ipAddress: Rep[String] = column[String]("ip_address")
  def gsvPanoramaId: Rep[String] = column[String]("gsv_panorama_id")
  def heading: Rep[Double] = column[Double]("heading")
  def pitch: Rep[Double] = column[Double]("pitch")
  def zoom: Rep[Int] = column[Int]("zoom")
  def lat: Rep[Double] = column[Double]("lat")
  def lng: Rep[Double] = column[Double]("lng")
  def timestamp: Rep[Timestamp] = column[Timestamp]("timestamp")
  def comment: Rep[String] = column[String]("comment")

  def * = (validationTaskCommentId, missionId, labelId, userId, ipAddress, gsvPanoramaId, heading,
    pitch, zoom, lat, lng, timestamp, comment) <> ((ValidationTaskComment.apply _).tupled,
    ValidationTaskComment.unapply)
}

@ImplementedBy(classOf[ValidationTaskCommentTable])
trait ValidationTaskCommentTableRepository {
  def insert(comment: ValidationTaskComment): DBIO[Int]
}

@Singleton
class ValidationTaskCommentTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends ValidationTaskCommentTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val validationTaskComments = TableQuery[ValidationTaskCommentTableDef]

  def insert(comment: ValidationTaskComment): DBIO[Int] = {
    (validationTaskComments returning validationTaskComments.map(_.validationTaskCommentId)) += comment
 }
//
//  /**
//    * Delete a validation_task_comment record.
//    */
//  def deleteIfExists(labelId: Int, missionId: Int): Int = {
//    validationTaskComments.filter(comment => comment.labelId === labelId && comment.missionId === missionId).delete
//  }
}
