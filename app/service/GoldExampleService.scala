package service

import com.google.inject.ImplementedBy
import models.label.LabelTable
import models.utils.MyPostgresProfile
import models.validation.{GoldExample, GoldExampleSummary, GoldExampleTable, ValidationOption, ValidationReason}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.*
import scala.concurrent.{ExecutionContext, Future}

enum GoldExampleRejection {
  case NoSuchLabel, LabelUnusable, ReasonNotOffered
}

/** A validator's vote on an example, as the Validate POST carries it. */
case class GoldExampleAnswer(
    labelId: Int,
    missionId: Int,
    result: ValidationOption,
    answerReason: Option[ValidationReason]
)

@ImplementedBy(classOf[GoldExampleServiceImpl])
trait GoldExampleService {
  def find(labelId: Int): Future[Option[GoldExample]]
  def pin(labelId: Int, reason: ValidationReason, userId: String): Future[Either[GoldExampleRejection, GoldExample]]
  def unpin(labelId: Int): Future[Boolean]
  def listSummaries: Future[Seq[GoldExampleSummary]]
  def servedIn(userId: String, labelMissions: Seq[(Int, Int)]): Future[Set[(Int, Int)]]
  def recordAnswers(userId: String, answers: Seq[GoldExampleAnswer]): Future[Unit]
}

/**
 * The admin side of known-answer examples (#1445) and the filing of answers to them. Choosing which one a mission
 * carries is LabelService's, beside the queue the rest of the mission comes from.
 */
@Singleton
class GoldExampleServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    goldExampleTable: GoldExampleTable,
    labelTable: LabelTable
)(using ec: ExecutionContext)
    extends GoldExampleService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  def find(labelId: Int): Future[Option[GoldExample]] = db.run(goldExampleTable.find(labelId))

  /**
   * The reason has to be one the label's type offers for a Disagree, since it is what the validator is told and what
   * the tool's own reason menu shows them. A deleted or tutorial label can't be served, so it can't be pinned.
   */
  def pin(labelId: Int, reason: ValidationReason, userId: String): Future[Either[GoldExampleRejection, GoldExample]] =
    db.run(labelTable.find(labelId)).flatMap {
      case None                                           => Future.successful(Left(GoldExampleRejection.NoSuchLabel))
      case Some(label) if label.deleted || label.tutorial => Future.successful(Left(GoldExampleRejection.LabelUnusable))
      case Some(label) if !ValidationReason.offered(label.labelType, ValidationOption.Disagree).contains(reason) =>
        Future.successful(Left(GoldExampleRejection.ReasonNotOffered))
      case Some(_) =>
        db.run(goldExampleTable.pin(labelId, reason, userId).andThen(goldExampleTable.find(labelId))).map {
          case Some(pinned) => Right(pinned)
          case None         => Left(GoldExampleRejection.NoSuchLabel)
        }
    }

  /** @return Whether there was a pin to remove. */
  def unpin(labelId: Int): Future[Boolean] = db.run(goldExampleTable.unpin(labelId)).map(_ > 0)

  def listSummaries: Future[Seq[GoldExampleSummary]] = db.run(goldExampleTable.listSummaries)

  def servedIn(userId: String, labelMissions: Seq[(Int, Int)]): Future[Set[(Int, Int)]] =
    db.run(goldExampleTable.servedIn(userId, labelMissions))

  /** An example the user already answered is left as it was. */
  def recordAnswers(userId: String, answers: Seq[GoldExampleAnswer]): Future[Unit] =
    db.run(
      slick.dbio.DBIO
        .sequence(
          answers.map(a => goldExampleTable.recordAnswer(a.labelId, userId, a.missionId, a.result, a.answerReason))
        )
        .map(_ => ())
    )
}
