package models.label

import models.utils.MyPostgresProfile.api.*
import models.validation.ValidationOption
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

import scala.concurrent.{Await, Future}
import scala.concurrent.duration.*

/** Pins the live vote counting in `LabelTable.addValidationVote` (#5604). */
class ValidationCountsSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val labelTable = app.injector.instanceOf[LabelTable]

  private lazy val labelId: Int = run(sql"SELECT label_id FROM label ORDER BY label_id LIMIT 1".as[Int]).headOption
    .getOrElse(cancel("No label in the connected schema."))

  /** A label's (agree_count, disagree_count, unsure_count, correct). */
  private def countsOf(labelId: Int): DBIO[(Int, Int, Int, Option[Boolean])] =
    sql"SELECT agree_count, disagree_count, unsure_count, correct FROM label WHERE label_id = $labelId"
      .as[(Int, Int, Int, Option[Boolean])]
      .head

  "addValidationVote" should {
    "add and take back votes of each kind, and set correct by majority" in {
      val result = runRolledBack(for {
        _ <- sqlu"""UPDATE label SET agree_count = 1, disagree_count = 0, unsure_count = 0, correct = TRUE
                             WHERE label_id = $labelId"""
        _         <- labelTable.addValidationVote(labelId, ValidationOption.Disagree, 1)
        tie       <- countsOf(labelId)
        _         <- labelTable.addValidationVote(labelId, ValidationOption.Agree, -1)
        _         <- labelTable.addValidationVote(labelId, ValidationOption.Unsure, 1)
        disagreed <- countsOf(labelId)
      } yield (tie, disagreed))
      result mustBe (((1, 1, 0, None), (0, 1, 1, Some(false))))
    }

    "count both of two votes cast on one label at once" in {
      // Real overlap needs two connections, so this commits; it takes its own two votes back afterward.
      val (agree, disagree, unsure, _) = run(countsOf(labelId))
      val vote                         = labelTable.addValidationVote(labelId, ValidationOption.Agree, 1)
      def firstIsHolding: Boolean      = run(
        sql"""SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                     WHERE state = 'active' AND query LIKE '%FROM pg_sleep(2)%' AND pid <> pg_backend_pid())"""
          .as[Boolean]
          .head
      )

      // The first vote holds its transaction open; the second is sent only once the first is seen sleeping.
      val first    = dbConfig.db.run((vote >> sql"SELECT 1 FROM pg_sleep(2)".as[Int]).transactionally)
      val deadline = 10.seconds.fromNow
      while (!firstIsHolding && deadline.hasTimeLeft()) Thread.sleep(20)
      val second                = dbConfig.db.run(vote.transactionally)
      val votes: Seq[Future[?]] = Seq(first, second)
      try {
        Await.ready(first.zip(second), 30.seconds)
        val expectedCorrect = Option.when(agree + 2 != disagree)(agree + 2 > disagree)
        run(countsOf(labelId)) mustBe ((agree + 2, disagree, unsure, expectedCorrect))
      } finally {
        val landed = votes.count(_.value.exists(_.isSuccess))
        if (landed > 0) { val _ = run(labelTable.addValidationVote(labelId, ValidationOption.Agree, -landed)) }
      }
    }
  }
}
