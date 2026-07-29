package models.label

import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile.api._
import slick.lifted.{ProvenShape, Tag}

import java.time.OffsetDateTime

/**
 * A user's response to one of their own labels that others validated as incorrect (#2996).
 *
 * @param userMistakeResponseId Primary key.
 * @param labelId               The label being responded to (owned by `userId`).
 * @param userId                The responding user (must own the label).
 * @param agrees                Some(true) = agrees it was a mistake; Some(false) = contests it; None = only a note,
 *                              no vote cast (#2996).
 * @param comment               Optional note for context.
 * @param createdAt             When the response was recorded/updated.
 */
case class MistakeResponse(
    userMistakeResponseId: Int,
    labelId: Int,
    userId: String,
    agrees: Option[Boolean],
    comment: Option[String],
    createdAt: OffsetDateTime
)

class MistakeResponseTableDef(tag: Tag) extends Table[MistakeResponse](tag, "user_mistake_response") {
  def userMistakeResponseId: Rep[Int] = column[Int]("user_mistake_response_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]               = column[Int]("label_id")
  def userId: Rep[String]             = column[String]("user_id")
  def agrees: Rep[Option[Boolean]]    = column[Option[Boolean]]("agrees")
  def comment: Rep[Option[String]]    = column[Option[String]]("comment")
  def createdAt: Rep[OffsetDateTime]  = column[OffsetDateTime]("created_at")

  def * : ProvenShape[MistakeResponse] =
    (userMistakeResponseId, labelId, userId, agrees, comment, createdAt) <> (
      (MistakeResponse.apply _).tupled,
      MistakeResponse.unapply
    )

  def label = foreignKey("user_mistake_response_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
  def user  = foreignKey("user_mistake_response_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def labelUserUnique = index("user_mistake_response_label_id_user_id_key", (labelId, userId), unique = true)
}
