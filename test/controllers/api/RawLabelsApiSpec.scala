package controllers.api

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.Helpers._
import models.utils.MyPostgresProfile.api._
import play.api.test.FakeRequest

/**
 * Locks the response contract of GET /v3/api/rawLabels: GeoJSON FeatureCollection by default, a snake_case CSV header
 * for filetype=csv, the severity/validationStatus/tags/labelType filter parameters (valid shapes return 200; invalid
 * values return 400 INVALID_PARAMETER naming the offending parameter), and the download filename contract. Asserts
 * shape, not data values.
 *
 * Boots the real application (real Slick/PostGIS) and exercises the route end to end. The endpoint is a
 * `UserAwareAction` (no auth needed) and makes no external WS calls on the request path. The eager scheduling actors
 * are disabled so they don't fire background DB/WS work during the test.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class RawLabelsApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .build()

  // File-streamed responses (chunked GeoJSON/CSV) need a real Materializer to consume; the test default is
  // NoMaterializer, which only works for strict bodies like JSON.
  implicit lazy val mat: Materializer = app.materializer

  // A tiny near-empty bbox keeps the streamed body cheap regardless of how much data the connected DB holds.
  private val tinyBbox = "bbox=0,0,0.001,0.001"

  "GET /v3/api/rawLabels" should {
    "return 200 GeoJSON FeatureCollection by default" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/rawLabels?$tinyBbox")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      (json \ "features").asOpt[Seq[play.api.libs.json.JsObject]] mustBe defined
    }

    "return CSV with the documented snake_case header when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/rawLabels?$tinyBbox&filetype=csv")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/csv")

      val body = contentAsString(resp)
      // Header from LabelDataForApi.csvHeader; assert snake_case field names are present and camelCase absent.
      body must include(
        "label_id,user_id,pano_id,pano_source,label_type,severity,tags,description,time_created,high_quality_user," +
          "street_edge_id,osm_way_id,region_id,region_name,street_side,centerline_offset_m,correct,agree_count," +
          "disagree_count,unsure_count," +
          "validations,audit_task_id,mission_id,image_capture_date,heading,pitch,zoom,canvas_x,canvas_y," +
          "canvas_width,canvas_height,pano_x,pano_y,pano_width,pano_height,camera_heading,camera_pitch," +
          "camera_roll,pano_url,latitude,longitude"
      )
      body must not include "labelId"
      body must not include "streetEdgeId"
      body must not include "neighborhood"
    }

    "carry street_side and centerline_offset_m on a real feature, consistent with each other (#2886)" in {
      // The row converter is positional, so only a feature read from the DB proves the two columns land in the right
      // fields. Needs a positioned label to build a bbox around; an empty schema cancels rather than passes.
      //
      // The anchor has to satisfy the same predicates getLabelDataWithFilters applies, or the bbox can enclose only
      // labels the endpoint filters out and the assertions below fail on an empty list. The newest label_point is
      // exactly the wrong pick: anyone who has just been labelling in the Explore tutorial leaves one there.
      val dbConfig =
        app.injector.instanceOf[play.api.db.slick.DatabaseConfigProvider].get[models.utils.MyPostgresProfile]
      val anchor = scala.concurrent.Await.result(
        dbConfig.db.run(
          sql"""SELECT label_point.lng, label_point.lat
                FROM label
                INNER JOIN label_point ON label.label_id = label_point.label_id
                INNER JOIN osm_way_street_edge ON label.street_edge_id = osm_way_street_edge.street_edge_id
                INNER JOIN street_edge_region ON label.street_edge_id = street_edge_region.street_edge_id
                INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
                INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
                INNER JOIN user_stat ON label.user_id = user_stat.user_id
                WHERE label_point.geom IS NOT NULL
                  AND label.deleted = FALSE
                  AND label.tutorial = FALSE
                  AND user_stat.excluded = FALSE
                  AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
                  AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
                ORDER BY label.label_id DESC
                LIMIT 1"""
            .as[(Double, Double)]
            .headOption
        ),
        scala.concurrent.duration.DurationInt(60).seconds
      )
      assume(anchor.isDefined, "no API-visible positioned labels in this schema; needs a seeded DB")
      val (lng, lat) = anchor.get
      val bbox       = s"bbox=${lng - 0.0005},${lat - 0.0005},${lng + 0.0005},${lat + 0.0005}"

      val resp = route(app, FakeRequest(GET, s"/v3/api/rawLabels?$bbox")).get
      status(resp) mustBe OK
      val features = (contentAsJson(resp) \ "features").as[Seq[play.api.libs.json.JsObject]]
      features must not be empty
      features.foreach { feature =>
        val props  = (feature \ "properties").as[play.api.libs.json.JsObject]
        val side   = (props \ "street_side").asOpt[String]
        val offset = (props \ "centerline_offset_m").asOpt[Double]
        (props \ "street_side").toOption mustBe defined
        (props \ "centerline_offset_m").toOption mustBe defined
        side.foreach(_ must (be("left") or be("right")))
        // The side is the offset with a 1 m floor: left is >= 1, right is <= -1, and inside the floor there is none.
        (side, offset) match {
          case (Some("left"), Some(m))  => m must be >= 1.0
          case (Some("right"), Some(m)) => m must be <= -1.0
          case (None, Some(m))          => m.abs must be < 1.0
          case (None, None)             => succeed
          case other                    => fail(s"side without an offset: $other")
        }
      }
    }

    "return 400 INVALID_PARAMETER for a malformed bbox" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?bbox=not-a-bbox")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "bbox"
    }

    "accept a severity set including the none token" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/rawLabels?$tinyBbox&severity=1,none")).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "type").as[String] mustBe "FeatureCollection"
    }

    "accept multiple validationStatus values including unsure" in {
      val url  = s"/v3/api/rawLabels?$tinyBbox&validationStatus=validated_correct,unsure,unvalidated"
      val resp = route(app, FakeRequest(GET, url)).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "type").as[String] mustBe "FeatureCollection"
    }

    "accept both scoped and unscoped tags entries, one per repeated parameter" in {
      val url  = s"/v3/api/rawLabels?$tinyBbox&tags=CurbRamp:narrow&tags=uneven surface"
      val resp = route(app, FakeRequest(GET, url)).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "type").as[String] mustBe "FeatureCollection"
    }

    "take a tag containing a comma as one tag rather than splitting it" in {
      // Real Signal tag. Tag values are validated against the city's tags, so the 200 is meaningful: split on the
      // comma, the entry would become two names the vocabulary doesn't contain, and the request would 400.
      val url  = s"/v3/api/rawLabels?$tinyBbox&tags=Signal:yellow box, accessibility features not visible"
      val resp = route(app, FakeRequest(GET, url)).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "type").as[String] mustBe "FeatureCollection"
    }

    "still accept an older comma-joined tags value whose pieces name real tags" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/rawLabels?$tinyBbox&tags=CurbRamp:narrow,uneven surface")).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "type").as[String] mustBe "FeatureCollection"
    }

    "reject an out-of-range severity value with 400 (parameter=severity)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?severity=5")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "severity"
    }

    "reject a non-numeric severity value with 400 (parameter=severity)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?severity=abc")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "severity"
    }

    "reject severity combined with minSeverity with 400 (parameter=severity)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?severity=1&minSeverity=2")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "severity"
    }

    "reject a validationStatus list containing an unknown token with 400 (parameter=validationStatus)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?validationStatus=validated_correct,bogus")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "validationStatus"
    }

    "reject an unknown labelType with 400 (parameter=labelType)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?labelType=NotAType")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "labelType"
    }

    "reject a scoped tags entry with a missing tag with 400 (parameter=tags)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?tags=CurbRamp:")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "tags"
    }

    "reject an empty tags occurrence with 400 (parameter=tags)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?tags=narrow&tags=")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "tags"
    }

    "reject a tag the city does not have with 400 (parameter=tags)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?tags=definitely-not-a-real-tag")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "tags"
    }

    "reject a tag scoped to a label type that does not carry it with 400 (parameter=tags)" in {
      // APS is a Signal tag; scoping it to CurbRamp would otherwise silently drop every CurbRamp label.
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?tags=CurbRamp:APS")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "tags"
    }

    "name the GeoJSON download with a .geojson extension and no colons" in {
      val resp        = route(app, FakeRequest(GET, s"/v3/api/rawLabels?$tinyBbox")).get
      val disposition = header(CONTENT_DISPOSITION, resp).value
      disposition must include(".geojson")
      disposition must not include ":"
    }

    "honor inline=true for CSV output" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/rawLabels?$tinyBbox&filetype=csv&inline=true")).get
      status(resp) mustBe OK
      header(CONTENT_DISPOSITION, resp).value must startWith("inline")
    }
  }
}
