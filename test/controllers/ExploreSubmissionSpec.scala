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
 * Functional tests for the Explore submission endpoint (`POST /task`) — the write path that turns a labeling session
 * into `audit_task` / `label` / `label_point` rows (#4777). Boots the real app against Postgres and follows the real
 * client bootstrap: GET /explore embeds the assigned mission and task as inline page JS (`mainParam.*`), and the spec
 * submits payloads shaped like the frontend's compiled submission data.
 *
 * A fresh anonymous user deterministically starts on the audit tutorial, so the tutorial-mission submission needs no
 * particular seed data beyond a servable /explore page; the post-tutorial test completes the tutorial mission over
 * HTTP to reach a real audit mission. Every label created here is flipped to `deleted` through a follow-up submission
 * (the client's own label-delete flow), so repeated runs leave no live labels in a shared dev DB. Tests cancel (not
 * fail) when the connected DB can't serve an explore session at all.
 */
class ExploreSubmissionSpec extends PlaySpec with GuiceOneAppPerSuite with SubmissionSpecHelpers with Eventually {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // Submitting eligible labels fires an async AI-validation HTTP call; keep the spec off the network.
      .configure("ai-enabled" -> false)
      .build()

  // A fixed fake pano id so repeat runs update the same pano_data row instead of accumulating junk rows.
  private val specPanoId: String = "ExploreSubmissionSpec-pano"

  /** The explore-page values a submission payload is built from, as the real client reads them. */
  private case class ExploreBootstrap(
      userId: String,
      regionId: Int,
      missionId: Int,
      missionType: String,
      streetEdgeId: Int,
      currentLat: Double,
      currentLng: Double,
      taskStart: String,
      startPointReversed: Boolean
  )

  /** Loads /explore for the session and pulls the assigned mission/task out of the page's bootstrap script. */
  private def fetchExploreBootstrap(session: Seq[Cookie]): ExploreBootstrap = {
    val resp = route(app, FakeRequest(GET, "/explore").withCookies(session: _*)).get
    if (status(resp) != OK) {
      cancel(s"/explore responded ${status(resp)}; the connected DB can't serve an explore session.")
    }
    val html = contentAsString(resp)
    val task = embeddedPageJson(html, "mainParam.task")
      .getOrElse(cancel("No task in the explore bootstrap (the user's assigned region is fully audited)."))
    val mission = embeddedPageJson(html, "mainParam.mission")
      .getOrElse(fail("No mission in the explore bootstrap."))
    val userId = "userId: '([0-9a-f-]+)'".r
      .findFirstMatchIn(html)
      .map(_.group(1))
      .getOrElse(fail("No userId in the explore bootstrap."))
    val regionId = embeddedPageJson(html, "mainParam.regionId")
      .map(_.as[Int])
      .getOrElse(fail("No regionId in the explore bootstrap."))
    val props = (task \ "properties").as[JsObject]
    ExploreBootstrap(
      userId,
      regionId,
      (mission \ "mission_id").as[Int],
      (mission \ "mission_type").as[String],
      (props \ "street_edge_id").as[Int],
      (props \ "current_lat").as[Double],
      (props \ "current_lng").as[Double],
      (props \ "task_start").as[String],
      (props \ "start_point_reversed").as[Boolean]
    )
  }

  /** A label submission as the Explore frontend compiles one, placed at the task's current position. */
  private def labelJson(
      tempId: Int,
      b: ExploreBootstrap,
      tutorial: Boolean,
      deleted: Boolean = false,
      severity: Int = 1
  ): JsObject =
    Json.obj(
      "pano_id"     -> specPanoId,
      "pano_source" -> "gsv",
      "label_type"  -> "CurbRamp",
      "deleted"     -> deleted,
      "severity"    -> severity,
      "description" -> JsNull,
      "tag_ids"     -> Json.arr(),
      "label_point" -> Json.obj(
        "pano_x"             -> 8000,
        "pano_y"             -> 4000,
        "canvas_x"           -> 360,
        "canvas_y"           -> 240,
        "heading"            -> 100.5,
        "pitch"              -> -10.0,
        "zoom"               -> 1,
        "lat"                -> b.currentLat,
        "lng"                -> b.currentLng,
        "computation_method" -> "depth"
      ),
      "temporary_label_id" -> tempId,
      "time_created"       -> OffsetDateTime.now,
      "tutorial"           -> tutorial
    )

  /** A full `POST /task` payload mirroring the frontend's compiled submission data. */
  private def submission(
      b: ExploreBootstrap,
      labels: Seq[JsObject] = Seq.empty,
      auditTaskId: Option[Int] = None,
      missionCompleted: Boolean = false,
      missionSkipped: Boolean = false
  ): JsObject = {
    val now                      = OffsetDateTime.now
    val auditTaskIdJson: JsValue = auditTaskId.map(id => JsNumber(BigDecimal(id))).getOrElse(JsNull)
    Json.obj(
      "mission" -> Json.obj(
        "mission_id"        -> b.missionId,
        "distance_progress" -> 0.0,
        "region_id"         -> b.regionId,
        "completed"         -> missionCompleted,
        "audit_task_id"     -> auditTaskIdJson,
        "skipped"           -> missionSkipped
      ),
      "audit_task" -> Json.obj(
        "street_edge_id"                  -> b.streetEdgeId,
        "task_start"                      -> b.taskStart,
        "audit_task_id"                   -> auditTaskIdJson,
        "completed"                       -> false,
        "current_lat"                     -> b.currentLat,
        "current_lng"                     -> b.currentLng,
        "start_point_reversed"            -> b.startPointReversed,
        "current_mission_start"           -> JsNull,
        "last_priority_update_time"       -> now,
        "request_updated_street_priority" -> false,
        "audited_distance_m"              -> 0.0,
        "route_street_id"                 -> JsNull
      ),
      "labels"       -> labels,
      "interactions" -> Json.arr(
        Json.obj("action" -> "TaskStart", "pano_id"                     -> specPanoId, "timestamp" -> now),
        Json.obj("action" -> "LabelingCanvas_FinishLabeling", "pano_id" -> specPanoId, "timestamp" -> now)
      ),
      "environment" -> Json.obj("browser" -> "spec", "language" -> "en", "css_zoom" -> 100),
      "panos"       -> Json.arr(
        Json.obj(
          "pano_id"        -> specPanoId,
          "source"         -> "gsv",
          "capture_date"   -> "2024-01",
          "width"          -> 16384,
          "height"         -> 8192,
          "tile_width"     -> 512,
          "tile_height"    -> 512,
          "lat"            -> b.currentLat,
          "lng"            -> b.currentLng,
          "camera_heading" -> 180.0,
          "camera_pitch"   -> 0.5,
          "links"          -> Json.arr(),
          "history"        -> Json.arr()
        )
      ),
      "user_route_id" -> JsNull,
      "timestamp"     -> now
    )
  }

  private def postTask(session: Seq[Cookie], payload: JsValue) =
    route(app, FakeRequest(POST, "/task").withCookies(session: _*).withJsonBody(payload).withCSRFToken).get

  private case class LabelRow(
      labelId: Int,
      auditTaskId: Int,
      missionId: Int,
      deleted: Boolean,
      tutorial: Boolean,
      severity: Option[Int]
  )

  private def labelRows(userId: String, tempLabelId: Int): Seq[LabelRow] =
    runDb(
      sql"""SELECT label_id, audit_task_id, mission_id, deleted, tutorial, severity
            FROM label WHERE user_id = $userId AND temporary_label_id = $tempLabelId"""
        .as[(Int, Int, Int, Boolean, Boolean, Option[Int])]
    ).map((LabelRow.apply _).tupled)

  private def streetPriority(streetEdgeId: Int): Option[Double] =
    runDb(
      sql"SELECT priority FROM street_edge_priority WHERE street_edge_id = $streetEdgeId".as[Double]
    ).headOption

  "POST /task" should {
    "reject an unauthenticated submission" in {
      val resp = route(app, FakeRequest(POST, "/task").withJsonBody(Json.obj()).withCSRFToken).get
      status(resp) must not be OK
    }

    "400 a payload that doesn't match the submission contract" in {
      val session = freshAnonSession()
      val resp    = postTask(session, Json.obj("mission" -> "bogus"))
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "status").as[String] mustBe "Error"
    }

    "write audit_task, label, and label_point rows and echo the temp-to-permanent label id mapping" in {
      val session  = freshAnonSession()
      val b        = fetchExploreBootstrap(session)
      val tutorial = b.missionType == "auditOnboarding"
      val tempId   = 777001

      val posted = postTask(session, submission(b, labels = Seq(labelJson(tempId, b, tutorial))))
      status(posted) mustBe OK
      val json        = contentAsJson(posted)
      val auditTaskId = (json \ "audit_task_id").as[Int]
      (json \ "street_edge_id").as[Int] mustBe b.streetEdgeId
      (json \ "refresh_page").as[Boolean] mustBe false
      val labelIds = (json \ "label_ids").as[Seq[JsObject]]
      labelIds must have size 1
      (labelIds.head \ "temporary_label_id").as[Int] mustBe tempId
      val labelId = (labelIds.head \ "label_id").as[Int]

      // The synchronous writes: audit_task, label, and label_point.
      val auditTask = runDb(
        sql"SELECT street_edge_id, user_id, completed FROM audit_task WHERE audit_task_id = $auditTaskId"
          .as[(Int, String, Boolean)]
      ).headOption
      auditTask mustBe Some((b.streetEdgeId, b.userId, false))

      val labels = labelRows(b.userId, tempId)
      labels must have size 1
      labels.head.labelId mustBe labelId
      labels.head.auditTaskId mustBe auditTaskId
      labels.head.missionId mustBe b.missionId
      labels.head.deleted mustBe false
      labels.head.tutorial mustBe tutorial
      labels.head.severity mustBe Some(1)

      val point = runDb(
        sql"SELECT pano_x, canvas_x, lat, lng FROM label_point WHERE label_id = $labelId"
          .as[(Int, Int, Option[Double], Option[Double])]
      ).headOption
      point mustBe defined
      (point.get._1, point.get._2) mustBe ((8000, 360))
      point.get._3 mustBe defined
      point.get._4 mustBe defined

      // The async writes that ride the same submission: environment, interactions, and pano metadata.
      eventually(timeout(Span(15, Seconds))) {
        runDb(sql"SELECT count(*) FROM audit_task_environment WHERE audit_task_id = $auditTaskId".as[Int]).head mustBe 1
        runDb(sql"SELECT count(*) FROM audit_task_interaction WHERE audit_task_id = $auditTaskId".as[Int]).head mustBe 2
        runDb(sql"SELECT count(*) FROM pano_data WHERE pano_id = $specPanoId".as[Int]).head mustBe 1
      }

      // Re-submitting the same temporary label with deleted=true takes the update path (the client's label-delete
      // flow): the deleted flag flips in place, and no new label_id is minted or echoed. Also this spec's cleanup.
      val deleted = postTask(
        session,
        submission(b, Seq(labelJson(tempId, b, tutorial, deleted = true)), auditTaskId = Some(auditTaskId))
      )
      status(deleted) mustBe OK
      (contentAsJson(deleted) \ "label_ids").as[Seq[JsValue]] mustBe empty
      val after = labelRows(b.userId, tempId)
      after must have size 1
      after.head.deleted mustBe true
    }

    "complete the tutorial mission, hand out an audit mission, and accept a non-tutorial submission under it" in {
      val session = freshAnonSession()
      val b       = fetchExploreBootstrap(session)
      if (b.missionType != "auditOnboarding") cancel(s"Fresh user unexpectedly on mission type '${b.missionType}'.")

      // Completing (here: skipping) the tutorial mission must return the user's first real audit mission.
      val completed = postTask(session, submission(b, missionCompleted = true, missionSkipped = true))
      status(completed) mustBe OK
      val nextMission = (contentAsJson(completed) \ "mission").as[JsObject]
      (nextMission \ "mission_type").as[String] mustBe "audit"

      // The next page load serves that audit mission with a real street task.
      val b2 = fetchExploreBootstrap(session)
      b2.missionType mustBe "audit"

      val priorityBefore = streetPriority(b2.streetEdgeId)
      val tempId         = 777002

      val posted = postTask(session, submission(b2, Seq(labelJson(tempId, b2, tutorial = false))))
      status(posted) mustBe OK
      val auditTaskId = (contentAsJson(posted) \ "audit_task_id").as[Int]

      val rows = labelRows(b2.userId, tempId)
      rows must have size 1
      rows.head.tutorial mustBe false
      rows.head.deleted mustBe false

      // An incomplete task must leave the street's priority untouched — that only moves on task completion.
      streetPriority(b2.streetEdgeId) mustBe priorityBefore

      // Cleanup: flip the label to deleted through the same endpoint.
      val cleanup = postTask(
        session,
        submission(b2, Seq(labelJson(tempId, b2, tutorial = false, deleted = true)), auditTaskId = Some(auditTaskId))
      )
      status(cleanup) mustBe OK
      labelRows(b2.userId, tempId).head.deleted mustBe true
    }
  }
}
