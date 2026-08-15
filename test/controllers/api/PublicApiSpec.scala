package controllers.api

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsObject
import play.api.test.Helpers._
import play.api.test.FakeRequest

/**
 * In-JVM functional tests for the public v3 API. Boots the real application (all modules, real Slick/PostGIS) and
 * exercises routes end to end — so a single test covers routing, the DAO/query layer, and JSON/CSV serialization.
 *
 * The read-only v3 endpoints are `UserAwareAction` (no auth) and make no external WS calls on the request path, so
 * this slice needs no Silhouette fixtures or WS stubs. The eager scheduling actors are disabled so they don't fire
 * background DB/WS work during the test. Asserts response *shape/contract*, not data values, so it's robust against
 * whatever the connected test DB contains.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class PublicApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .build()

  // File-streamed responses (e.g. CSV via Ok.sendFile) need a real Materializer to consume; the test default is
  // NoMaterializer, which only works for strict bodies like JSON.
  implicit lazy val mat: Materializer = app.materializer

  "GET /v3/api/overallStats" should {
    "return 200 JSON with the documented top-level structure" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/overallStats")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "launch_date").asOpt[String] mustBe defined
      (json \ "km_explored").asOpt[Double] mustBe defined
      (json \ "user_counts").asOpt[JsObject] mustBe defined
      (json \ "labels").asOpt[JsObject] mustBe defined
      (json \ "validations").asOpt[JsObject] mustBe defined
    }

    "expose the label/image date metrics, including the standard deviations (#3031)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/overallStats")).get
      status(resp) mustBe OK

      // Driving these through the real query also exercises the positional GetResult converter: a column-order drift
      // between the SELECT and the converter would surface here as a missing key or a parse failure.
      val labels = (contentAsJson(resp) \ "labels").as[JsObject]
      labels.keys must contain("avg_label_timestamp")
      labels.keys must contain("avg_age_of_image_when_labeled")
      labels.keys must contain("stddev_label_timestamp")
      labels.keys must contain("stddev_age_of_image_when_labeled")

      // A standard deviation of dates is a duration: when the dataset has enough labels to compute one, it renders as
      // a day-valued string (e.g. "188 days"). Tolerate null so the contract holds on a sparse test DB.
      (labels \ "stddev_label_timestamp").asOpt[String].foreach(_ must fullyMatch regex """-?\d+ days""")
      (labels \ "stddev_age_of_image_when_labeled").asOpt[String].foreach(_ must fullyMatch regex """-?\d+ days""")
    }

    "return CSV with snake_case keys when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/overallStats?filetype=csv")).get
      status(resp) mustBe OK
      val body = contentAsString(resp)
      body must include("launch_date")
      body must include("km_explored")
      body must not include "Launch Date" // old Title-Case key gone
      // The #3031 standard-deviation date metrics appear in the CSV with the same snake_case keys as the JSON.
      body must include("stddev_label_timestamp")
      body must include("stddev_age_of_image_when_labeled")
    }
  }

  "GET /v3/api/regions" should {
    "return 200 GeoJSON FeatureCollection by default" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/regions")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      (json \ "features").asOpt[Seq[JsObject]] mustBe defined
    }

    "return CSV with the documented header when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/regions?filetype=csv")).get
      status(resp) mustBe OK
      contentAsString(resp) must include(
        "region_id,name,label_count,street_count,user_count,audit_count,total_distance_m,audited_distance_m," +
          "outdated_distance_m,completion_rate,first_label_date,last_label_date,center_point"
      )
    }

    "return 400 for a malformed bbox" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/regions?bbox=not-a-bbox")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "bbox"
    }

    "return 400 for a non-positive regionId" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/regions?regionId=0")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "regionId"
    }
  }

  "GET /v3/api/cities" should {
    "return 200 JSON" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/cities")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")
    }
  }

  // Parameter-validation contract for the filtered endpoints. These assertions hit the controller's input validation,
  // which runs before any DB query, so they are fast and independent of whatever the connected DB contains. Each case
  // pins both the 400 status and the `parameter` field, which together form the documented error contract — and each
  // guards a specific bug class (an invalid enum or malformed date being silently dropped instead of rejected).

  "GET /v3/api/rawLabels parameter validation" should {
    // A tiny bbox far from any city keeps the streamed success body cheap while still exercising the happy path.
    val emptyBbox = "0,0,0.001,0.001"

    "reject a non-positive regionId with 400 (parameter=regionId)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?regionId=-1")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "regionId"
    }

    "reject an invalid validationStatus with 400 (parameter=validationStatus)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?validationStatus=not-a-status")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "validationStatus"
    }

    "reject a malformed startDate with 400 (parameter=startDate)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?startDate=not-a-date")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "startDate"
    }

    "reject a malformed endDate with 400 (parameter=endDate)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?endDate=2020-13-99")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "endDate"
    }

    "reject a malformed bbox with 400 (parameter=bbox)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?bbox=1,2,3")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "bbox"
    }

    "accept a valid validationStatus and ISO startDate, returning a GeoJSON FeatureCollection" in {
      val url  = s"/v3/api/rawLabels?bbox=$emptyBbox&validationStatus=validated_correct&startDate=2021-01-01T00:00:00Z"
      val resp = route(app, FakeRequest(GET, url)).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "type").as[String] mustBe "FeatureCollection"
    }

    "include pano_source in the CSV header" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/rawLabels?bbox=$emptyBbox&filetype=csv&inline=true")).get
      status(resp) mustBe OK
      contentAsString(resp) must include("pano_id,pano_source,label_type")
    }
  }

  "GET /v3/api/validations parameter validation" should {
    "reject a malformed validationTimestamp with 400 (parameter=validationTimestamp)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/validations?validationTimestamp=nope")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "validationTimestamp"
    }

    "reject an out-of-range validationResult with 400 (parameter=validationResult)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/validations?validationResult=9")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "validationResult"
    }

    "reject an unsupported shapefile request with 400 (parameter=filetype)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/validations?filetype=shapefile")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "filetype"
    }
  }

  "GET /v3/api/labelClusters parameter validation" should {
    "reject a malformed bbox with 400 (parameter=bbox)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/labelClusters?bbox=not-a-bbox")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "bbox"
    }

    "reject a non-positive regionId with 400 (parameter=regionId)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/labelClusters?regionId=0")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "regionId"
    }

    "reject a malformed avgLabelDate with 400 (parameter=avgLabelDate)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/labelClusters?avgLabelDate=nope")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "avgLabelDate"
    }

    "reject a malformed avgImageCaptureDate with 400 (parameter=avgImageCaptureDate)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/labelClusters?avgImageCaptureDate=nope")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "avgImageCaptureDate"
    }

    "reject an out-of-range minSeverity with 400 (parameter=minSeverity)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/labelClusters?minSeverity=9")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "minSeverity"
    }

    "reject a non-positive clusterSize with 400 (parameter=clusterSize)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/labelClusters?clusterSize=0")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "clusterSize"
    }

    "return a parseable FeatureCollection with pano_source on included raw labels" in {
      // Runs the includeRawLabels SQL (jsonb_agg + LEFT JOIN pano_data) end to end over the whole test DB. The
      // full-world bbox matters: labels without a pano_data row must stream as raw labels with pano_source omitted
      // rather than killing the response mid-stream, so contentAsJson parsing the complete body is the regression
      // assertion. pano_source is optional in the contract, but when present it must be a known provider.
      val worldBbox = "-180,-85,180,85"
      val resp      = route(app, FakeRequest(GET, s"/v3/api/labelClusters?includeRawLabels=true&bbox=$worldBbox")).get
      status(resp) mustBe OK
      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      val rawLabels = (json \ "features")
        .as[Seq[JsObject]]
        .flatMap(f => (f \ "properties" \ "labels").asOpt[Seq[JsObject]].getOrElse(Seq.empty))
      val knownSources = models.pano.PanoSource.values.map(_.toString)
      rawLabels.foreach { label =>
        (label \ "pano_source").asOpt[String].foreach { source => knownSources must contain(source) }
      }
    }
  }
}
