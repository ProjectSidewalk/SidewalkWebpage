package service

import models.utils.MyPostgresProfile.api.*
import models.validation.ValidationOption
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

import scala.concurrent.duration.*
import scala.concurrent.{Await, Future}

/**
 * Pins that two votes landing on one label at the same moment both make it into the label's counts (#5604).
 *
 * Real overlap needs two connections, so this can't run in a rolled-back transaction: it commits, then puts the label's
 * original counts back.
 */
class ValidationCountsSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val validationService = app.injector.instanceOf[ValidationServiceImpl]

  /** A label's (agree_count, disagree_count, unsure_count, correct). */
  private def countsOf(labelId: Int): DBIO[(Int, Int, Int, Option[Boolean])] =
    sql"SELECT agree_count, disagree_count, unsure_count, correct FROM label WHERE label_id = $labelId"
      .as[(Int, Int, Int, Option[Boolean])]
      .head

  "updateValidationCounts" should {
    "count both of two votes cast on one label at once" in {
      val labelId: Int = run(sql"SELECT label_id FROM label ORDER BY label_id LIMIT 1".as[Int]).headOption
        .getOrElse(cancel("No label in the connected schema."))
      val (agree, disagree, unsure, correct) = run(countsOf(labelId))
      val vote = validationService.updateValidationCounts(labelId, Some(ValidationOption.Agree), None)

      try {
        // The first vote holds its transaction open for a second, so the second vote arrives while it's in flight.
        val first  = dbConfig.db.run((vote >> sql"SELECT 1 FROM pg_sleep(1)".as[Int]).transactionally)
        val second = Future(Thread.sleep(300)).flatMap(_ => dbConfig.db.run(vote.transactionally))
        Await.result(first.zip(second), 30.seconds)

        val expectedCorrect = Option.when(agree + 2 != disagree)(agree + 2 > disagree)
        run(countsOf(labelId)) mustBe ((agree + 2, disagree, unsure, expectedCorrect))
      } finally {
        val _ = run(sqlu"""UPDATE label
                   SET agree_count = $agree, disagree_count = $disagree, unsure_count = $unsure, correct = $correct
                   WHERE label_id = $labelId""")
      }
    }
  }
}
