package models.label

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

/**
 * Pins what the dashboard's "recent mistakes" query hands back, which two things conspire to get wrong.
 *
 * Postgres makes DISTINCT ON sort by the column it de-duplicates on before anything else, so the sort that picks each
 * label's newest validation has to be nested inside a subquery before the rows can be put in newest-first order. Get
 * that wrong one way and Postgres refuses the query outright; get it wrong the other way and it quietly returns the
 * user's oldest labels, since the caller takes the first n rows of whatever comes back.
 *
 * Runs the real query against the connected database, so the illegal form fails here rather than in production.
 */
class MistakeCardQuerySpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val labelTable = app.injector.instanceOf[LabelTable]

  /** The user with the most incorrectly-validated labels of this type, so the ordering check has rows to work on. */
  private def busiestUser(labelType: LabelTypeEnum.Base): Option[String] =
    run(
      sql"""SELECT label.user_id
            FROM label
            INNER JOIN label_validation ON label.label_id = label_validation.label_id
            WHERE label.correct = false
              AND label.label_type = ${labelType.name}::label_type
              AND label_validation.user_id <> label.user_id
            GROUP BY label.user_id
            ORDER BY count(*) DESC
            LIMIT 1""".as[String].headOption
    )

  "getValidatedLabelsForUserQuery" should {
    "be a query Postgres accepts" in {
      run(labelTable.getValidatedLabelsForUserQuery("no-such-user", LabelTypeEnum.Obstacle).take(5).result) mustBe empty
    }

    "hand back the newest validations first, not the lowest label ids" in {
      LabelTypeEnum.primaryValidateLabelTypes.foreach { labelType =>
        busiestUser(labelType).foreach { userId =>
          val rows       = run(labelTable.getValidatedLabelsForUserQuery(userId, labelType).take(25).result)
          val timestamps = rows.map(_._10)
          withClue(s"$labelType rows for $userId came back out of order: ") {
            timestamps mustBe timestamps.sortWith(_.isAfter(_))
          }
        }
      }
    }

    "give each label exactly one row" in {
      LabelTypeEnum.primaryValidateLabelTypes.foreach { labelType =>
        busiestUser(labelType).foreach { userId =>
          val labelIds = run(labelTable.getValidatedLabelsForUserQuery(userId, labelType).take(25).result).map(_._1)
          labelIds.distinct mustBe labelIds
        }
      }
    }
  }
}
