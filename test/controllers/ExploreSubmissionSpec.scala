package controllers

import controllers.helper.SubmissionSpecHelpers
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
 * Functional tests for the Explore submission endpoint (`POST /task`) — the write path that turns a labeling session
 * into `audit_task` / `label` / `label_point` rows (#4777). Boots the real app against Postgres and follows the real
 * client bootstrap: GET /explore embeds the assigned mission and task as inline page JS (`mainParam.*`), and the spec
 * submits payloads shaped like the frontend's compiled submission data.
 *
 * A fresh anonymous user deterministically starts on the audit tutorial, so the tutorial-mission submission needs no
 * particular seed data beyond a servable /explore page; the post-tutorial test completes the tutorial mission over
 * HTTP to reach a real audit mission.
 *
 * Everything the suite writes is keyed to the throwaway anon users it mints and is deleted in `afterAll`, along with
 * the fake pano rows and the street priority the completed-task case moves — so a failed assertion can't leave the
 * shared dev DB altered. Tests cancel when the connected schema carries no street data (the empty CI city); a
 * /explore that answers anything but 200 on a seeded schema is a bug and fails.
 */
// Mixin order matters: GuiceOneAppPerSuite must be rightmost so its run() wraps BeforeAndAfterAll's — otherwise
// afterAll's cleanup executes after the app (and its DB pool) has shut down and aborts the suite.
class ExploreSubmissionSpec
    extends PlaySpec
    with BeforeAndAfterAll
    with Eventually
    with SubmissionSpecHelpers
    with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // Submitting eligible labels fires an async AI-validation HTTP call; keep the spec off the network.
      .configure("ai-enabled" -> false)
      // Several anon sessions per run share one loopback IP, so the 100/hr signup cap would 429 across repeat runs
      // and break session minting rather than anything under test.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  // A fixed fake pano id so repeat runs update the same pano_data row instead of accumulating junk rows.
  private val specPanoId: String = "ExploreSubmissionSpec-pano"

  /** Users minted by this suite; everything written under them is deleted in `afterAll`. */
  private var createdUserIds: Set[String] = Set.empty

  /** Pre-test `street_edge_priority.priority` for each street the suite audited, restored in `afterAll`. */
  private var priorityBackup: Map[Int, Double] = Map.empty

  /** Pre-test `region_completion.audited_distance` for each region touched, restored in `afterAll`. */
  private var auditedDistanceBackup: Map[Int, Double] = Map.empty

  /** The dev-DB dumps omit the interaction logs, so their assertions are skipped where the table isn't there. */
  private lazy val interactionsLogged: Boolean = tableExists("audit_task_interaction")

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
      startPointReversed: Boolean,
      auditTaskId: Option[Int]
  )

  /**
   * Loads /explore for the session and pulls the assigned mission/task out of the page's bootstrap script.
   *
   * @param session Cookies from an anonymous session.
   * @return        The mission/task the server assigned, in the shape a submission payload is built from.
   */
  private def fetchExploreBootstrap(session: Seq[Cookie]): ExploreBootstrap = {
    val streetCount = run(sql"SELECT count(*) FROM street_edge".as[Int]).head
    if (streetCount == 0) cancel("No streets in the connected schema; /explore can't assign a task.")

    val resp = route(app, FakeRequest(GET, "/explore").withCookies(session: _*)).get
    status(resp) mustBe OK
    val html = contentAsString(resp)
    val task = embeddedPageJson(html, "mainParam.task")
      .getOrElse(cancel("No task in the explore bootstrap (the user's assigned region is fully audited)."))
    val mission = embeddedPageJson(html, "mainParam.mission")
      .getOrElse(fail("No mission in the explore bootstrap."))
    val regionId = embeddedPageJson(html, "mainParam.regionId")
      .map(_.as[Int])
      .getOrElse(fail("No regionId in the explore bootstrap."))
    val missionId = (mission \ "mission_id").as[Int]
    // The assigned mission row carries the session user's id, so it resolves the anon user for row assertions.
    val userId = run(sql"SELECT user_id FROM mission WHERE mission_id = $missionId".as[String]).head
    createdUserIds += userId
    val props = (task \ "properties").as[JsObject]
    ExploreBootstrap(
      userId,
      regionId,
      missionId,
      (mission \ "mission_type").as[String],
      (props \ "street_edge_id").as[Int],
      (props \ "current_lat").as[Double],
      (props \ "current_lng").as[Double],
      (props \ "task_start").as[String],
      (props \ "start_point_reversed").as[Boolean],
      // Echoed back on submission exactly as the client does. A task the user already started carries the id of its
      // existing audit_task row, and sending it is what routes the write to the update path instead of a second insert.
      (props \ "audit_task_id").asOpt[Int]
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

  /**
   * A full `POST /task` payload mirroring the frontend's compiled submission data.
   *
   * @param b                The bootstrap the payload describes.
   * @param labels           Labels to submit with this task.
   * @param auditTaskId      The task's server-side id; defaults to whatever the bootstrap handed out, as the client
   *                         echoes it. Pass explicitly to continue a task whose id was learned from a response.
   * @param taskCompleted    Whether the user finished walking the street. Only a completed Audit task moves the
   *                         street's priority and flips `audit_task.completed`.
   * @param missionCompleted Whether the mission is finished, which is what makes the server hand out the next one.
   * @param missionSkipped   Whether the mission was skipped rather than worked through.
   */
  private def submission(
      b: ExploreBootstrap,
      labels: Seq[JsObject] = Seq.empty,
      auditTaskId: Option[Int] = None,
      taskCompleted: Boolean = false,
      missionCompleted: Boolean = false,
      missionSkipped: Boolean = false
  ): JsObject = {
    val now                      = OffsetDateTime.now
    val effectiveTaskId          = auditTaskId.orElse(b.auditTaskId)
    val auditTaskIdJson: JsValue = effectiveTaskId.map(id => JsNumber(BigDecimal(id))).getOrElse(JsNull)
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
        "completed"                       -> taskCompleted,
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

  /** Posts a submission over HTTP as the session's user, the way the frontend does. */
  private def postTask(session: Seq[Cookie], payload: JsValue) =
    route(app, FakeRequest(POST, "/task").withCookies(session: _*).withJsonBody(payload).withCSRFToken).get

  /** The `label` columns the assertions read. Field order must track the SELECT in [[labelRows]]. */
  private case class LabelRow(
      labelId: Int,
      auditTaskId: Int,
      missionId: Int,
      deleted: Boolean,
      tutorial: Boolean,
      severity: Option[Int]
  )

  /**
   * Reads the label rows a submission wrote, keyed the way the endpoint keys them.
   *
   * The column order here is a contract with [[LabelRow]]'s field order — a reordered SELECT would silently bind the
   * wrong values rather than fail to compile.
   *
   * @param userId      The submitting user.
   * @param tempLabelId The client-side temporary id, which is what identifies a label across resubmissions.
   * @return            Every matching row; the endpoint's contract is that there is at most one.
   */
  private def labelRows(userId: String, tempLabelId: Int): Seq[LabelRow] =
    run(
      sql"""SELECT label_id, audit_task_id, mission_id, deleted, tutorial, severity
            FROM label WHERE user_id = $userId AND temporary_label_id = $tempLabelId"""
        .as[(Int, Int, Int, Boolean, Boolean, Option[Int])]
    ).map((LabelRow.apply _).tupled)

  /** The street's current priority, or None when it has no `street_edge_priority` row. */
  private def streetPriority(streetEdgeId: Int): Option[Double] =
    run(sql"SELECT priority FROM street_edge_priority WHERE street_edge_id = $streetEdgeId".as[Double]).headOption

  /** The region's current audited distance, or None when it has no `region_completion` row. */
  private def auditedDistance(regionId: Int): Option[Double] =
    run(sql"SELECT audited_distance FROM region_completion WHERE region_id = $regionId".as[Double]).headOption

  /**
   * Snapshots the shared rows a completed task moves, so `afterAll` can put them back.
   *
   * Completing a task is the one thing this suite does that isn't confined to its own throwaway user: it lowers the
   * street's priority and, when that crosses 1.0, adds the street's length to the region's audited distance.
   */
  private def backupSharedRows(streetEdgeId: Int, regionId: Int): Unit = {
    streetPriority(streetEdgeId).foreach(p => priorityBackup += (streetEdgeId -> p))
    auditedDistance(regionId).foreach(d => auditedDistanceBackup += (regionId -> d))
  }

  /**
   * Removes everything the suite's submissions wrote under its throwaway anon users (the bare user rows stay).
   *
   * Order follows the foreign keys, and the mission's `current_audit_task_id` is cleared first: a mission points back
   * at the task the user is on, so deleting audit_task before breaking that reference violates the constraint.
   */
  private def deleteSubmittedData(): Unit = createdUserIds.foreach { uId =>
    val _ = run(
      DBIO.seq(
        sqlu"UPDATE mission SET current_audit_task_id = NULL WHERE user_id = $uId",
        sqlu"DELETE FROM label_history WHERE label_id IN (SELECT label_id FROM label WHERE user_id = $uId)",
        sqlu"DELETE FROM label_point WHERE label_id IN (SELECT label_id FROM label WHERE user_id = $uId)",
        sqlu"DELETE FROM label WHERE user_id = $uId",
        sqlu"""DELETE FROM audit_task_comment
               WHERE audit_task_id IN (SELECT audit_task_id FROM audit_task WHERE user_id = $uId)""",
        sqlu"""DELETE FROM audit_task_environment
               WHERE audit_task_id IN (SELECT audit_task_id FROM audit_task WHERE user_id = $uId)""",
        sqlu"""DELETE FROM audit_task_interaction
               WHERE audit_task_id IN (SELECT audit_task_id FROM audit_task WHERE user_id = $uId)""",
        sqlu"""DELETE FROM audit_task_interaction_small
               WHERE audit_task_id IN (SELECT audit_task_id FROM audit_task WHERE user_id = $uId)""",
        sqlu"""DELETE FROM audit_task_user_route
               WHERE audit_task_id IN (SELECT audit_task_id FROM audit_task WHERE user_id = $uId)""",
        sqlu"DELETE FROM audit_task WHERE user_id = $uId",
        sqlu"DELETE FROM mission WHERE user_id = $uId"
      )
    )
  }

  /**
   * Drops the fake pano the submissions carried.
   *
   * Must run after [[deleteSubmittedData]], which removes the labels placed on it — the pano is only unreferenced once
   * they are gone. Left behind, the row keeps feeding the imagery-freshness and scraper-monitoring surfaces with a
   * pano no imagery provider knows.
   */
  private def deleteSpecPano(): Unit = {
    val _ = run(
      DBIO.seq(
        sqlu"DELETE FROM pano_link WHERE pano_id = $specPanoId OR target_pano_id = $specPanoId",
        sqlu"DELETE FROM pano_history WHERE pano_id = $specPanoId OR location_curr_pano_id = $specPanoId",
        sqlu"DELETE FROM pano_data WHERE pano_id = $specPanoId"
      )
    )
  }

  /** Puts back the street priority and region audited distance that completing a task moved. */
  private def restoreSharedRows(): Unit = {
    priorityBackup.foreach { case (streetEdgeId, priority) =>
      val _ = run(sqlu"UPDATE street_edge_priority SET priority = $priority WHERE street_edge_id = $streetEdgeId")
    }
    auditedDistanceBackup.foreach { case (regionId, distance) =>
      val _ = run(sqlu"UPDATE region_completion SET audited_distance = $distance WHERE region_id = $regionId")
    }
  }

  // A dead earlier run may have left a pano row behind; clear it so the "exactly one row" assertion means something.
  override def beforeAll(): Unit = { super.beforeAll(); deleteSpecPano() }

  override def afterAll(): Unit = {
    try { deleteSubmittedData(); deleteSpecPano(); restoreSharedRows() }
    finally super.afterAll()
  }

  "POST /task" should {
    "401 an unauthenticated submission" in {
      // Sec-Fetch-Mode pins the fetch/XHR arm of ControllerUtils.anonSignupRedirect — what the real client hits;
      // RouteAuthPostureSpec covers the navigation arm.
      val resp = route(
        app,
        FakeRequest(POST, "/task").withHeaders("Sec-Fetch-Mode" -> "cors").withJsonBody(Json.obj()).withCSRFToken
      ).get
      status(resp) mustBe UNAUTHORIZED
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
      val auditTask = run(
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

      val point = run(
        sql"SELECT pano_x, canvas_x, lat, lng FROM label_point WHERE label_id = $labelId"
          .as[(Int, Int, Option[Double], Option[Double])]
      ).headOption
      point mustBe defined
      (point.get._1, point.get._2) mustBe ((8000, 360))
      point.get._3 mustBe defined
      point.get._4 mustBe defined

      // The async writes that ride the same submission: environment and pano metadata.
      eventually(timeout(Span(15, Seconds)), interval(Span(250, Millis))) {
        run(sql"SELECT count(*) FROM audit_task_environment WHERE audit_task_id = $auditTaskId".as[Int]).head mustBe 1
        run(sql"SELECT count(*) FROM pano_data WHERE pano_id = $specPanoId".as[Int]).head mustBe 1
      }
      if (interactionsLogged) {
        eventually(timeout(Span(15, Seconds)), interval(Span(250, Millis))) {
          run(sql"SELECT count(*) FROM audit_task_interaction WHERE audit_task_id = $auditTaskId".as[Int]).head mustBe 2
        }
      } else {
        info("audit_task_interaction is absent from this schema, so its assertion is skipped.")
      }

      // Re-submitting the same temporary label with deleted=true takes the update path (the client's label-delete
      // flow): the deleted flag flips in place, and no new label_id is minted or echoed.
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

      backupSharedRows(b2.streetEdgeId, b2.regionId)
      val priorityBefore = streetPriority(b2.streetEdgeId)
      val tempId         = 777002

      val posted = postTask(session, submission(b2, Seq(labelJson(tempId, b2, tutorial = false))))
      status(posted) mustBe OK
      val auditTaskId = (contentAsJson(posted) \ "audit_task_id").as[Int]

      val rows = labelRows(b2.userId, tempId)
      rows must have size 1
      rows.head.tutorial mustBe false
      rows.head.deleted mustBe false

      // An incomplete task leaves the street's priority untouched.
      streetPriority(b2.streetEdgeId) mustBe priorityBefore

      // Finishing the street is what moves it: a high-quality audit divides the priority down (1/(1 + 1/p)), and the
      // task is marked completed. Asserting both sides is what makes the "incomplete leaves it alone" check above
      // mean something — without it, a `updateStreetPriority` that never ran would satisfy the pair.
      val finished = postTask(
        session,
        submission(b2, auditTaskId = Some(auditTaskId), taskCompleted = true)
      )
      status(finished) mustBe OK
      val priorityAfter = streetPriority(b2.streetEdgeId)
      priorityAfter mustBe defined
      priorityBefore.foreach(before => priorityAfter.get must be < before)
      run(
        sql"SELECT completed FROM audit_task WHERE audit_task_id = $auditTaskId".as[Boolean]
      ).head mustBe true
    }
  }
}
