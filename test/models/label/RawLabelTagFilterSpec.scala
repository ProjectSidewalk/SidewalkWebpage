package models.label

import models.api.TagFilterForApi
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

/**
 * Which labels the `/v3/api/rawLabels` `tags` filter keeps, checked by running the clause over made-up label rows.
 *
 * The clause never surfaces in a response, so nothing else can catch a mistake in it: the endpoint answers 200 with a
 * well-formed FeatureCollection whichever way the conditions land, which is exactly how the LabelMap's download came to
 * disagree with the map it was downloading (#4095).
 *
 * The rule under test: an entry scoped to a label type narrows only that type, and types nobody scoped come back
 * unnarrowed — mirroring the sidebar, where tag pills chosen under `CurbRamp` say nothing about `Obstacle`.
 */
class RawLabelTagFilterSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private def scoped(labelType: String, tag: String) = TagFilterForApi(Some(labelType), tag)
  private def unscoped(tag: String)                  = TagFilterForApi(None, tag)

  /** A made-up label: its type and its tags. */
  private case class Row(labelType: String, tags: String*)

  /**
   * Runs the tag clause over the given rows, standing in for the `label` table.
   *
   * @return The rows the clause keeps.
   */
  private def kept(filters: Seq[TagFilterForApi], rows: Row*): Seq[Row] = {
    val types: Seq[String]    = rows.map(_.labelType)
    val tagLists: Seq[String] = rows.map(_.tags.mkString("|"))
    val keptIndexes           = run(
      sql"""SELECT label.row_num
            FROM (
                SELECT row_num::int, row_type::label_type AS label_type, string_to_array(row_tags, '|') AS tags
                FROM unnest($types::text[], $tagLists::text[]) WITH ORDINALITY AS input(row_type, row_tags, row_num)
            ) AS label
            WHERE """.concat(LabelTable.tagWhereClause(filters)).concat(sql" ORDER BY label.row_num").as[Int]
    )
    keptIndexes.map(i => rows(i - 1))
  }

  "The rawLabels tags filter" should {
    "narrow every label type by an unscoped tag" in {
      val (narrowRamp, steepRamp, narrowObstacle) =
        (Row("CurbRamp", "narrow"), Row("CurbRamp", "steep"), Row("Obstacle", "narrow"))
      kept(Seq(unscoped("narrow")), narrowRamp, steepRamp, narrowObstacle) mustBe Seq(narrowRamp, narrowObstacle)
    }

    "keep a label carrying any of several unscoped tags" in {
      val (narrow, uneven, neither) = (Row("CurbRamp", "narrow"), Row("Obstacle", "uneven surface"), Row("Obstacle"))
      kept(Seq(unscoped("narrow"), unscoped("uneven surface")), narrow, uneven, neither) mustBe Seq(narrow, uneven)
    }

    "narrow a scoped tag's own type and let every other type through" in {
      val (narrowRamp, plainRamp, plainObstacle) = (Row("CurbRamp", "narrow"), Row("CurbRamp"), Row("Obstacle"))
      kept(Seq(scoped("CurbRamp", "narrow")), narrowRamp, plainRamp, plainObstacle) mustBe
        Seq(narrowRamp, plainObstacle)
    }

    "narrow each scoped type only by its own tags" in {
      val filters =
        Seq(scoped("CurbRamp", "narrow"), scoped("Obstacle", "trash can"), scoped("CurbRamp", "steep"))
      val (steepRamp, trashRamp, trashObstacle) =
        (Row("CurbRamp", "steep"), Row("CurbRamp", "trash can"), Row("Obstacle", "trash can"))
      val (narrowObstacle, plainSignal) = (Row("Obstacle", "narrow"), Row("Signal"))
      kept(filters, steepRamp, trashRamp, trashObstacle, narrowObstacle, plainSignal) mustBe
        Seq(steepRamp, trashObstacle, plainSignal)
    }

    "apply an unscoped tag to the scoped types alongside their own tags" in {
      val filters                         = Seq(scoped("CurbRamp", "narrow"), unscoped("uneven surface"))
      val (unevenRamp, plainRamp)         = (Row("CurbRamp", "uneven surface"), Row("CurbRamp"))
      val (unevenObstacle, plainObstacle) = (Row("Obstacle", "uneven surface"), Row("Obstacle"))
      kept(filters, unevenRamp, plainRamp, unevenObstacle, plainObstacle) mustBe Seq(unevenRamp, unevenObstacle)
    }

    "not depend on the order the entries arrived in" in {
      val entries = Seq(scoped("Obstacle", "trash can"), unscoped("narrow"), scoped("CurbRamp", "steep"))
      val rows    = Seq(
        Row("Obstacle", "trash can"),
        Row("Obstacle", "narrow"),
        Row("CurbRamp", "steep"),
        Row("CurbRamp", "narrow"),
        Row("Signal", "narrow"),
        Row("Signal")
      )
      LabelTable.tagWhereClause(entries).sql mustBe LabelTable.tagWhereClause(entries.reverse).sql
      kept(entries, rows: _*) mustBe kept(entries.reverse, rows: _*)
    }

    "match a tag with a quote, comma, or colon in it as the whole tag" in {
      val quoted  = Row("CurbRamp", "no one's ramp")
      val comma   = Row("Signal", "yellow box, accessibility features not visible")
      val colon   = Row("Obstacle", "cycle lane: faded paint")
      val filters = Seq(
        unscoped("no one's ramp"),
        scoped("Signal", "yellow box, accessibility features not visible"),
        unscoped("cycle lane: faded paint")
      )
      kept(filters, quoted, comma, colon, Row("CurbRamp", "no one"), Row("Signal", "yellow box")) mustBe
        Seq(quoted, comma, colon)
    }
  }
}
