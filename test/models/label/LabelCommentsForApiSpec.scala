package models.label

import models.api.LabelCommentForApi
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.time.{OffsetDateTime, ZoneOffset}

/**
 * Pure tests for how Raw Labels reads a label's `label_comments_agg` JSON (#5849). Comments are keyed per (label,
 * user), not per vote, so the two shapes a per-vote field could not hold must survive: a comment from someone with no
 * vote on the label, and several comments from one user.
 */
class LabelCommentsForApiSpec extends AnyFunSuite with Matchers {

  // The view's wire shape, including the `username` the label card reads and the API must not.
  private val viewJson =
    """[
      |  {"username": "alice", "user_id": "u-1", "comment": "ample space to avoid this object",
      |   "time_created": "2026-10-27T16:45:47+00:00", "validation": null, "reason": "ample-space"},
      |  {"username": "bob", "user_id": "u-2", "comment": "first look",
      |   "time_created": "2026-10-27T17:00:00+00:00", "validation": "Disagree", "reason": null},
      |  {"username": "bob", "user_id": "u-2", "comment": "second look",
      |   "time_created": "2026-10-27T17:05:00+00:00", "validation": "Disagree", "reason": null}
      |]""".stripMargin

  private val parsed = LabelTable.parseCommentsForApiJson(viewJson)

  test("a comment without a vote keeps a None validation and its canned reason") {
    parsed.head shouldBe LabelCommentForApi(
      "u-1",
      "ample space to avoid this object",
      Some("ample-space"),
      None,
      Some(OffsetDateTime.of(2026, 10, 27, 16, 45, 47, 0, ZoneOffset.UTC))
    )
  }

  test("two comments from the same user are both kept, in the view's order") {
    parsed.filter(_.userId == "u-2").map(_.comment) shouldBe Seq("first look", "second look")
    parsed.filter(_.userId == "u-2").map(_.validation).distinct shouldBe Seq(Some("Disagree"))
  }

  test("serializes by user_id with null for missing values, never the username") {
    val json = parsed.head.toJson
    json.keys shouldBe Set("user_id", "comment", "reason", "validation", "time_created")
    (json \ "validation").toOption.map(_.toString) shouldBe Some("null")
    (parsed(1).toJson \ "reason").toOption.map(_.toString) shouldBe Some("null")
    json.toString should not include "alice"
  }
}
