package formats.json

import formats.json.ExploreFormats._
import models.audit.AuditTask
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.Json

import java.time.OffsetDateTime

/**
 * Pure (no DB, no app boot) contract tests for the explore submission formats touched by #4451.
 *
 * Pins two contracts the compiler cannot check: the client's `audited_distance_m` field parses into
 * `TaskSubmission.auditedDistanceM` (the value the server now derives free-exploration street completion from), and
 * the `AuditTask` writer carries every column — a hand-built functional writer whose field list silently drifts when
 * a column is added to the case class but not to the writer.
 */
class ExploreFormatsSpec extends AnyFunSuite with Matchers {

  private val taskSubmissionJson =
    """{
      |  "street_edge_id": 42,
      |  "task_start": "2026-07-19T10:00:00Z",
      |  "audit_task_id": 7,
      |  "completed": false,
      |  "current_lat": 40.89,
      |  "current_lng": -74.02,
      |  "start_point_reversed": false,
      |  "last_priority_update_time": "2026-07-19T10:00:00Z",
      |  "request_updated_street_priority": false,
      |  "audited_distance_m": 123.4
      |}""".stripMargin

  test("TaskSubmission parses audited_distance_m") {
    val sub = Json.parse(taskSubmissionJson).as[TaskSubmission]
    sub.streetEdgeId shouldBe 42
    sub.auditedDistanceM shouldBe Some(123.4)
  }

  test("TaskSubmission tolerates a missing audited_distance_m (older clients)") {
    val withoutDistance = Json.parse(taskSubmissionJson).as[play.api.libs.json.JsObject] - "audited_distance_m"
    withoutDistance.as[TaskSubmission].auditedDistanceM shouldBe None
  }

  test("AuditTask serializes audited_distance_m and start_offset_m in snake_case") {
    val now  = OffsetDateTime.parse("2026-07-19T10:00:00Z")
    val task = AuditTask(1, None, "user-1", 42, now, now, completed = false, 40.89, -74.02, startPointReversed = false,
      Some(9), None, lowQuality = false, incomplete = false, stale = false, auditedDistanceM = Some(12.3),
      startOffsetM = Some(16.1))

    val json = Json.toJson(task)
    (json \ "audit_task_id").as[Int] shouldBe 1
    (json \ "street_edge_id").as[Int] shouldBe 42
    (json \ "completed").as[Boolean] shouldBe false
    (json \ "audited_distance_m").as[Double] shouldBe 12.3
    (json \ "start_offset_m").as[Double] shouldBe 16.1
  }

  test("AuditTask omits the nullable distance fields when absent") {
    val now  = OffsetDateTime.parse("2026-07-19T10:00:00Z")
    val task = AuditTask(1, None, "user-1", 42, now, now, completed = false, 40.89, -74.02, startPointReversed = false,
      Some(9), None, lowQuality = false, incomplete = false, stale = false, auditedDistanceM = None)

    val json = Json.toJson(task)
    (json \ "audited_distance_m").toOption shouldBe None
    (json \ "start_offset_m").toOption shouldBe None
  }
}
