package controllers

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsObject, Json}
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Locks the pano-provenance contract of POST /ai/submitLabelsOnPano (#4806): a submission whose pano block carries
 * `source_metadata` persists the verbatim blob on pano_data — on first insert and on re-POST of an already-recorded
 * pano — while a payload without the key leaves any stored blob untouched (the Explore write path shares this upsert
 * and its payloads never carry the key).
 *
 * Uses `labels: []` payloads throughout: the endpoint upserts the pano and inserts no labels, so the spec needs no
 * street/region/mission fixtures and leaves only the pano row, which it deletes on both ends of the run.
 *
 * Boots the real application against Postgres+PostGIS (like the /v3 API specs). The endpoint's two fail-closed gates
 * are opened via config overrides: `internal-api-key` (bearer auth) and the running city's AI-submission flag.
 */
// Mixin order matters: GuiceOneAppPerSuite must be rightmost so its run() wraps BeforeAndAfterAll's — otherwise
// afterAll's cleanup executes after the app (and its DB pool) has shut down and aborts the suite.
class AiSubmissionSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  private val internalApiKey = "test-internal-api-key"
  private val panoId         = "AiSubmissionSpec-pano-4806"

  // `city-id` resolves from this env var (conf/application.conf), and the city flag is keyed on it.
  private val cityId = sys.env.getOrElse("SIDEWALK_CITY_ID", "seattle-wa")

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

  private def deleteTestPano(): Unit = {
    val _ = runDb(sqlu"DELETE FROM pano_data WHERE pano_id = $panoId")
  }

  private def panoRowCount: Int = runDb(sql"SELECT count(*) FROM pano_data WHERE pano_id = $panoId".as[Int].head)

  private def storedMetadata: Option[String] =
    runDb(
      sql"SELECT source_metadata::text FROM pano_data WHERE pano_id = $panoId".as[Option[String]].headOption
    ).flatten

  /** A valid submission with no labels; `sourceMetadata = None` omits the key entirely, like an Explore payload. */
  private def payload(sourceMetadata: Option[JsObject]): JsObject = {
    val panoBase = Json.obj(
      "pano_id"        -> panoId,
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

  private def post(body: JsObject, key: String = internalApiKey) =
    route(
      app,
      FakeRequest(POST, "/ai/submitLabelsOnPano")
        .withHeaders(AUTHORIZATION -> s"Bearer $key")
        .withJsonBody(body)
    ).get

  private val metadataV1 = Json.obj("make" -> "GoPro Max", "camera_type" -> "spherical", "quality_score" -> 0.87)
  private val metadataV2 = metadataV1 + ("quality_score" -> Json.toJson(0.93))

  override def beforeAll(): Unit = { super.beforeAll(); deleteTestPano() }
  override def afterAll(): Unit  = {
    try deleteTestPano()
    finally super.afterAll()
  }

  "POST /ai/submitLabelsOnPano" should {
    "reject a request without a valid internal API key" in {
      status(post(payload(Some(metadataV1)), key = "wrong-key")) mustBe UNAUTHORIZED
      panoRowCount mustBe 0
    }

    "persist source_metadata when inserting a new pano" in {
      status(post(payload(Some(metadataV1)))) mustBe OK
      panoRowCount mustBe 1
      storedMetadata.map(Json.parse) mustBe Some(metadataV1)
    }

    "overwrite source_metadata when re-POSTing an already-recorded pano" in {
      status(post(payload(Some(metadataV2)))) mustBe OK
      panoRowCount mustBe 1
      storedMetadata.map(Json.parse) mustBe Some(metadataV2)
    }

    "keep the stored source_metadata when a payload omits the key" in {
      status(post(payload(None))) mustBe OK
      storedMetadata.map(Json.parse) mustBe Some(metadataV2)
    }
  }
}
