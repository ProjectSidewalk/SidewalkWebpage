package controllers

import controllers.helper.SubmissionSpecHelpers
import models.utils.MyPostgresProfile.api._
import org.scalatest.concurrent.Eventually
import org.scalatest.time.{Seconds, Span}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json._
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

import java.time.OffsetDateTime

/**
 * Functional tests for the Validate submission endpoints — `POST /validationTask` (the Validate tool) and
 * `POST /labelmap/validate` (the LabelMap/Gallery path) — the write path that turns a validation into a
 * `label_validation` row and the label's updated agree/disagree/unsure counts (#4777).
 *
 * Follows the real client bootstrap: GET /validate embeds the assigned mission and label batch as inline page JS
 * (`param.*`), and the spec validates the first labels of that real batch. Every validation made here is cleared
 * through the same endpoints' undo flow (#4653), restoring the label's counts, so repeated runs leave no validations
 * behind in a shared dev DB. Tests cancel (not fail) when the connected DB can't hand out a validation mission
 * (that requires >= 10 validatable labels of one type).
 */
class ValidateSubmissionSpec extends PlaySpec with GuiceOneAppPerSuite with SubmissionSpecHelpers with Eventually {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  /** The validate-page values a submission payload is built from, as the real client reads them. */
  private case class ValidateBootstrap(userId: String, missionId: Int, mission: JsObject, labels: Seq[JsObject])

  /** Loads /validate for the session and pulls the assigned mission and label batch out of the bootstrap script. */
  private def fetchValidateBootstrap(session: Seq[Cookie]): ValidateBootstrap = {
    val resp = route(app, FakeRequest(GET, "/validate").withCookies(session: _*)).get
    if (status(resp) != OK) cancel(s"/validate responded ${status(resp)}.")
    val html    = contentAsString(resp)
    val mission = embeddedPageJson(html, "param.mission")
      .collect { case obj: JsObject => obj }
      .getOrElse(cancel("No validation mission available (needs >= 10 validatable labels of one type)."))
    val labels = embeddedPageJson(html, "param.labelList")
      .collect { case arr: JsArray => arr.value.toSeq }
      .getOrElse(cancel("No label batch in the validate bootstrap."))
      .map(_.as[JsObject])
    val missionId = (mission \ "mission_id").as[Int]
    // The mission was just minted for this session's user, so it resolves the anon user's id for row assertions.
    val userId = runDb(sql"SELECT user_id FROM mission WHERE mission_id = $missionId".as[String]).head
    ValidateBootstrap(userId, missionId, mission, labels)
  }

  /**
   * A single validation as the Validate frontend submits one. Severity and tags echo the label's current values, so
   * an Agree changes nothing in the label's own severity/tags (no label_history side effects to clean up).
   */
  private def validationJson(
      label: JsObject,
      missionId: Int,
      result: String,
      undone: Boolean = false,
      redone: Boolean = false
  ): JsObject = {
    val now = OffsetDateTime.now
    Json.obj(
      "label_id"          -> (label \ "label_id").as[Int],
      "mission_id"        -> missionId,
      "validation_result" -> result,
      "old_severity"      -> (label \ "severity").asOpt[Int],
      "new_severity"      -> (label \ "severity").asOpt[Int],
      "old_tags"          -> (label \ "tags").as[JsArray],
      "new_tags"          -> (label \ "tags").as[JsArray],
      "canvas_x"          -> 355,
      "canvas_y"          -> 242,
      "heading"           -> (label \ "heading").as[Double],
      "pitch"             -> (label \ "pitch").as[Double],
      "zoom"              -> (label \ "zoom").as[Double],
      "canvas_height"     -> 440,
      "canvas_width"      -> 720,
      "start_timestamp"   -> now,
      "end_timestamp"     -> now,
      "source"            -> "Validate",
      "undone"            -> undone,
      "redone"            -> redone,
      "viewer_type"       -> "Default"
    )
  }

  /** A full `POST /validationTask` payload mirroring the frontend's compiled submission data. */
  private def taskSubmission(
      b: ValidateBootstrap,
      validations: Seq[JsObject],
      missionProgress: Option[JsObject] = None
  ): JsObject = {
    val now = OffsetDateTime.now
    Json.obj(
      "interactions" -> Json.arr(
        Json.obj("action" -> "ValidationButtonClick_Agree", "mission_id" -> b.missionId, "timestamp" -> now)
      ),
      "environment"      -> Json.obj("mission_id" -> b.missionId, "language" -> "en", "css_zoom" -> 100),
      "validations"      -> validations,
      "mission_progress" -> missionProgress.getOrElse[JsValue](JsNull),
      "validate_params"  -> Json.obj(
        "admin_version"    -> false,
        "label_type"       -> JsNull,
        "user_ids"         -> JsNull,
        "neighborhood_ids" -> JsNull,
        "unvalidated_only" -> false
      ),
      "pano_histories" -> Json.arr(),
      "source"         -> "Validate",
      "timestamp"      -> now
    )
  }

  /** In-progress mission progress for the bootstrap mission, reporting `labelsProgress` labels validated so far. */
  private def missionProgressJson(b: ValidateBootstrap, labelsProgress: Int): JsObject =
    Json.obj(
      "mission_id"      -> b.missionId,
      "mission_type"    -> (b.mission \ "mission_type").as[String],
      "labels_progress" -> labelsProgress,
      "labels_total"    -> (b.mission \ "labels_validated").as[Int],
      "label_type_id"   -> (b.mission \ "label_type_id").as[Int],
      "completed"       -> false,
      "skipped"         -> false
    )

  /** A `POST /labelmap/validate` payload for the given label. */
  private def labelMapValidationJson(label: JsObject, result: String, undone: Boolean = false): JsObject = {
    val now = OffsetDateTime.now
    Json.obj(
      "label_id"          -> (label \ "label_id").as[Int],
      "label_type"        -> (label \ "label_type").as[String],
      "validation_result" -> result,
      "old_severity"      -> (label \ "severity").asOpt[Int],
      "new_severity"      -> (label \ "severity").asOpt[Int],
      "old_tags"          -> (label \ "tags").as[JsArray],
      "new_tags"          -> (label \ "tags").as[JsArray],
      "heading"           -> (label \ "heading").as[Double],
      "pitch"             -> (label \ "pitch").as[Double],
      "zoom"              -> (label \ "zoom").as[Double],
      "canvas_height"     -> 440,
      "canvas_width"      -> 720,
      "start_timestamp"   -> now,
      "end_timestamp"     -> now,
      "source"            -> "LabelMap",
      "undone"            -> undone,
      "redone"            -> false,
      "viewer_type"       -> "Default"
    )
  }

  private def postValidationTask(session: Seq[Cookie], payload: JsValue) =
    route(app, FakeRequest(POST, "/validationTask").withCookies(session: _*).withJsonBody(payload).withCSRFToken).get

  private def postLabelMapValidation(session: Seq[Cookie], payload: JsValue) =
    route(
      app,
      FakeRequest(POST, "/labelmap/validate").withCookies(session: _*).withJsonBody(payload).withCSRFToken
    ).get

  private def validationRow(labelId: Int, userId: String): Option[(String, Int)] =
    runDb(
      sql"""SELECT validation_result::text, mission_id FROM label_validation
            WHERE label_id = $labelId AND user_id = $userId""".as[(String, Int)]
    ).headOption

  private def agreeCount(labelId: Int): Int =
    runDb(sql"SELECT agree_count FROM label WHERE label_id = $labelId".as[Int]).head

  "POST /validationTask" should {
    "reject an unauthenticated submission" in {
      val resp = route(app, FakeRequest(POST, "/validationTask").withJsonBody(Json.obj()).withCSRFToken).get
      status(resp) must not be OK
    }

    "400 a payload that doesn't match the submission contract" in {
      val session = freshAnonSession()
      val resp    = postValidationTask(session, Json.obj("validations" -> "bogus"))
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "status").as[String] mustBe "Error"
    }

    "write a label_validation row for an Agree, bump the label's agree count, and clear both on undo" in {
      val session     = freshAnonSession()
      val b           = fetchValidateBootstrap(session)
      val label       = b.labels.head
      val labelId     = (label \ "label_id").as[Int]
      val agreeBefore = agreeCount(labelId)

      val posted = postValidationTask(
        session,
        taskSubmission(b, Seq(validationJson(label, b.missionId, "Agree")), Some(missionProgressJson(b, 1)))
      )
      status(posted) mustBe OK
      (contentAsJson(posted) \ "has_mission_available").as[Boolean] mustBe true

      validationRow(labelId, b.userId) mustBe Some(("Agree", b.missionId))
      agreeCount(labelId) mustBe agreeBefore + 1
      runDb(sql"SELECT labels_progress FROM mission WHERE mission_id = ${b.missionId}".as[Int]).head mustBe 1

      // The async writes that ride the same submission: interaction and environment rows.
      eventually(timeout(Span(15, Seconds))) {
        runDb(
          sql"SELECT count(*) FROM validation_task_interaction WHERE mission_id = ${b.missionId}".as[Int]
        ).head must be >= 1
        runDb(
          sql"SELECT count(*) FROM validation_task_environment WHERE mission_id = ${b.missionId}".as[Int]
        ).head must be >= 1
      }

      // The undo flow (#4653): the same endpoint with undone=true deletes the validation and restores the counts.
      // Also this spec's cleanup.
      val undone =
        postValidationTask(session, taskSubmission(b, Seq(validationJson(label, b.missionId, "Agree", undone = true))))
      status(undone) mustBe OK
      validationRow(labelId, b.userId) mustBe None
      agreeCount(labelId) mustBe agreeBefore
    }
  }

  "POST /labelmap/validate" should {
    "write a validation under an auto-created labelmapValidation mission, and clear it on undo" in {
      val session = freshAnonSession()
      val b       = fetchValidateBootstrap(session)
      if (b.labels.size < 2) cancel(s"Needs at least 2 labels in the validate batch; found ${b.labels.size}.")
      val label       = b.labels(1)
      val labelId     = (label \ "label_id").as[Int]
      val agreeBefore = agreeCount(labelId)

      val posted = postLabelMapValidation(session, labelMapValidationJson(label, "Agree"))
      status(posted) mustBe OK
      (contentAsJson(posted) \ "status").as[String] mustBe "Success"

      val row = validationRow(labelId, b.userId)
      row mustBe defined
      row.get._1 mustBe "Agree"
      // This endpoint mints (or resumes) its own mission rather than using Validate's.
      val missionType =
        runDb(sql"SELECT mission_type::text FROM mission WHERE mission_id = ${row.get._2}".as[String]).head
      missionType mustBe "labelmapValidation"
      agreeCount(labelId) mustBe agreeBefore + 1

      val undone = postLabelMapValidation(session, labelMapValidationJson(label, "Agree", undone = true))
      status(undone) mustBe OK
      validationRow(labelId, b.userId) mustBe None
      agreeCount(labelId) mustBe agreeBefore
    }
  }
}
