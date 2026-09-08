package models.validation

import com.google.inject.ImplementedBy
import models.audit.GenericComment
import models.label.LabelTableDef
import models.mission.MissionTableDef
import models.pano.PanoDataTableDef
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

  def labelUserUnique =
    index("validation_task_comment_label_id_user_id_unique", (labelId, userId), unique = true)

  def mission =
    foreignKey("validation_task_comment_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)
  def label = foreignKey("validation_task_comment_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
  def user  = foreignKey("validation_task_comment_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def pano  = foreignKey("validation_task_comment_pano_id_fkey", panoId, TableQuery[PanoDataTableDef])(_.panoId)
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

  /**
   * Moves a user's comment on a label out of the live table and into `validation_task_comment_history`.
   *
   * The only way a comment leaves this table, so a validator's words outlive every path that stops showing them
   * (#5076).
   *
   * A single `DELETE ... RETURNING` feeding the insert, rather than a read-then-delete pair: the pair's two
   * statements see different snapshots under READ COMMITTED, so a concurrent replace of the same comment could be
   * archived twice, or deleted after a read that found nothing and so recorded nowhere. Only rows this statement
   * itself deleted reach the history, which is the invariant the table's value rests on. It is also one round trip
   * on the Validate submission path, which runs it once per validation in a batch.
   *
   * Scoped by user rather than by mission: a comment belongs to whoever wrote it, and the mission it was written under
   * has usually rolled over by the time the same user revisits the label from a label card (#4653). Matching on the
   * current mission would strand the old comment on a label whose validation had just been replaced or cleared.
   *
   * @param changeType What is removing the comment, which a later reader cannot recover from the rows alone.
   * @return Count of comments archived, 0 or 1 — (label_id, user_id) is UNIQUE.
   */
  def archive(labelId: Int, userId: String, changeType: ValidationCommentChangeType.Value): DBIO[Int] = {
    sqlu"""WITH superseded AS (
             DELETE FROM validation_task_comment
             WHERE label_id = $labelId AND user_id = $userId
             RETURNING *
           )
           INSERT INTO validation_task_comment_history (validation_task_comment_id, mission_id, label_id, user_id,
                                                        ip_address, pano_id, heading, pitch, zoom, lat, lng,
                                                        timestamp, comment, change_type)
           SELECT validation_task_comment_id, mission_id, label_id, user_id, ip_address, pano_id, heading, pitch,
                  zoom, lat, lng, timestamp, comment, ${changeType.toString}::validation_comment_change_type
           FROM superseded"""
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
