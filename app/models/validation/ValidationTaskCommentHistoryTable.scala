package models.validation

import models.label.{LabelTableDef, LabelType}
import models.mission.MissionTableDef
import models.pano.PanoDataTableDef
import models.user.SidewalkUserTableDef
import models.utils.IpAddress
import models.utils.MyPostgresProfile.api.{given, _}
import models.utils.{NamedEnum, PgEnumCompanion}

import java.time.OffsetDateTime

/**
 * What ended a version of a validator's comment, backing the `validation_comment_change_type` Postgres enum type.
 *
 * NOTE: if changing these values, update the `validation_comment_change_type` Postgres enum type as well (378.sql).
 */
enum ValidationCommentChangeType(val name: String) extends NamedEnum {

  /** Superseded by new text from the same user, whether typed on the label card or carried in with a new vote. */
  case Edit extends ValidationCommentChangeType("edit")

  /** The user asked for it to be removed, via the label card's Delete control (#5015). */
  case Delete extends ValidationCommentChangeType("delete")

  /** Collateral of the user's vote being cleared or replaced, which is not a request to erase anything. */
  case ValidationChange extends ValidationCommentChangeType("validation_change")
}

object ValidationCommentChangeType
    extends PgEnumCompanion[ValidationCommentChangeType]("validation_comment_change_type")

/**
 * One superseded version of a validator's comment on a label (#5076).
 *
 * The live row and this table's rows for the same (label, user) are a comment's full timeline; a pair with no live
 * row is a comment that ended, and its newest version says how.
 *
 * Append-only: nothing in the app deletes from it, so erasing a contributor's words is a hand-run cleanup.
 *
 * @param validationTaskCommentId The comment row this version copies. Not a foreign key: no such row exists once a
 *                                version of it is written.
 * @param timestamp               When the superseded comment was written.
 * @param supersededAt            When it stopped being the user's comment on the label.
 */
case class ValidationTaskCommentHistory(
    validationTaskCommentHistoryId: Int,
    validationTaskCommentId: Int,
    missionId: Int,
    labelId: Int,
    labelType: LabelType,
    userId: String,
    ipAddress: IpAddress,
    panoId: String,
    heading: Double,
    pitch: Double,
    zoom: Double,
    lat: Double,
    lng: Double,
    timestamp: OffsetDateTime,
    comment: String,
    supersededAt: OffsetDateTime,
    changeType: ValidationCommentChangeType
)

class ValidationTaskCommentHistoryTableDef(tag: Tag)
    extends Table[ValidationTaskCommentHistory](tag, "validation_task_comment_history") {
  def validationTaskCommentHistoryId: Rep[Int] =
    column[Int]("validation_task_comment_history_id", O.PrimaryKey, O.AutoInc)
  def validationTaskCommentId: Rep[Int] = column[Int]("validation_task_comment_id")
  def missionId: Rep[Int]               = column[Int]("mission_id")
  def labelId: Rep[Int]                 = column[Int]("label_id")
  def labelType: Rep[LabelType]         = column[LabelType]("label_type")
  def userId: Rep[String]               = column[String]("user_id")
  def ipAddress: Rep[IpAddress]         = column[IpAddress]("ip_address")
  def panoId: Rep[String]               = column[String]("pano_id")
  def heading: Rep[Double]              = column[Double]("heading")
  def pitch: Rep[Double]                = column[Double]("pitch")
  def zoom: Rep[Double]                 = column[Double]("zoom")
  def lat: Rep[Double]                  = column[Double]("lat")
  def lng: Rep[Double]                  = column[Double]("lng")
  def timestamp: Rep[OffsetDateTime]    = column[OffsetDateTime]("timestamp")
  def comment: Rep[String]              = column[String]("comment")
  // DEFAULT now() in the DB (O.Default holds a value, not an expression).
  def supersededAt: Rep[OffsetDateTime]            = column[OffsetDateTime]("superseded_at")
  def changeType: Rep[ValidationCommentChangeType] = column[ValidationCommentChangeType]("change_type")

  def * = (validationTaskCommentHistoryId, validationTaskCommentId, missionId, labelId, labelType, userId, ipAddress,
    panoId, heading, pitch, zoom, lat, lng, timestamp, comment, supersededAt, changeType) <> (
    (ValidationTaskCommentHistory.apply _).tupled,
    ValidationTaskCommentHistory.unapply
  )

  def mission =
    foreignKey("validation_task_comment_history_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)
  def label =
    foreignKey("validation_task_comment_history_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
  def user =
    foreignKey("validation_task_comment_history_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def pano =
    foreignKey("validation_task_comment_history_pano_id_fkey", panoId, TableQuery[PanoDataTableDef])(_.panoId)
}
