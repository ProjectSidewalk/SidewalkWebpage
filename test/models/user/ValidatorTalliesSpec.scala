package models.user

import models.utils.FilteredTables
import models.utils.MyPostgresProfile.api.*
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

/**
 * Pins which votes the validator reliability score grades, and against what (#5063). Each case reads how far the
 * voters' tallies moved, so votes already in the database don't matter. Rolled back; cancels without enough data.
 */
class ValidatorTalliesSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val userStatTable = app.injector.instanceOf[UserStatTable]

  /** A real label nobody has validated and that isn't a training example, as (label_id, labeler's user_id). */
  private lazy val target: (Int, String) =
    run(
      sql"""SELECT label.label_id, label.user_id
            FROM label
            INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
            INNER JOIN user_stat ON label.user_id = user_stat.user_id
            WHERE label.deleted = FALSE AND #${FilteredTables.notTutorialLabel()} AND NOT user_stat.excluded
                AND NOT EXISTS (SELECT 1 FROM label_validation WHERE label_validation.label_id = label.label_id)
                AND NOT EXISTS (SELECT 1 FROM gold_example WHERE gold_example.label_id = label.label_id)
            ORDER BY label.label_id
            LIMIT 1""".as[(Int, String)]
    ).headOption.getOrElse(cancel("No unvalidated label in the connected schema."))

  /** Four ordinary users (not excluded, not an admin, not the AI) other than the labeler, to vote. */
  private lazy val validators: Seq[String] = {
    val rows = run(
      sql"""SELECT user_stat.user_id
            FROM user_stat
            INNER JOIN sidewalk_login.user_role ON user_stat.user_id = user_role.user_id
            WHERE NOT user_stat.excluded AND user_stat.user_id <> ${target._2}
                AND user_role.role IN ('Registered', 'Anonymous', 'Turker')
            ORDER BY user_stat.user_id
            LIMIT 4""".as[String]
    )
    if (rows.size < 4) cancel("Not enough users in the connected schema to vote.")
    rows
  }

  /** An existing validation whose mission and viewing angles the inserted votes borrow. */
  private lazy val templateValidationId: Int =
    run(sql"SELECT label_validation_id FROM label_validation ORDER BY label_validation_id LIMIT 1".as[Int]).headOption
      .getOrElse(cancel("No validation in the connected schema to copy."))

  private def vote(userId: String, result: String): DBIO[Int] =
    sqlu"""INSERT INTO label_validation (label_id, label_type, validation_result, user_id, mission_id, heading, pitch,
                                         zoom, canvas_height, canvas_width, start_timestamp, end_timestamp, source,
                                         viewer_type)
           SELECT label.label_id, label.label_type, $result::validation_option, $userId, label_validation.mission_id,
                  heading, pitch, zoom, canvas_height, canvas_width, start_timestamp, end_timestamp, source, viewer_type
           FROM label_validation, label
           WHERE label_validation_id = $templateValidationId AND label.label_id = ${target._1}"""

  private def setRole(userId: String, role: Role): DBIO[Int] =
    sqlu"UPDATE sidewalk_login.user_role SET role = ${role.name}::sidewalk_login.role WHERE user_id = $userId"

  private def pinAsTrainingExample: DBIO[Int] =
    sqlu"""INSERT INTO gold_example (label_id, reason, user_id)
           VALUES (${target._1}, (enum_range(NULL::validation_reason))[1], ${validators.head})"""

  /** The third validator answering Agree to the label when it was served as a training example. */
  private def trainingAnswer: DBIO[Int] =
    sqlu"""INSERT INTO gold_example_response (label_id, user_id, mission_id, reason, validation_result, answered_at)
           SELECT ${target._1}, ${validators(2)}, label_validation.mission_id,
                  (enum_range(NULL::validation_reason))[1], 'Agree', now()
           FROM label_validation
           WHERE label_validation_id = $templateValidationId"""

  /** Each voter's (graded, matched), with (0, 0) for someone who has nothing graded. */
  private def tallies: DBIO[Map[String, (Int, Int)]] =
    userStatTable.validatorTallies.map(_.map(t => t.userId -> (t.graded, t.matched)).toMap.withDefaultValue((0, 0)))

  /**
   * How far each validator's (graded, matched) moves when `votes` are cast, after `setup` has run.
   * @return The change for each of the four validators, in order.
   */
  private def tallyChanges(setup: DBIO[?], votes: DBIO[?]): Seq[(Int, Int)] =
    runRolledBack(for {
      _      <- setup
      before <- tallies
      _      <- votes
      after  <- tallies
    } yield validators.map(v => (after(v)._1 - before(v)._1, after(v)._2 - before(v)._2)))

  private lazy val (v1, v2, v3, v4) = (validators(0), validators(1), validators(2), validators(3))

  "validatorTallies" should {
    "grade a vote against the other votes, leaving out its own and the labeler's" in {
      val changes = tallyChanges(
        DBIO.successful(()),
        vote(v1, "Agree") >> vote(v2, "Agree") >> vote(v3, "Agree") >> vote(v4, "Disagree") >>
          vote(target._2, "Disagree")
      )
      changes mustBe Seq((1, 1), (1, 1), (1, 1), (1, 0))
    }

    "grade nothing when the other votes tie, and never grade an Unsure" in {
      val changes = tallyChanges(
        DBIO.successful(()),
        vote(v1, "Agree") >> vote(v2, "Agree") >> vote(v3, "Disagree") >> vote(v4, "Unsure")
      )
      // v1 and v2 each see one Agree and one Disagree from the others. v3 sees two Agrees.
      changes mustBe Seq((0, 0), (0, 0), (1, 0), (0, 0))
    }

    "grade no votes on a tutorial label" in {
      val changes = tallyChanges(
        sqlu"UPDATE label SET tutorial = TRUE WHERE label_id = ${target._1}",
        vote(v1, "Agree") >> vote(v2, "Agree") >> vote(v3, "Agree")
      )
      changes.take(3) mustBe Seq((0, 0), (0, 0), (0, 0))
    }

    "take an admin's vote as the answer over the majority" in {
      val changes = tallyChanges(
        setRole(v1, Role.Administrator),
        vote(v1, "Disagree") >> vote(v2, "Agree") >> vote(v3, "Agree") >> vote(v4, "Agree")
      )
      // The admin has no other admin to be graded against, so falls back to the majority.
      changes mustBe Seq((1, 0), (1, 0), (1, 0), (1, 0))
    }

    "neither grade an excluded user's votes nor grade anyone against them" in {
      val changes = tallyChanges(
        sqlu"UPDATE user_stat SET excluded = TRUE WHERE user_id = $v2",
        vote(v1, "Agree") >> vote(v2, "Disagree")
      )
      changes.take(2) mustBe Seq((0, 0), (0, 0))
    }

    "grade the AI's Disagree but grade no one against it" in {
      val changes = tallyChanges(setRole(v2, Role.Ai), vote(v1, "Agree") >> vote(v2, "Disagree"))
      changes.take(2) mustBe Seq((0, 0), (1, 0))
    }

    "count the AI's Agree like anyone's" in {
      val changes = tallyChanges(setRole(v2, Role.Ai), vote(v1, "Agree") >> vote(v2, "Agree"))
      changes.take(2) mustBe Seq((1, 1), (1, 1))
    }

    "grade votes on a training example, and answers given to it in training, against Disagree" in {
      val changes = tallyChanges(
        DBIO.successful(()),
        pinAsTrainingExample >> vote(v1, "Agree") >> vote(v2, "Disagree") >> trainingAnswer
      )
      changes.take(3) mustBe Seq((1, 0), (1, 1), (1, 0))
    }

    "not grade a training answer once its example is unpinned" in {
      tallyChanges(DBIO.successful(()), trainingAnswer)(2) mustBe ((0, 0))
    }
  }

  "validatorReliabilityScores" should {
    "list a scored person, but not the AI" in {
      val (asPerson, asAi) = runRolledBack(for {
        _        <- vote(v1, "Agree") >> vote(v2, "Agree") >> vote(v3, "Agree")
        _        <- userStatTable.updateValidatorReliability()
        _        <- setRole(v1, Role.Registered)
        asPerson <- userStatTable.validatorReliabilityScores
        _        <- setRole(v1, Role.Ai)
        asAi     <- userStatTable.validatorReliabilityScores
      } yield (asPerson.size, asAi.size))
      asAi mustBe asPerson - 1
    }
  }

  "updateValidatorReliability" should {
    "store each validator's tally and a score, and change nothing on a second run" in {
      val (stored, expected, again) = runRolledBack(for {
        _       <- vote(v1, "Agree") >> vote(v2, "Agree") >> vote(v3, "Disagree")
        _       <- userStatTable.updateValidatorReliability()
        tallied <- tallies
        stored  <- sql"""SELECT validations_graded, validations_matched, validator_reliability
                         FROM user_stat WHERE user_id = $v3""".as[(Int, Int, Option[Double])].head
        again <- userStatTable.updateValidatorReliability()
      } yield (stored, tallied(v3), again))
      (stored._1, stored._2) mustBe expected
      stored._3.exists(r => r >= 0 && r <= 1) mustBe true
      again mustBe 0
    }

    "reset a validator whose graded votes went away" in {
      val stored = runRolledBack(for {
        _      <- vote(v1, "Agree") >> vote(v2, "Agree")
        _      <- userStatTable.updateValidatorReliability()
        _      <- sqlu"UPDATE user_stat SET excluded = TRUE WHERE user_id = $v1"
        _      <- userStatTable.updateValidatorReliability()
        stored <- sql"""SELECT validations_graded, validations_matched, validator_reliability
                        FROM user_stat WHERE user_id = $v1""".as[(Int, Int, Option[Double])].head
      } yield stored)
      stored mustBe ((0, 0, None))
    }
  }
}
