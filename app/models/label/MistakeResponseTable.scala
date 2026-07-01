package models.label

import models.utils.MyPostgresProfile.api._
import slick.lifted.{ProvenShape, Tag}

import java.time.OffsetDateTime

/**
 * A user's response to one of their own labels that others validated as incorrect (#2996).
 *
 * @param userMistakeResponseId Primary key.
 * @param labelId               The label being responded to (owned by `userId`).
 * @param userId                The responding user (must own the label).
 * @param agrees                True = agrees it was a mistake; false = contests it (claims it was correct).
 * @param comment               Optional note for context (especially when contesting).
 * @param createdAt             When the response was recorded/updated.
 */
case class MistakeResponse(
    userMistakeResponseId: Int,
    labelId: Int,
    userId: String,
    agrees: Boolean,
    comment: Option[String],
    createdAt: OffsetDateTime
)

class MistakeResponseTableDef(tag: Tag) extends Table[MistakeResponse](tag, "user_mistake_response") {
  def userMistakeResponseId: Rep[Int] = column[Int]("user_mistake_response_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]               = column[Int]("label_id")
  def userId: Rep[String]             = column[String]("user_id")
  def agrees: Rep[Boolean]            = column[Boolean]("agrees")
  def comment: Rep[Option[String]]    = column[Option[String]]("comment")
  def createdAt: Rep[OffsetDateTime]  = column[OffsetDateTime]("created_at")

  def * : ProvenShape[MistakeResponse] =
    (userMistakeResponseId, labelId, userId, agrees, comment, createdAt) <> (
      (MistakeResponse.apply _).tupled,
      MistakeResponse.unapply
    )
}
