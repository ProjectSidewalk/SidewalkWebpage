package models.label

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

/**
 * Pins the Scala enum to the Postgres `label_type` enum it maps onto (373.sql). Names are self-enforcing (an unknown
 * one fails on read or write), but the declaration order is not: nothing else would notice if the two lists drifted,
 * and `LabelTypeEnum.ordered` decides API output order and the access-score CSV/shapefile column order.
 */
class LabelTypeEnumDbSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  "LabelTypeEnum.ordered" should {
    "list exactly the Postgres label_type enum's labels, in its declaration order" in {
      run(sql"SELECT unnest(enum_range(NULL::label_type))::text".as[String]) mustBe LabelTypeEnum.orderedNames
    }
  }

  // The constraints spell the unrated types out by name (395.sql), so the enum's RatingScale is what they must match.
  "the unrated-type severity CHECKs" should {
    "name exactly the types LabelTypeEnum rates as Unrated" in {
      val checks = run(
        sql"""SELECT conrelid::regclass::text, pg_get_constraintdef(oid)
              FROM pg_constraint
              WHERE conname LIKE '%_unrated_no_severity_check'""".as[(String, String)]
      )
      checks.map(_._1).toSet mustBe Set("label", "label_history", "label_edit")
      checks.foreach { case (table, definition) =>
        withClue(s"$table: ") {
          "'([A-Za-z]+)'::label_type".r.findAllMatchIn(definition).map(_.group(1)).toSet mustBe
            LabelTypeEnum.unratedTypeNames.toSet
        }
      }
    }
  }
}
