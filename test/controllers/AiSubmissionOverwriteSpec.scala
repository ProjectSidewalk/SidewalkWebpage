package controllers

import controllers.helper.SubmissionSpecHelpers
import models.user.SidewalkUserTable.aiUserId
import models.utils.MyPostgresProfile.api.given
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsObject, Json}
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.SidewalkSpec

/**
 * Locks the resubmission contract of POST /ai/submitLabelsOnPano (#5382): a pano that already holds live AI labels of
 * the submission's type is refused with a 409 that names the pano and the count, and writes nothing, unless the
 * submission sets `overwrite`, which soft-deletes those labels in the same transaction as the new inserts. The check is
 * per label type, so a model for another type is neither refused by nor wipes them.
 *
 * Unlike [[AiSubmissionSpec]], these payloads carry labels, so the endpoint needs a street in a live region to hang
 * them on (mission, audit task, street edge). The pano is placed at the midpoint of such a street and every label sits
 * near the bottom of the pano, looking almost straight down, which projects to well under a meter from the camera, so
 * each one lands on that street. Cancels on a schema with no region holding a street.
 *
 * The cases walk one pano through first submission, refusal, a second type and replacement, so they run in order. Everything the spec wrote is deleted in `afterAll`, by this pano's id and by row ids above the AI user's
 * maxima recorded before the run.
 */
// GuiceOneAppPerSuite must be rightmost so its run() wraps BeforeAndAfterAll's, keeping the app up for afterAll.
class AiSubmissionOverwriteSpec
    extends SidewalkSpec
    with BeforeAndAfterAll
    with SubmissionSpecHelpers
    with GuiceOneAppPerSuite {

  private val internalApiKey = "test-internal-api-key"
  private val panoId         = "AiSubmissionOverwriteSpec-pano-5382"
  private val panoWidth      = 8192
  private val panoHeight     = 4096

  // `city-id` resolves from this env var, which has no default, so fail loudly rather than boot an unaddressable app.
  private val cityId = sys.env.getOrElse(
    "SIDEWALK_CITY_ID",
    throw IllegalStateException("SIDEWALK_CITY_ID must be set to run AiSubmissionOverwriteSpec")
  )

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure(
        "internal-api-key"                                 -> internalApiKey,
        s"city-params.ai-label-submission-enabled.$cityId" -> true
      )
      .build()

  // The AI user's highest mission and audit task ids before the run, so afterAll removes only what the run created.
  private var maxMissionId: Int   = 0
  private var maxAuditTaskId: Int = 0

  /** A point on a street in a live region, found once; cancels the case when the schema has none. */
  private lazy val streetPoint: Option[(Double, Double)] =
    run(sql"""SELECT ST_Y(ST_LineInterpolatePoint(street_edge.geom, 0.5)),
                     ST_X(ST_LineInterpolatePoint(street_edge.geom, 0.5))
              FROM street_edge
              INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
              INNER JOIN region ON street_edge_region.region_id = region.region_id
              WHERE region.deleted = FALSE AND street_edge.status = 'open'
              ORDER BY street_edge.street_edge_id
              LIMIT 1""".as[(Double, Double)]).headOption

  private def latLng: (Double, Double) =
    streetPoint.getOrElse(cancel("No region holds an open street in the connected schema."))

  /**
   * A submission for the spec's pano.
   * @param labelType      The submission's label type.
   * @param labelCount     How many detections to send, spread across the bottom of the pano.
   * @param overwrite      The `overwrite` flag, or None to omit the key like a payload from before #5382.
   * @param sourceMetadata Stamped on the pano so a test can tell whether the pano upsert ran.
   */
  private def payload(
      labelType: String,
      labelCount: Int,
      overwrite: Option[Boolean],
      sourceMetadata: String = "v1"
  ): JsObject = {
    val (lat, lng) = latLng
    val labels     = (0 until labelCount).map { i =>
      Json.obj("pano_x" -> (panoWidth / 4 + i * 100), "pano_y" -> (panoHeight * 19 / 20), "confidence" -> 0.9)
    }
    val base = Json.obj(
      "label_type"          -> labelType,
      "model_id"            -> "AiSubmissionOverwriteSpec",
      "model_training_date" -> "01-15-2026",
      "api_version"         -> "1.0",
      "labels"              -> labels,
      "pano"                -> Json.obj(
        "pano_id"         -> panoId,
        "source"          -> "gsv",
        "capture_date"    -> "2025-06",
        "width"           -> panoWidth,
        "height"          -> panoHeight,
        "lat"             -> lat,
        "lng"             -> lng,
        "camera_heading"  -> 180.0,
        "links"           -> Json.arr(),
        "history"         -> Json.arr(),
        "source_metadata" -> Json.obj("run" -> sourceMetadata)
      )
    )
    overwrite.fold(base)(flag => base + ("overwrite" -> Json.toJson(flag)))
  }

  private def post(body: JsObject) =
    route(
      app,
      FakeRequest(POST, "/ai/submitLabelsOnPano")
        .withHeaders(AUTHORIZATION -> s"Bearer $internalApiKey")
        .withJsonBody(body)
    ).get

  /** The AI user's label ids of one type on the pano, live ones only unless `includeDeleted`. */
  private def aiLabelIds(labelType: String, includeDeleted: Boolean = false): Seq[Int] =
    run(sql"""SELECT label_id FROM label
              WHERE pano_id = $panoId AND user_id = $aiUserId AND label_type::text = $labelType
                  AND (${includeDeleted} OR deleted = FALSE)
              ORDER BY label_id""".as[Int])

  /** (deleted, deleted_by, deleted_at is set, deleted_source) for each label. */
  private def deletionOf(labelIds: Seq[Int]): Seq[(Boolean, Option[String], Boolean, Option[String])] =
    run(
      sql"""SELECT deleted, deleted_by, deleted_at IS NOT NULL, deleted_source::text
              FROM label WHERE label_id = ANY($labelIds) ORDER BY label_id"""
        .as[(Boolean, Option[String], Boolean, Option[String])]
    )

  private def countOn(table: String, labelIds: Seq[Int]): Int =
    run(sql"SELECT count(*) FROM #$table WHERE label_id = ANY($labelIds)".as[Int].head)

  private def storedRun: Option[String] =
    run(
      sql"SELECT source_metadata ->> 'run' FROM pano_data WHERE pano_id = $panoId".as[Option[String]].headOption
    ).flatten

  private def cleanUp(): Unit = {
    val _ = run(
      sqlu"""DELETE FROM label_ai_info
             WHERE label_id IN (SELECT label_id FROM label WHERE pano_id = $panoId)""" >>
        sqlu"DELETE FROM label_point WHERE label_id IN (SELECT label_id FROM label WHERE pano_id = $panoId)" >>
        sqlu"DELETE FROM label_history WHERE label_id IN (SELECT label_id FROM label WHERE pano_id = $panoId)" >>
        sqlu"DELETE FROM label WHERE pano_id = $panoId" >>
        sqlu"DELETE FROM audit_task WHERE user_id = $aiUserId AND audit_task_id > $maxAuditTaskId" >>
        sqlu"DELETE FROM mission WHERE user_id = $aiUserId AND mission_id > $maxMissionId" >>
        sqlu"DELETE FROM pano_data WHERE pano_id = $panoId"
    )
  }

  override def beforeAll(): Unit = {
    super.beforeAll()
    maxMissionId = run(sql"SELECT COALESCE(max(mission_id), 0) FROM mission WHERE user_id = $aiUserId".as[Int].head)
    maxAuditTaskId = run(
      sql"SELECT COALESCE(max(audit_task_id), 0) FROM audit_task WHERE user_id = $aiUserId".as[Int].head
    )
    cleanUp()
  }

  override def afterAll(): Unit = {
    try {
      cleanUp()
      // The overwrite cases refreshed the AI user's stored accuracy over labels that are now gone.
      val _ = run(app.injector.instanceOf[models.user.UserStatTable].updateAccuracy(Seq(aiUserId)))
    } finally super.afterAll()
  }

  // Set by the first case and read by the later ones, which run in order on the same pano.
  private var firstCurbRamps: Seq[Int] = Seq.empty

  "POST /ai/submitLabelsOnPano on a pano that already has AI labels" should {
    "save every label of a first submission" in {
      status(post(payload("CurbRamp", labelCount = 2, overwrite = None))) mustBe OK
      firstCurbRamps = aiLabelIds("CurbRamp")
      firstCurbRamps must have size 2
      countOn("label_point", firstCurbRamps) mustBe 2
      countOn("label_ai_info", firstCurbRamps) mustBe 2
    }

    "refuse a resubmission without overwrite with a 409 naming the pano and count, and write nothing" in {
      assume(firstCurbRamps.nonEmpty, "the first submission didn't save its labels")
      val resp = post(payload("CurbRamp", labelCount = 2, overwrite = None, sourceMetadata = "v2"))
      status(resp) mustBe CONFLICT
      val body = contentAsJson(resp)
      (body \ "pano_id").as[String] mustBe panoId
      (body \ "label_type").as[String] mustBe "CurbRamp"
      (body \ "existing_label_count").as[Int] mustBe 2
      (body \ "message").as[String] must include(panoId)

      aiLabelIds("CurbRamp", includeDeleted = true) mustBe firstCurbRamps
      // The pano upsert shares the refused transaction, so the resubmitted metadata never landed.
      storedRun mustBe Some("v1")
    }

    "accept a submission of another label type, since the check is per type" in {
      assume(firstCurbRamps.nonEmpty, "the first submission didn't save its labels")
      status(post(payload("Crosswalk", labelCount = 1, overwrite = None))) mustBe OK
      aiLabelIds("Crosswalk") must have size 1
      aiLabelIds("CurbRamp") mustBe firstCurbRamps
    }

    "replace the type's labels with overwrite, soft-deleting the old ones and leaving other types alone" in {
      assume(firstCurbRamps.nonEmpty, "the first submission didn't save its labels")
      val crosswalks = aiLabelIds("Crosswalk")
      status(post(payload("CurbRamp", labelCount = 1, overwrite = Some(true), sourceMetadata = "v3"))) mustBe OK

      val live = aiLabelIds("CurbRamp")
      live must have size 1
      live.head must be > firstCurbRamps.max
      deletionOf(firstCurbRamps) mustBe Seq.fill(2)((true, Some(aiUserId), true, Some("SidewalkAI")))
      // Soft delete only: the retired labels keep their provenance and point.
      countOn("label_ai_info", firstCurbRamps) mustBe 2
      countOn("label_point", firstCurbRamps) mustBe 2
      aiLabelIds("Crosswalk") mustBe crosswalks
      storedRun mustBe Some("v3")
    }
  }
}
