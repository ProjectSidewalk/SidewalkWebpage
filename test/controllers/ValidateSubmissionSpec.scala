package controllers

import controllers.helper.SubmissionSpecHelpers
import models.label.LabelTableDef
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatest.concurrent.Eventually
import org.scalatest.time.{Millis, Seconds, Span}
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
 * (`param.*`), and the spec validates the first label of that real batch. Both tests run the endpoint's own undo flow
 * (#4653) and assert it restores what the validation changed.
 *
 * Unlike Explore, these endpoints write against *real* labels that the dev DB inherited from production, so the suite
 * snapshots every label it touches and restores it in `afterAll` alongside deleting its own rows — a failed assertion
 * partway through can't leave a real label carrying a phantom agree count. Tests cancel when the connected schema has
 * no labels to validate (the empty CI city); a /validate that answers anything but 200 on a seeded schema is a bug
 * and fails.
 */
// Mixin order matters: GuiceOneAppPerSuite must be rightmost so its run() wraps BeforeAndAfterAll's — otherwise
// afterAll's cleanup executes after the app (and its DB pool) has shut down and aborts the suite.
class ValidateSubmissionSpec
    extends PlaySpec
    with BeforeAndAfterAll
    with Eventually
    with SubmissionSpecHelpers
    with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // Several anon sessions per run share one loopback IP, so the 100/hr signup cap would 429 across repeat runs
      // and break session minting rather than anything under test.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  private val labelsQ = TableQuery[LabelTableDef]

  /** Users minted by this suite; everything written under them is deleted in `afterAll`. */
  private var createdUserIds: Set[String] = Set.empty

  /** Pre-test state of every real label the suite validated, restored in `afterAll`. */
  private var labelBackup: Map[Int, LabelState] = Map.empty

  /** The dev-DB dumps omit the interaction logs, so their assertions are skipped where the table isn't there. */
  private lazy val interactionsLogged: Boolean = tableExists("validation_task_interaction")

  /** Everything a validation can change on the label it targets. */
  private case class LabelState(
      agreeCount: Int,
      disagreeCount: Int,
      unsureCount: Int,
      correct: Option[Boolean],
      severity: Option[Int],
      tags: List[String]
  )

  /** The validate-page values a submission payload is built from, as the real client reads them. */
  private case class ValidateBootstrap(userId: String, missionId: Int, mission: JsObject, labels: Seq[JsObject])

  /**
   * Loads /validate for the session and pulls the assigned mission and label batch out of the bootstrap script.
   *
   * @param session Cookies from an anonymous session.
   * @return        The mission and label batch the server assigned.
   */
  private def fetchValidateBootstrap(session: Seq[Cookie]): ValidateBootstrap = {
    val labelCount = run(sql"SELECT count(*) FROM label WHERE deleted = false".as[Int]).head
    if (labelCount == 0) cancel("No labels in the connected schema; /validate can't assign a mission.")

    val resp = route(app, FakeRequest(GET, "/validate").withCookies(session: _*)).get
    status(resp) mustBe OK
    val html    = contentAsString(resp)
    val mission = embeddedPageJson(html, "param.mission")
      .collect { case obj: JsObject => obj }
      .getOrElse(cancel("No validation mission available (needs >= 10 validatable labels of one type)."))
    val labels = embeddedPageJson(html, "param.labelList")
      .collect { case arr: JsArray => arr.value.toSeq }
      .getOrElse(fail("No label batch in the validate bootstrap."))
      .map(_.as[JsObject])
    val missionId = (mission \ "mission_id").as[Int]
    // The mission was just minted for this session's user, so it resolves the anon user's id for row assertions.
    val userId = run(sql"SELECT user_id FROM mission WHERE mission_id = $missionId".as[String]).head
    createdUserIds += userId
    ValidateBootstrap(userId, missionId, mission, labels)
  }

  /** Reads everything a validation can change on a label. */
  private def labelState(labelId: Int): LabelState = {
    val row = run(
      labelsQ
        .filter(_.labelId === labelId)
        .map(l => (l.agreeCount, l.disagreeCount, l.unsureCount, l.correct, l.severity, l.tags))
        .result
        .head
    )
    (LabelState.apply _).tupled(row)
  }

  /** Records a label's pre-validation state on first touch, so `afterAll` can put it back. */
  private def backupLabel(labelId: Int): LabelState = {
    val state = labelState(labelId)
    if (!labelBackup.contains(labelId)) labelBackup += (labelId -> state)
    state
  }

  /**
   * A single validation as the Validate frontend submits one.
   *
   * Severity and tags echo the label's current values, which for a well-formed label means the validation makes no
   * change to the label itself. That is an assumption about the data, not a guarantee from the code — `cleanTagList`
   * drops tags that are invalid or mutually exclusive for the label type, so a legacy label carrying one would take
   * the mutation branch — which is why the tests assert the label's severity, tags, and history are untouched rather
   * than take it on trust.
   */
  private def validationJson(
      label: JsObject,
      missionId: Int,
      result: String,
      undone: Boolean = false,
      redone: Boolean = false,
      comment: Option[String] = None
  ): JsObject = {
    val now         = OffsetDateTime.now
    val commentJson = comment.map { text =>
      Json.obj(
        "mission_id" -> missionId,
        "label_id"   -> (label \ "label_id").as[Int],
        "comment"    -> text,
        "pano_id"    -> (label \ "pano_id").as[String],
        "heading"    -> (label \ "heading").as[Double],
        "pitch"      -> (label \ "pitch").as[Double],
        "zoom"       -> (label \ "zoom").as[Double],
        "lat"        -> (label \ "lat").as[Double],
        "lng"        -> (label \ "lng").as[Double]
      )
    }
    Json.obj("comment" -> commentJson) ++ Json.obj(
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
      missionProgress: Option[JsObject]
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

  /** Posts a Validate-tool submission over HTTP as the session's user. */
  private def postValidationTask(session: Seq[Cookie], payload: JsValue) =
    route(app, FakeRequest(POST, "/validationTask").withCookies(session: _*).withJsonBody(payload).withCSRFToken).get

  /** Posts a LabelMap/Gallery validation over HTTP as the session's user. */
  private def postLabelMapValidation(session: Seq[Cookie], payload: JsValue) =
    route(
      app,
      FakeRequest(POST, "/labelmap/validate").withCookies(session: _*).withJsonBody(payload).withCSRFToken
    ).get

  /**
   * The user's validation of a label, if any.
   *
   * @return The validation result and the mission it was recorded under, or None when the user has no validation of
   *         this label — which is what an undo must leave behind.
   */
  private def validationRow(labelId: Int, userId: String): Option[(String, Int)] =
    run(
      sql"""SELECT validation_result::text, mission_id FROM label_validation
            WHERE label_id = $labelId AND user_id = $userId""".as[(String, Int)]
    ).headOption

  /** How many validations of the label the user holds; the unique constraint means this is only ever 0 or 1. */
  private def validationCount(labelId: Int, userId: String): Int =
    run(
      sql"SELECT count(*) FROM label_validation WHERE label_id = $labelId AND user_id = $userId".as[Int]
    ).head

  /** The user's free-text comments on the label, which are keyed by (label, user) rather than by validation. */
  private def commentsOn(labelId: Int, userId: String): Seq[String] =
    run(
      sql"SELECT comment FROM validation_task_comment WHERE label_id = $labelId AND user_id = $userId".as[String]
    )

  /** How many `label_history` rows the label carries; a validation that changes nothing must not add one. */
  private def labelHistoryCount(labelId: Int): Int =
    run(sql"SELECT count(*) FROM label_history WHERE label_id = $labelId".as[Int]).head

  /** The mission's recorded progress, which the client reports alongside each validation. */
  private def missionProgress(missionId: Int): Int =
    run(sql"SELECT labels_progress FROM mission WHERE mission_id = $missionId".as[Int]).head

  /**
   * Removes the suite's own rows and puts back every real label it validated.
   *
   * The happy path already undoes its validations through the endpoint; this is the safety net for a run that dies
   * partway through, where the shared dev DB would otherwise keep a real label's inflated counts forever. Derived
   * aggregates the deletion can't restore (the labeler's `user_stat.accuracy`) are recomputed by the nightly job.
   */
  private def deleteSubmittedData(): Unit = {
    createdUserIds.foreach { uId =>
      val _ = run(
        DBIO.seq(
          sqlu"""DELETE FROM label_history
                 WHERE label_validation_id IN (SELECT label_validation_id FROM label_validation WHERE user_id = $uId)""",
          sqlu"""DELETE FROM label_ai_assessment
                 WHERE label_validation_id IN (SELECT label_validation_id FROM label_validation WHERE user_id = $uId)""",
          sqlu"DELETE FROM validation_task_comment WHERE mission_id IN (SELECT mission_id FROM mission WHERE user_id = $uId)",
          sqlu"""DELETE FROM validation_task_environment
                 WHERE mission_id IN (SELECT mission_id FROM mission WHERE user_id = $uId)""",
          sqlu"""DELETE FROM validation_task_interaction
                 WHERE mission_id IN (SELECT mission_id FROM mission WHERE user_id = $uId)""",
          sqlu"DELETE FROM label_validation WHERE user_id = $uId",
          sqlu"DELETE FROM mission WHERE user_id = $uId"
        )
      )
    }
    labelBackup.foreach { case (labelId, state) =>
      val _ = run(
        labelsQ
          .filter(_.labelId === labelId)
          .map(l => (l.agreeCount, l.disagreeCount, l.unsureCount, l.correct, l.severity, l.tags))
          .update((state.agreeCount, state.disagreeCount, state.unsureCount, state.correct, state.severity, state.tags))
      )
    }
  }

  override def afterAll(): Unit = {
    try deleteSubmittedData()
    finally super.afterAll()
  }

  "POST /validationTask" should {
    "401 an unauthenticated submission" in {
      // Sec-Fetch-Mode pins the fetch/XHR arm of ControllerUtils.anonSignupRedirect — what the real client hits;
      // RouteAuthPostureSpec covers the navigation arm.
      val resp = route(
        app,
        FakeRequest(POST, "/validationTask")
          .withHeaders("Sec-Fetch-Mode" -> "cors")
          .withJsonBody(Json.obj())
          .withCSRFToken
      ).get
      status(resp) mustBe UNAUTHORIZED
    }

    "400 a payload that doesn't match the submission contract" in {
      val session = freshAnonSession()
      val resp    = postValidationTask(session, Json.obj("validations" -> "bogus"))
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "status").as[String] mustBe "Error"
    }

    "write a label_validation row for an Agree, bump the label's agree count, and clear both on undo" in {
      val session      = freshAnonSession()
      val b            = fetchValidateBootstrap(session)
      val label        = b.labels.head
      val labelId      = (label \ "label_id").as[Int]
      val before       = backupLabel(labelId)
      val historyCount = labelHistoryCount(labelId)

      val posted = postValidationTask(
        session,
        taskSubmission(b, Seq(validationJson(label, b.missionId, "Agree")), Some(missionProgressJson(b, 1)))
      )
      status(posted) mustBe OK
      (contentAsJson(posted) \ "has_mission_available").as[Boolean] mustBe true

      validationRow(labelId, b.userId) mustBe Some(("Agree", b.missionId))
      missionProgress(b.missionId) mustBe 1

      // An Agree that re-sends the label's own severity and tags is a pure vote: the counts move, the label's own
      // content doesn't, and nothing is appended to its edit history.
      val agreed = labelState(labelId)
      agreed.agreeCount mustBe before.agreeCount + 1
      agreed.severity mustBe before.severity
      agreed.tags mustBe before.tags
      labelHistoryCount(labelId) mustBe historyCount

      // The async writes that ride the same submission: interaction and environment rows.
      eventually(timeout(Span(15, Seconds)), interval(Span(250, Millis))) {
        run(
          sql"SELECT count(*) FROM validation_task_environment WHERE mission_id = ${b.missionId}".as[Int]
        ).head mustBe 1
      }
      if (interactionsLogged) {
        eventually(timeout(Span(15, Seconds)), interval(Span(250, Millis))) {
          run(
            sql"SELECT count(*) FROM validation_task_interaction WHERE mission_id = ${b.missionId}".as[Int]
          ).head mustBe 1
        }
      } else {
        info("validation_task_interaction is absent from this schema, so its assertion is skipped.")
      }

      // The undo flow (#4653): the same endpoint with undone=true deletes the validation and restores the counts. The
      // client decrements its mission progress and reports it on the undo POST like any other submission, so the
      // mission row must walk back with it.
      val undone = postValidationTask(
        session,
        taskSubmission(
          b,
          Seq(validationJson(label, b.missionId, "Agree", undone = true)),
          Some(missionProgressJson(b, 0))
        )
      )
      status(undone) mustBe OK
      validationRow(labelId, b.userId) mustBe None
      labelState(labelId) mustBe before
      missionProgress(b.missionId) mustBe 0
    }

    "answer 200 and leave one row when the identical submission arrives twice (#4377)" in {
      val session      = freshAnonSession()
      val b            = fetchValidateBootstrap(session)
      val label        = b.labels.head
      val labelId      = (label \ "label_id").as[Int]
      val before       = backupLabel(labelId)
      val historyCount = labelHistoryCount(labelId)
      val submission   =
        taskSubmission(b, Seq(validationJson(label, b.missionId, "Agree")), Some(missionProgressJson(b, 1)))

      status(postValidationTask(session, submission)) mustBe OK
      // A client that missed the first response resends the same snapshot verbatim. It has to land as a replacement,
      // not as a unique-constraint violation that rolls the batch back and 500s.
      status(postValidationTask(session, submission)) mustBe OK

      validationCount(labelId, b.userId) mustBe 1
      validationRow(labelId, b.userId) mustBe Some(("Agree", b.missionId))
      // The vote is counted once, not twice — the replacement unwinds the first one's effect before applying itself.
      labelState(labelId).agreeCount mustBe before.agreeCount + 1
      labelHistoryCount(labelId) mustBe historyCount
    }

    "let a second validation of the same label replace the first verdict (#4377)" in {
      val session = freshAnonSession()
      val b       = fetchValidateBootstrap(session)
      val label   = b.labels.head
      val labelId = (label \ "label_id").as[Int]
      val before  = backupLabel(labelId)

      val progress = Some(missionProgressJson(b, 1))
      status(postValidationTask(session, taskSubmission(b, Seq(validationJson(label, b.missionId, "Agree")), progress)))
        .mustBe(OK)
      status(
        postValidationTask(session, taskSubmission(b, Seq(validationJson(label, b.missionId, "Disagree")), progress))
      ).mustBe(OK)

      validationCount(labelId, b.userId) mustBe 1
      validationRow(labelId, b.userId).map(_._1) mustBe Some("Disagree")
      val after = labelState(labelId)
      after.agreeCount mustBe before.agreeCount
      after.disagreeCount mustBe before.disagreeCount + 1
    }

    "keep the user's earlier comment when a repeat validation carries none (#4377)" in {
      val session = freshAnonSession()
      val b       = fetchValidateBootstrap(session)
      val label   = b.labels.head
      val labelId = (label \ "label_id").as[Int]
      val _       = backupLabel(labelId)

      val progress    = Some(missionProgressJson(b, 1))
      val withComment =
        Seq(validationJson(label, b.missionId, "Agree", comment = Some("Ramp is behind the parked car.")))
      status(postValidationTask(session, taskSubmission(b, withComment, progress))) mustBe OK
      commentsOn(labelId, b.userId) mustBe Seq("Ramp is behind the parked car.")

      // Validating the label again without commenting must not take the free text down with the old vote — comments
      // are keyed by (label, user), so nothing could restore it.
      status(
        postValidationTask(session, taskSubmission(b, Seq(validationJson(label, b.missionId, "Disagree")), progress))
      ) mustBe OK
      commentsOn(labelId, b.userId) mustBe Seq("Ramp is behind the parked car.")

      // A repeat that does carry a comment leaves exactly one row, not two stacked ones.
      val newComment = Seq(validationJson(label, b.missionId, "Agree", comment = Some("Looking again, it is fine.")))
      status(postValidationTask(session, taskSubmission(b, newComment, progress))) mustBe OK
      commentsOn(labelId, b.userId) mustBe Seq("Looking again, it is fine.")
    }

    "answer 200 to a duplicate mission-complete submission and still hand back the next mission (#4377)" in {
      val session = freshAnonSession()
      val b       = fetchValidateBootstrap(session)
      val label   = b.labels.head
      val labelId = (label \ "label_id").as[Int]
      val _       = backupLabel(labelId)
      // completed=true is the submission whose response drives the mission transition, so a 500 here is the one that
      // strands the UI until a manual refresh — the case the fix is really for.
      val complete   = missionProgressJson(b, 1) ++ Json.obj("completed" -> true)
      val submission = taskSubmission(b, Seq(validationJson(label, b.missionId, "Agree")), Some(complete))

      val first = postValidationTask(session, submission)
      status(first) mustBe OK
      val retried = postValidationTask(session, submission)
      status(retried) mustBe OK

      // The retry has to carry the same mission-transition payload the lost response did, or the client has nothing
      // to advance on.
      (contentAsJson(retried) \ "has_mission_available").as[Boolean] mustBe
        (contentAsJson(first) \ "has_mission_available").as[Boolean]
      validationCount(labelId, b.userId) mustBe 1
    }
  }

  "POST /labelmap/validate" should {
    "write a validation under an auto-created labelmapValidation mission, and clear it on undo" in {
      // The validate bootstrap is only a source of a real, well-formed label payload here; this endpoint mints its own
      // mission, and the one the bootstrap created is deleted with the rest of the suite's rows in afterAll.
      val session = freshAnonSession()
      val b       = fetchValidateBootstrap(session)
      val label   = b.labels.head
      val labelId = (label \ "label_id").as[Int]
      val before  = backupLabel(labelId)

      val posted = postLabelMapValidation(session, labelMapValidationJson(label, "Agree"))
      status(posted) mustBe OK
      (contentAsJson(posted) \ "status").as[String] mustBe "Success"

      val row = validationRow(labelId, b.userId)
      row mustBe defined
      row.get._1 mustBe "Agree"
      // This endpoint mints (or resumes) its own mission rather than using Validate's.
      val missionType =
        run(sql"SELECT mission_type::text FROM mission WHERE mission_id = ${row.get._2}".as[String]).head
      missionType mustBe "labelmapValidation"
      labelState(labelId).agreeCount mustBe before.agreeCount + 1

      val undone = postLabelMapValidation(session, labelMapValidationJson(label, "Agree", undone = true))
      status(undone) mustBe OK
      validationRow(labelId, b.userId) mustBe None
      labelState(labelId) mustBe before
    }
  }
}
