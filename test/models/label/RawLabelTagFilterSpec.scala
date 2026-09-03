package models.label

import models.api.TagFilterForApi
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) test for the SQL that `/v3/api/rawLabels` builds from its `tags` parameter.
 *
 * The clause is string-built and never surfaces in a response, so nothing else can catch a mistake in it: the
 * endpoint answers 200 with a well-formed FeatureCollection whichever way the disjuncts land, which is exactly how
 * the LabelMap's download came to disagree with the map it was downloading (#4095).
 *
 * The rule under test: an entry scoped to a label type narrows only that type, and types nobody scoped come back
 * unnarrowed — mirroring the sidebar, where tag pills chosen under `CurbRamp` say nothing about `Obstacle`.
 */
class RawLabelTagFilterSpec extends AnyFunSuite with Matchers {

  private def scoped(labelType: String, tag: String) = TagFilterForApi(Some(labelType), tag)
  private def unscoped(tag: String)                  = TagFilterForApi(None, tag)

  test("an unscoped tag narrows every label type") {
    LabelTable.tagWhereClause(Seq(unscoped("narrow"))) shouldBe "('narrow' = ANY(label.tags))"
  }

  test("unscoped tags are OR'd together") {
    LabelTable.tagWhereClause(Seq(unscoped("narrow"), unscoped("uneven surface"))) shouldBe
      "('narrow' = ANY(label.tags) OR 'uneven surface' = ANY(label.tags))"
  }

  test("a scoped tag narrows its own type and lets every other type through") {
    LabelTable.tagWhereClause(Seq(scoped("CurbRamp", "narrow"))) shouldBe
      "((label.label_type = 'CurbRamp' AND ('narrow' = ANY(label.tags))) OR " +
      "label.label_type NOT IN ('CurbRamp'))"
  }

  test("each scoped type is narrowed only by its own tags") {
    LabelTable.tagWhereClause(
      Seq(scoped("CurbRamp", "narrow"), scoped("Obstacle", "trash can"), scoped("CurbRamp", "steep"))
    ) shouldBe
      "((label.label_type = 'CurbRamp' AND ('narrow' = ANY(label.tags) OR 'steep' = ANY(label.tags))) OR " +
      "(label.label_type = 'Obstacle' AND ('trash can' = ANY(label.tags))) OR " +
      "label.label_type NOT IN ('CurbRamp', 'Obstacle'))"
  }

  test("an unscoped tag still applies to the scoped types alongside their own tags") {
    LabelTable.tagWhereClause(Seq(scoped("CurbRamp", "narrow"), unscoped("uneven surface"))) shouldBe
      "((label.label_type = 'CurbRamp' AND " +
      "('narrow' = ANY(label.tags) OR 'uneven surface' = ANY(label.tags))) OR " +
      "(label.label_type NOT IN ('CurbRamp') AND ('uneven surface' = ANY(label.tags))))"
  }

  test("the clause does not depend on the order the entries arrived in") {
    val entries = Seq(scoped("Obstacle", "trash can"), unscoped("narrow"), scoped("CurbRamp", "steep"))
    LabelTable.tagWhereClause(entries) shouldBe LabelTable.tagWhereClause(entries.reverse)
  }

  test("tag text is escaped, so a quote cannot break out of its literal") {
    LabelTable.tagWhereClause(Seq(unscoped("no one's ramp"))) shouldBe "('no one''s ramp' = ANY(label.tags))"
  }

  test("a tag carrying a comma or a colon survives as a single literal") {
    // Real tags: Signal's "yellow box, ..." and the "cycle lane: ..." family.
    LabelTable.tagWhereClause(Seq(scoped("Signal", "yellow box, accessibility features not visible"))) shouldBe
      "((label.label_type = 'Signal' AND " +
      "('yellow box, accessibility features not visible' = ANY(label.tags))) OR " +
      "label.label_type NOT IN ('Signal'))"
    LabelTable.tagWhereClause(Seq(unscoped("cycle lane: faded paint"))) shouldBe
      "('cycle lane: faded paint' = ANY(label.tags))"
  }
}
