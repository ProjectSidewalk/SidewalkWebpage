package models.utils

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

import java.io.File

/**
 * The forward-evolution-apply gate (#4335/#4351, #5042).
 *
 * A partial apply is the dangerous case: Play stops at the failing evolution and leaves the rest unapplied, so every
 * later spec reads a schema that is neither the old one nor HEAD, failing in ways that point anywhere but at the
 * evolution.
 *
 * `backend-tests` runs this alone first, before seeding, because the seed writes columns and relies on constraints
 * that arrive with evolutions well past the committed template's level.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class EvolutionsApplySpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val headRevision: Int = {
    val files = Option(new File("conf/evolutions/default").listFiles()).getOrElse(Array.empty[File])
    files
      .map(_.getName)
      .collect { case name if name.endsWith(".sql") => name.stripSuffix(".sql") }
      .flatMap(_.toIntOption)
      .maxOption
      .getOrElse(fail("no numbered evolution files found under conf/evolutions/default"))
  }

  "Booting the app" should {
    "apply every committed evolution to the connected schema" in {
      run(sql"SELECT COALESCE(MAX(id), 0) FROM play_evolutions".as[Int].head) mustBe headRevision
    }

    // Play records a failed apply by leaving the row in `applying_up`/`applying_down` with the error in
    // `last_problem`, rather than by removing it — so the MAX(id) check above can pass over a broken evolution.
    "leave no evolution in a failed state" in {
      val broken = run(
        sql"SELECT id, COALESCE(last_problem, '') FROM play_evolutions WHERE state <> 'applied' ORDER BY id"
          .as[(Int, String)]
      )
      broken mustBe empty
    }
  }
}
