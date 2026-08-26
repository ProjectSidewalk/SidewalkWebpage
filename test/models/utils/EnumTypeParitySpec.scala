package models.utils

import models.pano.PanoImageryChangeSource
import models.street.StreetEdgeStatusChangeSource
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

/**
 * Checks that the Scala enums behind the transition logs still match the Postgres enum types they back.
 *
 * Each of these pairs is held together only by a `NOTE:` comment asking the next person to change both sides. Nothing
 * enforced it, and the failure mode is bad: `createEnumJdbcType` maps by name, so a label present on one side and not
 * the other throws `NoSuchElementException` mid-read on the Scala side, or a "invalid input value for enum" on the
 * Postgres side — at runtime, on whichever page happens to read that row first, long after the change that caused it.
 *
 * Deliberately asserts set equality in both directions. A one-way check would pass while the DB quietly grew a label
 * no Scala code can read, which is the direction an `ALTER TYPE ... ADD VALUE` in a later evolution takes.
 *
 * Requires a Postgres database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class EnumTypeParitySpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  /** The labels Postgres holds for an enum type, in the current schema. */
  private def labelsOf(typeName: String): Set[String] = {
    run(
      sql"""SELECT enumlabel
            FROM pg_enum
            JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
            WHERE pg_type.typname = $typeName
                AND pg_type.typnamespace = current_schema()::regnamespace
            ORDER BY enumsortorder""".as[String]
    ).toSet
  }

  "the Postgres enum types behind the transition logs" should {
    "match JobRunStatus exactly" in {
      labelsOf("job_run_status") mustBe JobRunStatus.values.map(_.toString)
    }

    "match JobRunTrigger exactly" in {
      labelsOf("job_run_trigger") mustBe JobRunTrigger.values.map(_.toString)
    }

    "match StreetEdgeStatusChangeSource exactly" in {
      // This one also has a third side: the `db/scripts` shell writers each emit one of these labels. A source they
      // emit that Postgres doesn't know fails their INSERT loudly, which is why the enum is an enum (#4103).
      labelsOf("street_edge_status_change_source") mustBe StreetEdgeStatusChangeSource.values.map(_.toString)
    }

    "match PanoImageryChangeSource exactly" in {
      // The writers cast a Scala-supplied string to this type inside raw SQL, so a drift here fails the pano upsert
      // itself — the path every labeler's viewer takes — rather than only a read.
      labelsOf("pano_imagery_change_source") mustBe PanoImageryChangeSource.values.map(_.toString)
    }
  }
}
