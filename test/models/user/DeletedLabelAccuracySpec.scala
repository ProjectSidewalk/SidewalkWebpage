package models.user

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import service.LabelEditService
import util.RolledBackDb

/**
 * Pins the accuracy rule for deleted labels (#3591) in the stored user_stat accuracy and the dashboard's per-type
 * tallies, and that an Explore-session delete is stamped as such. Runs in a rolled-back transaction; cancels without
 * a labeler who has three live labels.
 */
class DeletedLabelAccuracySpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val userStatTable    = app.injector.instanceOf[UserStatTable]
  private lazy val labelEditService = app.injector.instanceOf[LabelEditService]

  /** A non-excluded labeler with three or more live labels, so one always stays live: (user_id, label_a, label_b). */
  private lazy val target: (String, Int, Int) = {
    val rows = run(
      sql"""SELECT label.user_id, MIN(label.label_id), MAX(label.label_id)
            FROM label
            INNER JOIN user_stat ON label.user_id = user_stat.user_id
            WHERE label.deleted = FALSE AND label.tutorial = FALSE AND NOT user_stat.excluded
            GROUP BY label.user_id
            HAVING COUNT(*) >= 3
            ORDER BY label.user_id
            LIMIT 1""".as[(String, Int, Int)]
    )
    rows.headOption.getOrElse(cancel("No labeler with three live labels in the connected schema."))
  }

  /** Leaves the labeler with exactly one correct and one incorrect label, everything else unvalidated. */
  private def setUpVerdicts(userId: String, correctId: Int, incorrectId: Int): DBIO[Unit] =
    DBIO.seq(
      sqlu"UPDATE label SET correct = NULL WHERE user_id = $userId",
      sqlu"UPDATE label SET correct = TRUE WHERE label_id = $correctId",
      sqlu"UPDATE label SET correct = FALSE WHERE label_id = $incorrectId"
    )

  private def markDeleted(labelId: Int, userId: String, source: String): DBIO[Int] =
    sqlu"""UPDATE label
           SET deleted = TRUE, deleted_by = $userId, deleted_at = NOW(), deleted_source = $source::ui_source
           WHERE label_id = $labelId"""

  private def accuracyOf(userId: String): DBIO[(Int, Option[Double])] =
    userStatTable.updateAccuracy(Seq(userId)) >>
      sql"SELECT own_labels_validated, accuracy FROM user_stat WHERE user_id = $userId".as[(Int, Option[Double])].head

  /** The per-type tallies summed over types: (correct, incorrect). */
  private def talliesOf(userId: String): DBIO[(Int, Int)] =
    userStatTable.getLabelTypeAccuracy(userId).map(rows => (rows.map(_._2).sum, rows.map(_._3).sum))

  "a labeler's accuracy" should {
    "keep an incorrect label deleted from the popup, drop a correct one, and drop anything deleted in Explore" in {
      val (userId, correctId, incorrectId) = target
      val result                           = runRolledBack(for {
        _        <- setUpVerdicts(userId, correctId, incorrectId)
        baseline <- accuracyOf(userId)
        tallies0 <- talliesOf(userId)
        _        <- markDeleted(incorrectId, userId, "UserDashboard")
        kept     <- accuracyOf(userId)
        tallies1 <- talliesOf(userId)
        _        <- markDeleted(correctId, userId, "LabelMap")
        dropped  <- accuracyOf(userId)
        tallies2 <- talliesOf(userId)
        _        <- sqlu"UPDATE label SET deleted_source = 'Explore' WHERE label_id = $incorrectId"
        explore  <- accuracyOf(userId)
      } yield (baseline, tallies0, kept, tallies1, dropped, tallies2, explore))
      result mustBe (((2, Some(0.5)), (1, 1), (2, Some(0.5)), (1, 1), (1, Some(0.0)), (0, 1), (0, None)))
    }
  }

  "a delete saved from Explore" should {
    "be stamped as the labeler's, from Explore, and keep its first stamp when the label is saved again" in {
      val (userId, labelId, _) = target
      val result               = runRolledBack(for {
        label <- sql"SELECT severity, description, array_to_string(tags, '|') FROM label WHERE label_id = $labelId"
          .as[(Option[Int], Option[String], String)]
          .head
        tags = if (label._3.isEmpty) Nil else label._3.split('|').toList
        _     <- labelEditService.updateLabelFromExplore(labelId, deleted = true, label._1, label._2, tags)
        first <- stampOf(labelId)
        _     <- labelEditService.updateLabelFromExplore(labelId, deleted = true, label._1, label._2, tags)
        again <- stampOf(labelId)
        _     <- labelEditService.updateLabelFromExplore(labelId, deleted = false, label._1, label._2, tags)
        back  <- stampOf(labelId)
      } yield (first, again, back))
      val (first, again, back) = result
      first._1 mustBe true
      first._2 mustBe Some(userId)
      first._3 mustBe true
      first._4 mustBe Some("Explore")
      again mustBe first
      back mustBe ((false, None, false, None))
    }
  }

  /** (deleted, deleted_by, deleted_at is set, deleted_source) as stored. */
  private def stampOf(labelId: Int): DBIO[(Boolean, Option[String], Boolean, Option[String])] =
    sql"SELECT deleted, deleted_by, deleted_at IS NOT NULL, deleted_source::text FROM label WHERE label_id = $labelId"
      .as[(Boolean, Option[String], Boolean, Option[String])]
      .head
}
