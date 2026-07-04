package models.utils

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder

import java.util.UUID
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed regression test for the engagement-funnel "visited" definition (#4380).
 *
 * Pins the fix for the direct-to-app undercount: a user who enters straight at `/explore` logs a `Visit_Audit`
 * webpage_activity event (never `Visit_Index`/`Visit_MobileLanding`). Under the old landing-only definition such a
 * user had no step-1 event and was dropped from the funnel entirely (via `HAVING bool_or(step = 1)`), even though
 * they started the tutorial. With the broadened `Visit_%` definition they are counted at step 1 (visited) and
 * step 2 (tutorial_started).
 *
 * The compute methods aggregate over the whole schema, so the test seeds one synthetic user, asserts the "all"
 * segment's step 1 and step 2 each rise by exactly one, and removes the seeded rows in a `finally`. This assumes no
 * other funnel-affecting writes land between the two computes — true on CI (quiescent DB) and on a dev box with no
 * live traffic to localhost.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class FunnelStatTableSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  private val schema = "sidewalk_seattle"

  private lazy val funnelStats: FunnelStatTable = app.injector.instanceOf[FunnelStatTable]
  private val dbConfig                          = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  // The funnel scans the full webpage_activity/mission/label tables, so allow a generous timeout.
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  /** The "all"-segment step counts for the mapping funnel over all time (index 0 = step 1). */
  private def mappingAllSteps(): Seq[Int] =
    run(funnelStats.computeMappingFunnelBySchema(schema, None))
      .find(_.segment == "all")
      .map(_.steps)
      .getOrElse(Seq.fill(6)(0))

  "computeMappingFunnelBySchema" should {
    "count a direct-to-/explore user (Visit_Audit, no Visit_Index) at step 1 and step 2" in {
      val userId = s"test-4380-${UUID.randomUUID()}"
      val email  = s"$userId@example.com"

      val before = mappingAllSteps()
      try {
        // Seed a direct-entry user: a Visit_Audit page view (but no landing visit) plus a started tutorial mission.
        run(
          DBIO
            .seq(
              sqlu"INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email) VALUES ($userId, $userId, $email)",
              sqlu"""INSERT INTO "#$schema".webpage_activity (user_id, activity, timestamp, ip_address)
                     VALUES ($userId, 'Visit_Audit', NOW(), '0.0.0.0')""",
              sqlu"""INSERT INTO "#$schema".mission (mission_type_id, user_id, completed, pay, paid, skipped)
                     VALUES (1, $userId, FALSE, 0.0, FALSE, FALSE)"""
            )
            .transactionally
        )

        val after = mappingAllSteps()
        after.head mustBe before.head + 1 // step 1 "visited" now includes the direct-/explore entrant
        after(1) mustBe before(1) + 1     // step 2 "tutorial_started"
      } finally {
        run(
          DBIO
            .seq(
              sqlu"""DELETE FROM "#$schema".mission WHERE user_id = $userId""",
              sqlu"""DELETE FROM "#$schema".webpage_activity WHERE user_id = $userId""",
              sqlu"DELETE FROM sidewalk_login.sidewalk_user WHERE user_id = $userId"
            )
            .transactionally
        )
      }
    }
  }
}
