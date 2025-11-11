package models.validation

import com.google.inject.ImplementedBy
import models.audit.GenericComment
import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class ValidationTaskComment(
    validationTaskCommentId: Int,
    missionId: Int,
    labelId: Int,
    userId: String,
    ipAddress: String,
    panoId: String,
    heading: Double,
    pitch: Double,
    zoom: Double,
    lat: Double,
    lng: Double,
    timestamp: OffsetDateTime,
    comment: String
)

class ValidationTaskCommentTableDef(tag: Tag) extends Table[ValidationTaskComment](tag, "validation_task_comment") {
  def validationTaskCommentId: Rep[Int] = column[Int]("validation_task_comment_id", O.PrimaryKey, O.AutoInc)
  def missionId: Rep[Int]               = column[Int]("mission_id")
  def labelId: Rep[Int]                 = column[Int]("label_id")
  def userId: Rep[String]               = column[String]("user_id")
  def ipAddress: Rep[String]            = column[String]("ip_address")
  def panoId: Rep[String]               = column[String]("pano_id")
  def heading: Rep[Double]              = column[Double]("heading")
  def pitch: Rep[Double]                = column[Double]("pitch")
  def zoom: Rep[Double]                 = column[Double]("zoom")
  def lat: Rep[Double]                  = column[Double]("lat")
  def lng: Rep[Double]                  = column[Double]("lng")
  def timestamp: Rep[OffsetDateTime]    = column[OffsetDateTime]("timestamp")
  def comment: Rep[String]              = column[String]("comment")

  def * = (validationTaskCommentId, missionId, labelId, userId, ipAddress, panoId, heading, pitch, zoom, lat, lng,
    timestamp, comment) <> ((ValidationTaskComment.apply _).tupled, ValidationTaskComment.unapply)
}

@ImplementedBy(classOf[ValidationTaskCommentTable])
trait ValidationTaskCommentTableRepository {}

@Singleton
class ValidationTaskCommentTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    implicit val ec: ExecutionContext
) extends ValidationTaskCommentTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val validationTaskComments = TableQuery[ValidationTaskCommentTableDef]
  val users                  = TableQuery[SidewalkUserTableDef]

  def insert(comment: ValidationTaskComment): DBIO[Int] = {
    (validationTaskComments returning validationTaskComments.map(_.validationTaskCommentId)) += comment
  }

  def deleteIfExists(labelId: Int, missionId: Int): DBIO[Int] = {
    validationTaskComments.filter(comment => comment.labelId === labelId && comment.missionId === missionId).delete
  }

  /**
   * Take last n comments from any Validate page.
   */
  def getRecentValidateComments(n: Int): DBIO[Seq[GenericComment]] = {
    (for {
      (c, u) <- validationTaskComments.join(users).on(_.userId === _.userId).sortBy(_._1.timestamp.desc)
    } yield ("validation", u.username, c.panoId, c.timestamp, c.comment, c.heading, c.pitch, c.zoom, c.labelId))
      .take(n)
      .result
      .map(_.map(c => GenericComment(c._1, c._2, c._3, c._4, c._5, c._6, c._7, c._8, Some(c._9))))
  }
}
