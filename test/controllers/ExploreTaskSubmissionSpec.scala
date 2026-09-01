package controllers

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatest.concurrent.Eventually
import org.scalatest.time.{Millis, Seconds, Span}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsArray, JsNull, JsObject, Json}
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

import java.time.OffsetDateTime
import java.util.UUID
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Locks the pano/label contract of POST /task (#4587). A pano's metadata is integral to its labels: each label
 * carries a `pano` block, and the server commits the pano_data row and the label atomically in one transaction, so a
 * label can never be saved without its pano row — and a label whose pano block fails to write fails the whole
 * submission rather than quietly producing an orphan. The separate `panos` batch only tracks panos *viewed* during
 * the session, so it keeps the opposite, lenient semantics: a failure there is logged and costs neither the labels
 * nor the rest of the batch. Specifically:
 *   - a label's pano block alone (no `panos` batch) produces the pano_data, pano_link, and pano_history rows;
 *   - a label whose pano block fails to write (here: a lat outside pano_data's CHECK constraint) fails the whole
 *     submission, saving neither the label nor the pano;
 *   - a label whose pano block describes a *different* pano is refused outright at validation;
 *   - a label carrying no block at all (the tutorial shape) attaches to the pano_data row already there and leaves
 *     it untouched, and is refused whole when there is no such row;
 *   - a failing *viewed* pano costs nothing else in the submission (the viewed batch is written off the request's
 *     critical path, so those assertions poll);
 *   - resubmitting a pano refreshes its metadata without clearing anything: position fields take the newest value,
 *     absent fields leave existing values alone, NULL intrinsics (e.g. width) get filled in, and re-sent links and
 *     history entries don't duplicate (also the race-safety guarantee — concurrent duplicate submissions must not
 *     error, and ON CONFLICT is what makes both hold).
 *
 * Boots the real application against Postgres+PostGIS and drives the endpoint over HTTP through Silhouette's
 * anonymous session, like ImageControllerSpec. The submission needs a real mission row for the signed-in user, so the
 * suite mints one anon session, finds its user_id via the AnonAutoSignUp activity log (tagged with a unique marker),
 * and inserts one audit mission for it directly; everything written under that user is deleted in afterAll.
 */
// Mixin order matters: GuiceOneAppPerSuite must be rightmost so its run() wraps BeforeAndAfterAll's — otherwise
// afterAll's cleanup executes after the app (and its DB pool) has shut down and aborts the suite.
class ExploreTaskSubmissionSpec extends PlaySpec with BeforeAndAfterAll with Eventually with GuiceOneAppPerSuite {

  // Every pano this suite creates carries this prefix, so cleanup can't touch real panos.
  private val panoPrefix = "ExploreTaskSubmissionSpec-4587"

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .configure("ai-enabled" -> false) // Label submission fires AI validation calls; keep the suite offline.
      .build()

  private lazy val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  /** Runs a DBIO synchronously; for arrange/assert queries only, never the code under test. */
  private def runDb[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 30.seconds)

  // One anon session + mission fixture shared by the whole suite, minted on first use. The var mirrors of the lazy
  // vals let afterAll clean up without forcing fixture creation when a run dies before any test used them.
  private var mintedUserId: Option[String] = None

  private lazy val (sessionCookies: Seq[Cookie], userId: String) = {
    val marker = UUID.randomUUID().toString
    val resp   = route(app, FakeRequest(GET, s"/anonSignUp?url=%2F%3Fspec%3D$marker")).get
    status(resp) mustBe SEE_OTHER
    // The signup's activity-log write is async; poll for the marker to learn the fresh user's id.
    val id = eventually(timeout(Span(10, Seconds)), interval(Span(200, Millis))) {
      val ids = runDb(sql"SELECT user_id FROM webpage_activity WHERE activity LIKE ${s"%spec=$marker%"}".as[String])
      ids must have size 1
      ids.head
    }
    mintedUserId = Some(id)
    (cookies(resp).toSeq, id)
  }

  private lazy val (streetEdgeId: Int, regionId: Int) = runDb(
    sql"""SELECT street_edge_region.street_edge_id, street_edge_region.region_id
          FROM street_edge_region
          JOIN region ON street_edge_region.region_id = region.region_id
          WHERE region.deleted = false
          LIMIT 1""".as[(Int, Int)].head
  )

  private lazy val missionId: Int = runDb(
    sql"""INSERT INTO mission (mission_type, user_id, completed, pay, paid, distance_meters, distance_progress,
                               skipped, region_id)
          VALUES ('audit', $userId, false, 0.0, false, 500.0, 0.0, false, $regionId)
          RETURNING mission_id""".as[Int].head
  )

  private def deleteTestPanos(): Unit = {
    val prefixPattern = s"$panoPrefix%"
    val _             = runDb(
      DBIO.seq(
        // Labels first: label.pano_id is an FK to pano_data (evolution 360), so a label a dead run left behind would
        // block the pano delete. Scoped to this suite's pano prefix, so it can't reach a real label.
        sqlu"""DELETE FROM label_history
               WHERE label_id IN (SELECT label_id FROM label WHERE pano_id LIKE $prefixPattern)""",
        sqlu"""DELETE FROM label_point
               WHERE label_id IN (SELECT label_id FROM label WHERE pano_id LIKE $prefixPattern)""",
        sqlu"DELETE FROM label WHERE pano_id LIKE $prefixPattern",
        sqlu"DELETE FROM pano_link WHERE pano_id LIKE $prefixPattern",
        sqlu"DELETE FROM pano_history WHERE location_curr_pano_id LIKE $prefixPattern",
        sqlu"DELETE FROM pano_data WHERE pano_id LIKE $prefixPattern"
      )
    )
  }

  /** Removes everything the suite's submissions wrote under its throwaway anon user (the bare user row stays). */
  private def deleteTestSubmissionData(): Unit = mintedUserId.foreach { uId =>
    val _ = runDb(
      DBIO.seq(
        sqlu"""DELETE FROM label_history
               WHERE label_id IN (SELECT label_id FROM label WHERE user_id = $uId)""",
        sqlu"""DELETE FROM label_point
               WHERE label_id IN (SELECT label_id FROM label WHERE user_id = $uId)""",
        sqlu"DELETE FROM label WHERE user_id = $uId",
        sqlu"""DELETE FROM audit_task_environment
               WHERE audit_task_id IN (SELECT audit_task_id FROM audit_task WHERE user_id = $uId)""",
        sqlu"""DELETE FROM audit_task_interaction
               WHERE audit_task_id IN (SELECT audit_task_id FROM audit_task WHERE user_id = $uId)""",
        sqlu"DELETE FROM audit_task WHERE user_id = $uId",
        sqlu"DELETE FROM mission WHERE user_id = $uId"
      )
    )
  }

  override def beforeAll(): Unit = { super.beforeAll(); deleteTestPanos() } // A dead earlier run may have left rows.
  override def afterAll(): Unit  = {
    try { deleteTestSubmissionData(); deleteTestPanos() }
    finally super.afterAll()
  }

  private def label(panoId: String, tempLabelId: Int, pano: Option[JsObject] = None): JsObject = {
    val base = Json.obj(
      "pano_id"            -> panoId,
      "pano_source"        -> "gsv",
      "label_type"         -> "CurbRamp",
      "deleted"            -> false,
      "severity"           -> JsNull,
      "description"        -> JsNull,
      "tag_ids"            -> Json.arr(),
      "temporary_label_id" -> tempLabelId,
      "time_created"       -> OffsetDateTime.now.toString,
      "tutorial"           -> false,
      // No lat/lng: the label then attaches to the audit task's street, so the spec needs no spatial fixtures.
      "label_point" -> Json.obj(
        "pano_x"   -> 100,
        "pano_y"   -> 100,
        "canvas_x" -> 200,
        "canvas_y" -> 200,
        "heading"  -> 90.0,
        "pitch"    -> 0.0,
        "zoom"     -> 1.0,
        "lat"      -> JsNull,
        "lng"      -> JsNull
      )
    )
    pano.fold(base)(p => base + ("pano" -> p))
  }

  private def pano(
      panoId: String,
      lat: Option[Double] = Some(41.87),
      lng: Option[Double] = Some(-87.62),
      width: Option[Int] = Some(8192),
      address: Option[String] = None,
      links: Seq[JsObject] = Seq.empty,
      history: Seq[JsObject] = Seq.empty
  ): JsObject = Json.obj(
    "pano_id"        -> panoId,
    "source"         -> "gsv",
    "capture_date"   -> "2024-06",
    "width"          -> width,
    "height"         -> width.map(_ / 2),
    "lat"            -> lat,
    "lng"            -> lng,
    "camera_heading" -> 180.0,
    "links"          -> JsArray(links),
    "address"        -> address,
    "history"        -> JsArray(history)
  )

  private def submission(labels: Seq[JsObject], panos: Seq[JsObject]): JsObject = {
    val now = OffsetDateTime.now.toString
    Json.obj(
      "mission" -> Json.obj(
        "mission_id"        -> missionId,
        "distance_progress" -> 1.0,
        "region_id"         -> regionId,
        "completed"         -> false,
        "audit_task_id"     -> JsNull,
        "skipped"           -> false
      ),
      // completed=false keeps the submission from touching street priority / region completion state.
      "audit_task" -> Json.obj(
        "street_edge_id"                  -> streetEdgeId,
        "task_start"                      -> now,
        "audit_task_id"                   -> JsNull,
        "completed"                       -> false,
        "current_lat"                     -> 41.85,
        "current_lng"                     -> -87.65,
        "start_point_reversed"            -> false,
        "current_mission_start"           -> JsNull,
        "last_priority_update_time"       -> now,
        "request_updated_street_priority" -> false,
        "audited_distance_m"              -> 0.0,
        "route_street_id"                 -> JsNull
      ),
      "labels"       -> JsArray(labels),
      "interactions" -> Json.arr(),
      "environment"  -> Json.obj(
        "browser"          -> "chrome",
        "browser_version"  -> "1",
        "browser_width"    -> 1920,
        "browser_height"   -> 1080,
        "avail_width"      -> 1920,
        "avail_height"     -> 1080,
        "screen_width"     -> 1920,
        "screen_height"    -> 1080,
        "operating_system" -> "linux",
        "language"         -> "en",
        "css_zoom"         -> 100
      ),
      "panos"         -> JsArray(panos),
      "user_route_id" -> JsNull,
      "timestamp"     -> now
    )
  }

  private def post(body: JsObject) =
    route(app, FakeRequest(POST, "/task").withCookies(sessionCookies: _*).withJsonBody(body).withCSRFToken).get

  private def labelCount(panoId: String): Int =
    runDb(sql"SELECT count(*) FROM label WHERE pano_id = $panoId AND user_id = $userId".as[Int].head)

  /** Puts a bare pano_data row in place, standing in for one a scrape or evolution 360's tutorial seed wrote. */
  private def seedPanoRow(panoId: String, address: String): Unit = {
    val _ = runDb(
      sqlu"""INSERT INTO pano_data (pano_id, capture_date, source, width, address)
             VALUES ($panoId, '2014-05', 'gsv', 4096, $address)"""
    )
  }

  private def panoRow(panoId: String): Option[(Option[Double], Option[Int], Option[String])] =
    runDb(
      sql"SELECT lat, width, address FROM pano_data WHERE pano_id = $panoId"
        .as[(Option[Double], Option[Int], Option[String])]
        .headOption
    )

  "POST /task" should {
    "save a label atomically with the pano metadata, links, and history it carries" in {
      val panoId       = s"$panoPrefix-happy"
      val targetPanoId = s"$panoPrefix-happy-target"
      val prevPanoId   = s"$panoPrefix-happy-prev"
      val link         = Json.obj("target_pano_id" -> targetPanoId, "yaw_deg" -> 45.0, "description" -> JsNull)
      val history      = Json.obj("pano_id" -> prevPanoId, "date" -> "2019-05")

      // The pano rides the label only — an empty `panos` batch proves the label path alone produces the pano rows.
      val resp = post(
        submission(
          labels = Seq(
            label(
              panoId,
              tempLabelId = 1,
              pano = Some(pano(panoId, address = Some("123 Main St"), links = Seq(link), history = Seq(history)))
            )
          ),
          panos = Seq.empty
        )
      )

      status(resp) mustBe OK
      (contentAsJson(resp) \ "label_ids").as[Seq[JsObject]] must have size 1
      labelCount(panoId) mustBe 1
      panoRow(panoId) mustBe Some((Some(41.87), Some(8192), Some("123 Main St")))
      runDb(
        sql"SELECT count(*) FROM pano_link WHERE pano_id = $panoId AND target_pano_id = $targetPanoId".as[Int].head
      ) mustBe 1
      runDb(
        sql"SELECT count(*) FROM pano_history WHERE pano_id = $prevPanoId AND location_curr_pano_id = $panoId"
          .as[Int]
          .head
      ) mustBe 1
    }

    "fail the whole submission when a label's own pano block fails to write, saving neither" in {
      val panoId = s"$panoPrefix-label-bad"

      // lat=999 violates pano_data's lat/lng CHECK constraint. The pano is integral to the label, so the write
      // failure must roll back the label with it instead of quietly saving an orphan.
      val resp = post(
        submission(
          labels = Seq(label(panoId, tempLabelId = 2, pano = Some(pano(panoId, lat = Some(999.0))))),
          panos = Seq.empty
        )
      )

      status(resp) mustBe INTERNAL_SERVER_ERROR
      labelCount(panoId) mustBe 0
      panoRow(panoId) mustBe None
    }

    "reject a label whose pano block describes a different pano" in {
      val labelPanoId = s"$panoPrefix-mismatch-label"
      val blockPanoId = s"$panoPrefix-mismatch-block"

      // A mismatched block would commit a label pointing at one pano while writing another's pano_data row — the
      // orphan #4587 exists to prevent — so validation refuses the submission before anything touches the database.
      val resp = post(
        submission(
          labels = Seq(label(labelPanoId, tempLabelId = 6, pano = Some(pano(blockPanoId)))),
          panos = Seq.empty
        )
      )

      status(resp) mustBe BAD_REQUEST
      labelCount(labelPanoId) mustBe 0
      panoRow(blockPanoId) mustBe None
    }

    "save the labels and the rest of the batch when a viewed pano's metadata write fails" in {
      val badPanoId    = s"$panoPrefix-bad"
      val goodPanoId   = s"$panoPrefix-good"
      val viewedPanoId = s"$panoPrefix-viewed"

      // The `panos` batch tracks panos merely viewed this session, so a CHECK-violating entry there is logged and
      // skipped without costing the labels (whose own pano rides the label) or the other viewed panos.
      val resp = post(
        submission(
          labels = Seq(label(goodPanoId, tempLabelId = 3, pano = Some(pano(goodPanoId)))),
          panos = Seq(pano(badPanoId, lat = Some(999.0)), pano(viewedPanoId))
        )
      )

      status(resp) mustBe OK
      labelCount(goodPanoId) mustBe 1
      panoRow(goodPanoId) mustBe Some((Some(41.87), Some(8192), None))
      // The viewed batch is written off the request's critical path, so its rows may land after the response.
      eventually(timeout(Span(10, Seconds)), interval(Span(200, Millis))) {
        panoRow(viewedPanoId) mustBe Some((Some(41.87), Some(8192), None)) // A bad viewed pano doesn't sink the rest.
      }
      panoRow(badPanoId) mustBe None
    }

    "refresh pano metadata on resubmission without clearing or duplicating anything" in {
      val panoId       = s"$panoPrefix-refresh"
      val targetPanoId = s"$panoPrefix-refresh-target"
      val prevPanoId   = s"$panoPrefix-refresh-prev"
      val link         = Json.obj("target_pano_id" -> targetPanoId, "yaw_deg" -> 45.0, "description" -> JsNull)
      val history      = Json.obj("pano_id" -> prevPanoId, "date" -> "2019-05")

      val first = post(
        submission(
          labels = Seq.empty,
          panos = Seq(
            pano(panoId, lat = Some(41.1), width = None, address = Some("123 Main St"), links = Seq(link),
              history = Seq(history))
          )
        )
      )
      status(first) mustBe OK
      // The viewed batch is written off the request's critical path; wait for the first write to land so the
      // newest-position-wins assertion below can't race it.
      eventually(timeout(Span(10, Seconds)), interval(Span(200, Millis))) {
        panoRow(panoId) mustBe Some((Some(41.1), None, Some("123 Main St")))
      }

      // Resubmit the same pano: a newer position, dimensions this time, no address, and the same link + history.
      val second = post(
        submission(
          labels = Seq.empty,
          panos = Seq(
            pano(panoId, lat = Some(41.2), width = Some(4096), address = None, links = Seq(link),
              history = Seq(history))
          )
        )
      )
      status(second) mustBe OK

      // Newest position wins, the NULL width was filled in, and the absent address didn't clear the stored one.
      eventually(timeout(Span(10, Seconds)), interval(Span(200, Millis))) {
        panoRow(panoId) mustBe Some((Some(41.2), Some(4096), Some("123 Main St")))
      }
      runDb(sql"SELECT count(*) FROM pano_link WHERE pano_id = $panoId".as[Int].head) mustBe 1
      runDb(sql"SELECT count(*) FROM pano_history WHERE location_curr_pano_id = $panoId".as[Int].head) mustBe 1
    }

    "save a label that carries no pano block onto the pano row already there, the shape tutorial labels use" in {
      // Labels on the locally-served tutorial panos omit the block so their fabricated metadata can't touch the
      // pano_data rows evolution 360 seeded for them; the server extends the same leniency to any blockless label.
      // The stored row must come through untouched — that leniency is the whole point of the shape.
      val panoId = s"$panoPrefix-blockless"
      seedPanoRow(panoId, "456 Seeded Ave")

      val resp = post(submission(labels = Seq(label(panoId, tempLabelId = 4)), panos = Seq.empty))

      status(resp) mustBe OK
      labelCount(panoId) mustBe 1
      panoRow(panoId) mustBe Some((None, Some(4096), Some("456 Seeded Ave")))
    }

    "refuse the whole submission when a blockless label names a pano with no row" in {
      // label_pano_id_fkey (evolution 360) is the only thing standing between a blockless label and an orphan, and
      // nothing checks ahead of it, so this surfaces as a failed transaction rather than a validation error: the
      // submission is rejected whole, exactly as a failed pano block is. Every seeded deployment has the tutorial
      // panos, so the shape should be unreachable in practice; #5101 tracks giving it a cleaner answer than a 500.
      val panoId = s"$panoPrefix-orphan"

      val resp = post(submission(labels = Seq(label(panoId, tempLabelId = 5)), panos = Seq.empty))

      status(resp) mustBe INTERNAL_SERVER_ERROR
      labelCount(panoId) mustBe 0
      panoRow(panoId) mustBe None
    }
  }
}
