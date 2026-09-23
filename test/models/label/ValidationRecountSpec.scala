package models.label

import models.user.UserStatTable
import models.utils.FilteredTables
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

/**
 * Pins the validation recount behind excluding a user (#3956), which must agree with the live counting in
 * `ValidationService`. Votes are inserted straight into label_validation, skipping live counting, so every count the
 * assertions read came from the recount. Runs in a rolled-back transaction; cancels without enough data.
 */
class ValidationRecountSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val labelTable    = app.injector.instanceOf[LabelTable]
  private lazy val userStatTable = app.injector.instanceOf[UserStatTable]

  /** Two real labels nobody has validated yet, as (label_id, labeler's user_id). */
  private lazy val targets: Seq[(Int, String)] = {
    val rows = run(
      sql"""SELECT label.label_id, label.user_id
            FROM label
            INNER JOIN user_stat ON label.user_id = user_stat.user_id
            WHERE label.deleted = FALSE AND label.tutorial = FALSE AND NOT user_stat.excluded
                AND NOT EXISTS (SELECT 1 FROM label_validation WHERE label_validation.label_id = label.label_id)
            ORDER BY label.label_id
            LIMIT 2""".as[(Int, String)]
    )
    if (rows.size < 2) cancel("Not enough unvalidated labels in the connected schema.")
    rows
  }

  /** Three non-excluded users who labeled neither target, to vote on them. */
  private lazy val validators: Seq[String] = {
    val labelers = targets.map(_._2)
    val rows     = run(
      sql"""SELECT user_id FROM user_stat
            WHERE NOT excluded AND user_id <> ${labelers.head} AND user_id <> ${labelers.last}
            ORDER BY user_id
            LIMIT 3""".as[String]
    )
    if (rows.size < 3) cancel("Not enough users in the connected schema to vote.")
    rows
  }

  /** An existing validation whose mission and viewing angles the inserted votes borrow. */
  private lazy val templateValidationId: Int =
    run(sql"SELECT label_validation_id FROM label_validation ORDER BY label_validation_id LIMIT 1".as[Int]).headOption
      .getOrElse(cancel("No validation in the connected schema to copy."))

  /** A vote cast on the label's current type, unless `labelType` names the (earlier) type it was cast on. */
  private def vote(labelId: Int, userId: String, result: String, labelType: Option[String] = None): DBIO[Int] =
    sqlu"""INSERT INTO label_validation (label_id, label_type, validation_result, user_id, mission_id, heading, pitch,
                                         zoom, canvas_height, canvas_width, start_timestamp, end_timestamp, source,
                                         viewer_type)
           SELECT $labelId, COALESCE($labelType::label_type, label.label_type), $result::validation_option, $userId,
                  label_validation.mission_id, heading, pitch, zoom, canvas_height, canvas_width, start_timestamp,
                  end_timestamp, source, viewer_type
           FROM label_validation, label
           WHERE label_validation_id = $templateValidationId AND label.label_id = $labelId"""

  /** A label's (agree_count, disagree_count, unsure_count, correct). */
  private def countsOf(labelId: Int): DBIO[(Int, Int, Int, Option[Boolean])] =
    sql"SELECT agree_count, disagree_count, unsure_count, correct FROM label WHERE label_id = $labelId"
      .as[(Int, Int, Int, Option[Boolean])]
      .head

  private def highQualityOf(userId: String): DBIO[Boolean] =
    sql"SELECT high_quality FROM user_stat WHERE user_id = $userId".as[Boolean].head

  private def setHighQuality(userId: String, value: Boolean): DBIO[Int] =
    sqlu"UPDATE user_stat SET high_quality = $value WHERE user_id = $userId"

  "recalculateValidationCounts" should {
    "count other users' votes, skip the labeler's own, and leave a tie undecided" in {
      val (labelId, labeler) = targets.head
      val (v1, v2, v3)       = (validators(0), validators(1), validators(2))
      val result             = runRolledBack(for {
        _       <- vote(labelId, labeler, "Agree")
        _       <- vote(labelId, v1, "Agree")
        _       <- vote(labelId, v2, "Disagree")
        _       <- vote(labelId, v3, "Unsure")
        changed <- labelTable.recalculateValidationCounts(Some(v1))
        counts  <- countsOf(labelId)
        again   <- labelTable.recalculateValidationCounts(Some(v1))
      } yield (changed, counts, again))
      // The second pass finds nothing out of date, so it writes nothing.
      result mustBe ((1, (1, 1, 1, None), 0))
    }

    "leave out a vote cast when the label had a different type" in {
      val (labelId, _) = targets.head
      val (v1, v2)     = (validators(0), validators(1))
      val result       = runRolledBack(for {
        currentType <- sql"SELECT label_type::text FROM label WHERE label_id = $labelId".as[String].head
        earlierType = if (currentType == "CurbRamp") "NoCurbRamp" else "CurbRamp"
        _      <- vote(labelId, v1, "Disagree", Some(earlierType))
        _      <- vote(labelId, v2, "Agree")
        _      <- labelTable.recalculateValidationCounts(Some(v1))
        counts <- countsOf(labelId)
      } yield counts)
      result mustBe ((1, 0, 0, Some(true)))
    }

    "drop an excluded validator's votes, and only recount the labels that validator voted on" in {
      val (label1, label2) = (targets(0)._1, targets(1)._1)
      val (v1, v2)         = (validators(0), validators(1))
      val result           = runRolledBack(for {
        _           <- vote(label1, v1, "Agree")
        _           <- vote(label1, v2, "Disagree")
        _           <- vote(label2, v1, "Agree")
        _           <- sqlu"UPDATE user_stat SET excluded = TRUE WHERE user_id = $v2"
        _           <- labelTable.recalculateValidationCounts(Some(v2))
        scoped1     <- countsOf(label1)
        scoped2     <- countsOf(label2)
        _           <- labelTable.recalculateValidationCounts(None)
        everywhere2 <- countsOf(label2)
      } yield (scoped1, scoped2, everywhere2))
      result mustBe (((1, 0, 0, Some(true)), (0, 0, 0, None), (1, 0, 0, Some(true))))
    }
  }

  "updateAccuracyForLabelersValidatedBy and updateUserQualityForLabelersValidatedBy" should {
    "refresh the labelers the validator voted on, and nobody else" in {
      val (labelId, labeler) = targets.head
      val v1                 = validators(0)
      val result             = runRolledBack(for {
        _ <- vote(labelId, v1, "Disagree")
        _ <- labelTable.recalculateValidationCounts(Some(v1))

        _                 <- userStatTable.updateAccuracyForLabelersValidatedBy(v1)
        storedValidated   <- sql"SELECT own_labels_validated FROM user_stat WHERE user_id = $labeler".as[Int].head
        expectedValidated <- sql"""SELECT COUNT(*) FROM #${FilteredTables.accuracyLabels}
                                   WHERE user_id = $labeler AND correct IS NOT NULL""".as[Int].head

        // A user none of whose labels v1 voted on; flipping their flag shows whether the update reached them.
        bystander <- sql"""SELECT user_id FROM user_stat
                           WHERE user_id <> $labeler AND NOT EXISTS (
                               SELECT 1 FROM label_validation
                               INNER JOIN label ON label_validation.label_id = label.label_id
                               WHERE label_validation.user_id = $v1 AND label.user_id = user_stat.user_id
                           )
                           LIMIT 1""".as[String].head
        bystanderBefore <- highQualityOf(bystander)
        _               <- setHighQuality(bystander, !bystanderBefore)

        // Flip the labeler's flag so the update has something to correct, then check it against the one-user path.
        labelerBefore <- highQualityOf(labeler)
        _             <- setHighQuality(labeler, !labelerBefore)
        _             <- userStatTable.updateUserQualityForLabelersValidatedBy(v1)
        viaValidator  <- highQualityOf(labeler)
        _             <- setHighQuality(labeler, !viaValidator)
        _             <- userStatTable.updateUserQuality(labeler)
        viaOneUser    <- highQualityOf(labeler)

        bystanderAfter <- highQualityOf(bystander)
      } yield (storedValidated, expectedValidated, viaValidator, viaOneUser, bystanderAfter, bystanderBefore))

      val (storedValidated, expectedValidated, viaValidator, viaOneUser, bystanderAfter, bystanderBefore) = result
      storedValidated mustBe expectedValidated
      viaValidator mustBe viaOneUser
      bystanderAfter mustBe !bystanderBefore
    }
  }
}
