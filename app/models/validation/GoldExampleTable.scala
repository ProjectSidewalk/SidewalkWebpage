package models.validation

import com.google.inject.ImplementedBy
import models.label.{LabelTableDef, LabelType}
import models.mission.MissionTableDef
import models.pano.PanoDataTable
import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api.{given, *}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.*
import scala.concurrent.ExecutionContext

/**
 * A label an admin pinned as a training example of a common validation mistake (#1445). The right answer is always
 * Disagree, and `reason` is the canned reason that explains why, which is what the validator is told on a wrong answer.
 */
case class GoldExample(labelId: Int, reason: ValidationReason, userId: String, pinnedAt: OffsetDateTime)

/**
 * One validator's encounter with one example: written when it is served, answered when they vote.
 *
 * @param reason           The example's reason at serve time, so the record stays true if the pin changes.
 * @param validationResult Their first vote on it, or None until they vote. First, because the explanation shown after
 *                         a wrong answer would otherwise turn every undo-and-revote into a right one.
 */
case class GoldExampleResponse(
    goldExampleResponseId: Int,
    labelId: Int,
    userId: String,
    missionId: Int,
    reason: ValidationReason,
    servedAt: OffsetDateTime,
    validationResult: Option[ValidationOption],
    answerReason: Option[ValidationReason],
    answeredAt: Option[OffsetDateTime]
)

/** What the admin list shows per example. */
case class GoldExampleSummary(
    example: GoldExample,
    labelType: LabelType,
    unservable: Boolean,
    pinnedByUsername: String,
    answered: Int,
    missed: Int
)

/** The pins; one row per label, replaced on re-pin. */
class GoldExampleTableDef(tag: Tag) extends Table[GoldExample](tag, "gold_example") {
  def labelId: Rep[Int]             = column[Int]("label_id", O.PrimaryKey)
  def reason: Rep[ValidationReason] = column[ValidationReason]("reason")
  def userId: Rep[String]           = column[String]("user_id")
  def pinnedAt: Rep[OffsetDateTime] = column[OffsetDateTime]("pinned_at") // DEFAULT now() in the DB.
  def *                             = (labelId, reason, userId, pinnedAt).mapTo[GoldExample]

  def label = foreignKey("gold_example_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
  def user  = foreignKey("gold_example_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
}

/** One serve per validator and example, answered in place; a deleted mission takes it along. */
class GoldExampleResponseTableDef(tag: Tag) extends Table[GoldExampleResponse](tag, "gold_example_response") {
  def goldExampleResponseId: Rep[Int]                 = column[Int]("gold_example_response_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]                               = column[Int]("label_id")
  def userId: Rep[String]                             = column[String]("user_id")
  def missionId: Rep[Int]                             = column[Int]("mission_id")
  def reason: Rep[ValidationReason]                   = column[ValidationReason]("reason")
  def servedAt: Rep[OffsetDateTime]                   = column[OffsetDateTime]("served_at") // DEFAULT now() in the DB.
  def validationResult: Rep[Option[ValidationOption]] = column[Option[ValidationOption]]("validation_result")
  def answerReason: Rep[Option[ValidationReason]]     = column[Option[ValidationReason]]("answer_reason")
  // CHECK in the DB: the result, answered_at and answer_reason are all null together, or the first two are set.
  def answeredAt: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("answered_at")
  def *                                       =
    (goldExampleResponseId, labelId, userId, missionId, reason, servedAt, validationResult, answerReason, answeredAt)
      .mapTo[GoldExampleResponse]

  def labelUser = index("gold_example_response_label_id_user_id_key", (labelId, userId), unique = true)
  def label     = foreignKey("gold_example_response_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
  def user      = foreignKey("gold_example_response_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def mission = foreignKey("gold_example_response_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)
}

object GoldExampleTable {

  /**
   * Answers on one reason, right or wrong, after which a validator gets no more of it: one right answer ends it
   * sooner, and this keeps someone who keeps missing from being quizzed forever.
   */
  val AnswersPerReason: Int = 3
}

@ImplementedBy(classOf[GoldExampleTable])
trait GoldExampleTableRepository {}

/** The pins and the serve records (#1445). */
@Singleton
class GoldExampleTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(using
    val ec: ExecutionContext
) extends GoldExampleTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val goldExamples         = TableQuery[GoldExampleTableDef]
  val goldExampleResponses = TableQuery[GoldExampleResponseTableDef]
  private val labels       = TableQuery[LabelTableDef]
  private val users        = TableQuery[SidewalkUserTableDef]
  private val panoData     = TableQuery[models.pano.PanoDataTableDef]

  def find(labelId: Int): DBIO[Option[GoldExample]] = goldExamples.filter(_.labelId === labelId).result.headOption

  def pin(labelId: Int, reason: ValidationReason, userId: String): DBIO[Int] =
    goldExamples.insertOrUpdate(GoldExample(labelId, reason, userId, OffsetDateTime.now))

  def unpin(labelId: Int): DBIO[Int] = goldExamples.filter(_.labelId === labelId).delete

  /** Newest pin first. */
  def listSummaries: DBIO[Seq[GoldExampleSummary]] = {
    val rows = for {
      g <- goldExamples
      l <- labels if l.labelId === g.labelId
      p <- panoData if p.panoId === l.panoId
      u <- users if u.userId === g.userId
    } yield (g, l.labelType, !PanoDataTable.imageryViewable(p), u.username)
    val answers = goldExampleResponses
      .filter(_.validationResult.isDefined)
      .groupBy(_.labelId)
      .map { case (labelId, rs) =>
        (labelId, rs.length, rs.map(r => Case.If(r.validationResult =!= ValidationOption.Disagree).Then(1).Else(0)).sum)
      }
    rows
      .joinLeft(answers)
      .on { case ((g, _, _, _), (labelId, _, _)) => g.labelId === labelId }
      .sortBy { case ((g, _, _, _), _) => g.pinnedAt.desc }
      .result
      .map(_.map { case ((g, labelType, unservable, username), counts) =>
        GoldExampleSummary(
          g,
          labelType,
          unservable,
          username,
          counts.map(_._2).getOrElse(0),
          counts.flatMap(_._3).getOrElse(0)
        )
      })
  }

  /** Whether this city has anything pinned at all; a cheap check before the label query, which most cities fail. */
  def anyPinned: DBIO[Boolean] = goldExamples.exists.result

  /** The answers given in a mission, by vote, for the mission's tally. */
  def answersInMission(missionId: Int): DBIO[ValidationResultCounts] =
    goldExampleResponses
      .filter(r => r.missionId === missionId && r.validationResult.isDefined)
      .groupBy(_.validationResult)
      .map { case (result, rs) => (result, rs.length) }
      .result
      .map { rows =>
        val byResult: Map[Option[ValidationOption], Int] = rows.toMap
        ValidationResultCounts(
          agreeCount = byResult.getOrElse(Some(ValidationOption.Agree), 0),
          disagreeCount = byResult.getOrElse(Some(ValidationOption.Disagree), 0),
          unsureCount = byResult.getOrElse(Some(ValidationOption.Unsure), 0)
        )
      }

  /**
   * A serve never answered (they left mid-mission) is re-pointed at the new mission, so a reload can serve it again,
   * and takes the pin's current reason, which an admin may have changed since.
   */
  def recordServe(labelId: Int, userId: String, missionId: Int, reason: ValidationReason): DBIO[Int] =
    sqlu"""INSERT INTO gold_example_response (label_id, user_id, mission_id, reason)
           VALUES ($labelId, $userId, $missionId, $reason)
           ON CONFLICT (label_id, user_id) DO UPDATE
             SET mission_id = EXCLUDED.mission_id, reason = EXCLUDED.reason, served_at = now()
             WHERE gold_example_response.validation_result IS NULL"""

  def servedTo(userId: String, labelIds: Set[Int]): DBIO[Set[Int]] = {
    if (labelIds.isEmpty) DBIO.successful(Set.empty)
    else
      goldExampleResponses
        .filter(r => r.userId === userId && (r.labelId inSetBind labelIds))
        .map(_.labelId)
        .result
        .map(_.toSet)
  }

  /** Whether the mission already carries an example, so a reload mid-mission doesn't add a second. */
  def servedInMission(missionId: Int): DBIO[Boolean] =
    goldExampleResponses.filter(_.missionId === missionId).exists.result

  /** Files the user's first answer; a later vote, an undo included, leaves it alone. */
  def recordAnswer(
      labelId: Int,
      userId: String,
      result: ValidationOption,
      answerReason: Option[ValidationReason]
  ): DBIO[Int] =
    goldExampleResponses
      .filter(r => r.labelId === labelId && r.userId === userId && r.validationResult.isEmpty)
      .map(r => (r.validationResult, r.answerReason, r.answeredAt))
      .update((Some(result), answerReason, Some(OffsetDateTime.now)))
}
