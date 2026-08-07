package controllers

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Locks the pano-provenance contract of POST /ai/submitLabelsOnPano (#4806): a submission whose pano block carries
 * `source_metadata` persists the verbatim blob on pano_data — on first insert and on re-POST of an already-recorded
 * pano — while a payload without the key leaves any stored blob untouched (the Explore write path shares this upsert
 * and its payloads never carry the key). A blob that isn't an object, or is absurdly large, is refused outright.
 *
 * Uses `labels: []` payloads throughout: the endpoint upserts the pano and inserts no labels, so the spec needs no
 * street/region/mission fixtures and leaves only pano rows, which it deletes on both ends of the run.
 *
 * Boots the real application against Postgres+PostGIS (like the /v3 API specs). The endpoint's two fail-closed gates
 * are opened via config overrides: `internal-api-key` (bearer auth) and the running city's AI-submission flag.
 *
 * These POSTs are also the only guard on the route's `+ nocsrf`: they go through `route(app, ...)`, which runs the
 * full filter chain, and Play's CSRF filter protects any unsafe request carrying an Authorization header — which is
 * exactly how the labeler authenticates. Drop the modifier and every case here 403s. Keep the requests going through
 * `route`; calling the controller directly would still pass while the production ingest was dead.
 */
// Mixin order matters: GuiceOneAppPerSuite must be rightmost so its run() wraps BeforeAndAfterAll's — otherwise
// afterAll's cleanup executes after the app (and its DB pool) has shut down and aborts the suite.
class AiSubmissionSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  private val internalApiKey = "test-internal-api-key"

  // The provenance cases below walk one pano through insert → re-POST → omitted-key, so they share a row and run in
  // order. The insert-without-the-key case needs a pristine row of its own, hence the second id.
  private val panoId     = "AiSubmissionSpec-pano-4806"
  private val barePanoId = "AiSubmissionSpec-pano-4806-no-metadata"

  // `city-id` resolves from this env var (conf/application.conf), which has no default — an unset value would boot an
  // app whose city flag this spec can't address, so fail loudly here instead of failing obscurely four cases later.
  private val cityId = sys.env.getOrElse(
    "SIDEWALK_CITY_ID",
    throw new IllegalStateException("SIDEWALK_CITY_ID must be set to run AiSubmissionSpec")
  )

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .configure(
        "internal-api-key"                                 -> internalApiKey,
        s"city-params.ai-label-submission-enabled.$cityId" -> true
      )
      .build()

  private lazy val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  /** Runs a DBIO synchronously; for arrange/assert queries only, never the code under test. */
  private def runDb[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 30.seconds)

  private def deleteTestPanos(): Unit = {
    val _ = runDb(sqlu"DELETE FROM pano_data WHERE pano_id IN ($panoId, $barePanoId)")
  }

  private def panoRowCount(id: String = panoId): Int =
    runDb(sql"SELECT count(*) FROM pano_data WHERE pano_id = $id".as[Int].head)

  private def storedMetadata(id: String = panoId): Option[String] =
    runDb(sql"SELECT source_metadata::text FROM pano_data WHERE pano_id = $id".as[Option[String]].headOption).flatten

  /** A valid submission with no labels; `sourceMetadata = None` omits the key entirely, like an Explore payload. */
  private def payload(sourceMetadata: Option[JsObject], id: String = panoId): JsObject = {
    val panoBase = Json.obj(
      "pano_id"        -> id,
      "source"         -> "mapillary",
      "capture_date"   -> "2025-06",
      "width"          -> 8192,
      "height"         -> 4096,
      "lat"            -> 47.6,
      "lng"            -> -122.3,
      "camera_heading" -> 180.0,
      "links"          -> Json.arr(),
      "history"        -> Json.arr()
    )
    Json.obj(
      "label_type"          -> "CurbRamp",
      "model_id"            -> "test-model",
      "model_training_date" -> "01-15-2026",
      "api_version"         -> "1.0",
      "labels"              -> Json.arr(),
      "pano"                -> sourceMetadata.fold(panoBase)(m => panoBase + ("source_metadata" -> m))
    )
  }

  /** Same as `payload`, but drops an arbitrary JSON value into `source_metadata` to exercise the reader's guards. */
  private def payloadWithRawMetadata(rawMetadata: JsValue): JsObject = {
    val base = payload(None)
    base + ("pano" -> ((base \ "pano").as[JsObject] + ("source_metadata" -> rawMetadata)))
  }

  private def post(body: JsObject, key: String = internalApiKey) =
    route(
      app,
      FakeRequest(POST, "/ai/submitLabelsOnPano")
        .withHeaders(AUTHORIZATION -> s"Bearer $key")
        .withJsonBody(body)
    ).get

  private val metadataV1 = Json.obj("make" -> "GoPro Max", "camera_type" -> "spherical", "quality_score" -> 0.87)
  private val metadataV2 = metadataV1 + ("quality_score" -> Json.toJson(0.93))

  override def beforeAll(): Unit = { super.beforeAll(); deleteTestPanos() }
  override def afterAll(): Unit  = {
    try deleteTestPanos()
    finally super.afterAll()
  }

  "POST /ai/submitLabelsOnPano" should {
    "reject a request without a valid internal API key" in {
      status(post(payload(Some(metadataV1)), key = "wrong-key")) mustBe UNAUTHORIZED
      panoRowCount() mustBe 0
    }

    "persist source_metadata when inserting a new pano" in {
      status(post(payload(Some(metadataV1)))) mustBe OK
      panoRowCount() mustBe 1
      storedMetadata().map(Json.parse) mustBe Some(metadataV1)
    }

    "overwrite source_metadata when re-POSTing an already-recorded pano" in {
      status(post(payload(Some(metadataV2)))) mustBe OK
      panoRowCount() mustBe 1
      storedMetadata().map(Json.parse) mustBe Some(metadataV2)
    }

    "keep the stored source_metadata when a payload omits the key" in {
      status(post(payload(None))) mustBe OK
      storedMetadata().map(Json.parse) mustBe Some(metadataV2)
    }

    "leave source_metadata null when inserting a pano from a payload without the key" in {
      status(post(payload(None, id = barePanoId))) mustBe OK
      panoRowCount(barePanoId) mustBe 1
      storedMetadata(barePanoId) mustBe None
    }

    "reject a source_metadata that isn't a JSON object" in {
      status(post(payloadWithRawMetadata(Json.toJson("not an object")))) mustBe BAD_REQUEST
      storedMetadata().map(Json.parse) mustBe Some(metadataV2)
    }

    "reject a source_metadata larger than the cap" in {
      val oversized = Json.obj("padding" -> "x" * (64 * 1024))
      status(post(payloadWithRawMetadata(oversized))) mustBe BAD_REQUEST
      storedMetadata().map(Json.parse) mustBe Some(metadataV2)
    }
  }
}
