package formats.json

import formats.json.ValidateFormats._
import models.utils.CommonUtils.UiSource
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.{JsError, JsSuccess, Json}

/**
 * Pure (no DB, no app boot) contract test for the `/labelmap/validate` request body.
 *
 * Regression guard for #456: the public share page (`SharedLabel.js`) submits votes with a `ui_source` that mirrors
 * the Gallery image/thumbs split — `SharedLabelImage` from the pano-overlay buttons, `SharedLabelThumbs` from the vote
 * column — plus the base `SharedLabel`. When any of those is missing from the Scala `UiSource` enum, the `Reads`
 * rejects the vote with a 400 — a frontend/backend contract break the compiler cannot see, since the frontend literal
 * and the backend enum live in different languages. This asserts the share payload parses and that an unknown source
 * is rejected, so the two sides can't silently drift again.
 */
class ValidateFormatsSpec extends AnyFunSuite with Matchers {

  /** A validation submission body mirroring what LabelDetail.#validateLabel POSTs from the share page. */
  private def shareVoteJson(source: String): String =
    s"""{
       |  "label_id": 200762,
       |  "label_type": "CurbRamp",
       |  "validation_result": "Agree",
       |  "old_severity": 1,
       |  "new_severity": 1,
       |  "old_tags": [],
       |  "new_tags": [],
       |  "canvas_x": 100,
       |  "canvas_y": 100,
       |  "heading": 256.5,
       |  "pitch": -14.8,
       |  "zoom": 1.0,
       |  "canvas_height": 480,
       |  "canvas_width": 640,
       |  "start_timestamp": "2026-07-12T13:45:00.000Z",
       |  "end_timestamp": "2026-07-12T13:45:00.000Z",
       |  "source": "$source",
       |  "undone": false,
       |  "redone": true,
       |  "viewer_type": "Default"
       |}""".stripMargin

  test("the three share-page ui_source values are registered so share votes are accepted") {
    UiSource.withName("SharedLabel") shouldBe UiSource.SharedLabel
    UiSource.withName("SharedLabelImage") shouldBe UiSource.SharedLabelImage
    UiSource.withName("SharedLabelThumbs") shouldBe UiSource.SharedLabelThumbs
  }

  test("a share-page vote (source = SharedLabelImage, the pano-overlay button) parses") {
    Json.parse(shareVoteJson("SharedLabelImage")).validate[LabelMapValidationSubmission] match {
      case JsSuccess(submission, _) =>
        submission.labelId shouldBe 200762
        submission.source shouldBe UiSource.SharedLabelImage
      case JsError(errors) =>
        fail(s"Expected the share vote to parse, but got: $errors")
    }
  }

  test("an unknown source is rejected, so a new UI surface can't ship a source the backend doesn't know") {
    Json.parse(shareVoteJson("NotARealSource")).validate[LabelMapValidationSubmission] shouldBe a[JsError]
  }
}
