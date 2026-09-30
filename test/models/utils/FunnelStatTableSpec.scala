package models.utils

import models.utils.MyPostgresProfile.api.*
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

/** Runs the funnel queries against the connected database, since the rest of the funnel specs never reach SQL. */
class FunnelStatTableSpec extends SidewalkSpec with RolledBackDb with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  private lazy val table: FunnelStatTable = app.injector.instanceOf[FunnelStatTable]

  /**
   * Adds a brand-new account with one activity row in the current city.
   *
   * @return The inserts, to run inside a rolled-back transaction.
   */
  private def newAccount(userId: String, activity: String): DBIO[Int] =
    sqlu"""INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email, created_at)
           VALUES ($userId, $userId, ${userId + "@test.invalid"}, NOW())""" andThen
      sqlu"""INSERT INTO webpage_activity (user_id, ip_address, activity, timestamp)
             VALUES ($userId, '10.0.0.1', $activity, NOW())"""

  "The funnel queries" should {
    "run for every window" in {
      for {
        window <- Seq(Some(30), None)
        funnel <- Seq(table.computeMappingFunnelBySchema, table.computeContributionFunnelBySchema)
      } run(currentSchema.flatMap(schema => funnel(schema, window))) mustBe a[Seq[?]]
    }

    "start with new accounts that opened a page, not ones with only a sign-up row" in {
      def step1(schema: String) =
        table.computeMappingFunnelBySchema(schema, Some(30)).map(_.find(_.segment == "all").fold(0)(_.steps.head))
      val (before, after) = runRolledBack(for {
        schema <- currentSchema
        before <- step1(schema)
        _      <- newAccount("funnel-spec-visitor", "Visit_Index")
        _      <- newAccount("funnel-spec-crawler", "AnonAutoSignUp_url=\"/\"")
        after  <- step1(schema)
      } yield (before, after))
      after - before mustBe 1
    }
  }
}
