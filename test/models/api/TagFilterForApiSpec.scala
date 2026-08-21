package models.api

import org.scalatest.EitherValues
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) test for `TagFilterForApi.parse`, the `/v3/api/rawLabels` `tags` parameter's
 * parse-and-validate step.
 *
 * The rules under test: one occurrence is one entry; an entry is validated against the tag vocabulary *before* any
 * comma splitting, so a tag name containing a comma survives intact while an older comma-joined link still resolves;
 * and an unknown or mis-scoped tag is a 400 naming the parameter rather than a silently-empty match.
 */
class TagFilterForApiSpec extends AnyFunSuite with Matchers with EitherValues {

  private val labelTypes = Set("CurbRamp", "Obstacle", "Signal")
  private val commaTag   = "yellow box, accessibility features not visible"
  private val vocabulary = Map(
    "CurbRamp" -> Set("narrow", "steep"),
    "Obstacle" -> Set("narrow", "trash can"),
    "Signal"   -> Set("APS", commaTag, "cycle lane: faded paint")
  )

  private def parse(entries: String*) = TagFilterForApi.parse(entries.toList, labelTypes, vocabulary)

  test("no occurrences parse to no filter") {
    parse() shouldBe Right(None)
  }

  test("an unscoped entry names a tag on any label type") {
    parse("narrow").value shouldBe Some(Seq(TagFilterForApi(None, "narrow")))
  }

  test("a scoped entry names a tag of its own label type") {
    parse("CurbRamp:narrow").value shouldBe Some(Seq(TagFilterForApi(Some("CurbRamp"), "narrow")))
  }

  test("a tag name containing a comma is validated whole, never split") {
    parse(s"Signal:$commaTag").value shouldBe Some(Seq(TagFilterForApi(Some("Signal"), commaTag)))
    parse(commaTag).value shouldBe Some(Seq(TagFilterForApi(None, commaTag)))
  }

  test("a tag name containing a colon is an unscoped tag when its prefix is no label type") {
    parse("cycle lane: faded paint").value shouldBe Some(Seq(TagFilterForApi(None, "cycle lane: faded paint")))
  }

  test("an older comma-joined entry is split once it fails to validate whole") {
    parse("narrow,trash can").value shouldBe
      Some(Seq(TagFilterForApi(None, "narrow"), TagFilterForApi(None, "trash can")))
  }

  test("an older comma-joined entry may mix scoped and unscoped pieces") {
    parse("CurbRamp:narrow,trash can").value shouldBe
      Some(Seq(TagFilterForApi(Some("CurbRamp"), "narrow"), TagFilterForApi(None, "trash can")))
  }

  test("an unknown tag is an error naming the tags parameter") {
    val error = parse("definitely-not-a-tag").left.value
    error.parameter shouldBe Some("tags")
    error.detail should include("definitely-not-a-tag")
  }

  test("a tag scoped to a label type that does not carry it is an error") {
    val error = parse("CurbRamp:APS").left.value
    error.parameter shouldBe Some("tags")
    error.detail should include("not a tag of label type 'CurbRamp'")
  }

  test("a comma-joined entry with one unknown piece is an error naming that piece") {
    val error = parse("narrow,bogus").left.value
    error.parameter shouldBe Some("tags")
    error.detail should include("bogus")
  }

  test("an empty occurrence is an error") {
    parse("narrow", "").left.value.parameter shouldBe Some("tags")
  }

  test("a scoped entry missing its tag is an error") {
    val error = parse("CurbRamp:").left.value
    error.parameter shouldBe Some("tags")
    error.detail should include("Missing tag")
  }

  test("surrounding whitespace is trimmed in both forms") {
    parse("  narrow  ").value shouldBe Some(Seq(TagFilterForApi(None, "narrow")))
    parse("narrow , trash can").value shouldBe
      Some(Seq(TagFilterForApi(None, "narrow"), TagFilterForApi(None, "trash can")))
  }
}
