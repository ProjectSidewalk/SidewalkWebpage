package models.label

import models.api.LabelCommentForApi
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.time.{OffsetDateTime, ZoneOffset}

/**
 * Pure tests for how Raw Labels reads a label's comment aggregate (#5849): a comment from someone with no vote on the
 * label (the reason comments are their own list), and a time Postgres rendered in a non-UTC session zone.
 */
class LabelCommentsForApiSpec extends AnyFunSuite with Matchers {

  private val aggJson =
    """[
      |  {"user_id": "u-1", "comment": "ample space to avoid this object",
      |   "time_created": "2026-10-27T16:45:47+00:00", "validation": null, "reason": "ample-space"},
      |  {"user_id": "u-2", "comment": "ramp present",
      |   "time_created": "2026-10-27T10:00:00-07:00", "validation": "Disagree", "reason": null}
      |]""".stripMargin

  private val parsed = LabelTable.parseCommentsForApiJson(aggJson)

  test("a comment without a vote keeps a None validation and its canned reason") {
    parsed.head shouldBe LabelCommentForApi(
      "u-1",
      "ample space to avoid this object",
      Some("ample-space"),
      None,
      OffsetDateTime.of(2026, 10, 27, 16, 45, 47, 0, ZoneOffset.UTC)
    )
  }

  test("a time rendered in another session zone comes out as the same instant in UTC") {
    parsed(1).timeCreated shouldBe OffsetDateTime.of(2026, 10, 27, 17, 0, 0, 0, ZoneOffset.UTC)
    (parsed(1).toJson \ "time_created").as[String] shouldBe "2026-10-27T17:00:00Z"
  }

  test("serializes the documented keys, with null for a missing vote or reason") {
    val json = parsed.head.toJson
    json.keys shouldBe Set("user_id", "comment", "reason", "validation", "time_created")
    (json \ "validation").toOption.map(_.toString) shouldBe Some("null")
    (parsed(1).toJson \ "reason").toOption.map(_.toString) shouldBe Some("null")
  }
}
