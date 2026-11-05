package controllers.api

import models.api.StreetGradientApiFields
import models.utils.MyPostgresProfile.api.given
import org.apache.pekko.stream.Materializer
import org.apache.pekko.util.ByteString
import org.scalatest.{BeforeAndAfterAll, OptionValues}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsNull, JsObject}
import play.api.test.Helpers.*
import play.api.test.FakeRequest
import util.{RolledBackDb, SidewalkSpec, StreetFixtures}

/**
 * Locks the response contract of the Streets API: GET /v3/api/streets returns a GeoJSON FeatureCollection by default
 * and a snake_case CSV header for filetype=csv (400 INVALID_PARAMETER on a malformed bbox), and GET
 * /v3/api/streetTypes returns the {status, street_types:[{name, description, count}]} envelope. Asserts shape, not data.
 *
 * Boots the real application (real Slick/PostGIS) and exercises the routes end to end. The endpoints are
 * `UserAwareAction` (no auth needed) and make no external WS calls on the request path. The eager scheduling actors
 * are disabled so they don't fire background DB/WS work during the test.
 *
 * The grade fields (#5431) need a street with a `street_gradient` row, which CI's seed lacks, so the spec seeds a
 * region of its own with one sampled and one unsampled street, and deletes them in `afterAll` (a request runs in its
 * own transaction, so a rollback cannot do it).
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 *
 * `BeforeAndAfterAll` is mixed in before `GuiceOneAppPerSuite` so that `afterAll` runs while the app is still up.
 */
class StreetsApiSpec
    extends SidewalkSpec
    with BeforeAndAfterAll
    with GuiceOneAppPerSuite
    with RolledBackDb
    with StreetFixtures
    with OptionValues {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .build()

  // File-streamed responses (chunked GeoJSON/CSV) need a real Materializer to consume; the test default is
  // NoMaterializer, which only works for strict bodies like JSON.
  given mat: Materializer = app.materializer

  // A tiny near-empty bbox keeps the streamed body cheap regardless of how much data the connected DB holds.
  private val tinyBbox = "bbox=0,0,0.001,0.001"

  private var gradeRegion: Int     = 0
  private var sampledStreet: Int   = 0
  private var unsampledStreet: Int = 0
  private val GradeSpecWay         = 9_000_101L

  private val gradeFieldNames: Seq[String] = StreetGradientApiFields.statFields.map(_.name)

  override def beforeAll(): Unit = {
    super.beforeAll()
    gradeRegion = run(insertRegion())
    sampledStreet = run(insertStreet(Some(gradeRegion)))
    unsampledStreet = run(insertStreet(Some(gradeRegion)))
    // The streets API inner-joins each street's primary OSM way, so both streets need one.
    val _ = run(
      sqlu"""INSERT INTO osm_way_street_edge (osm_way_street_edge_id, osm_way_id, street_edge_id)
             VALUES ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge), $GradeSpecWay,
                     $sampledStreet),
                    ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 2 FROM osm_way_street_edge), $GradeSpecWay,
                     $unsampledStreet)""" andThen
        sqlu"""INSERT INTO street_gradient (street_edge_id, quality, confidence, net_grade, mean_grade, max_grade,
                                            meters_over_5pct_grade, meters_over_8pct_grade, climb_m, descent_m,
                                            elev_start_m, elev_end_m, profile_cm, dem_source, dem_resolution_m, geom_md5)
               VALUES ($sampledStreet, 'measured', 'high', -0.04, 0.06, 0.09, 40, 10, 1.5, 5.5, 104.0, 100.0,
                       ARRAY[10400, 10250, 10150, 10050, 10000], 'usgs-3dep-10m', 10,
                       '0123456789abcdef0123456789abcdef')"""
    )
  }

  override def afterAll(): Unit = {
    try {
      // The gradient rows and region links go with the streets; the way links have no cascade.
      val _ = run(
        sqlu"DELETE FROM osm_way_street_edge WHERE street_edge_id IN ($sampledStreet, $unsampledStreet)" andThen
          sqlu"DELETE FROM street_edge WHERE street_edge_id IN ($sampledStreet, $unsampledStreet)" andThen
          sqlu"DELETE FROM region WHERE region_id = $gradeRegion"
      )
    } finally super.afterAll()
  }

  "GET /v3/api/streets" should {
    "return 200 GeoJSON FeatureCollection by default" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/streets?$tinyBbox")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      // tinyBbox is deliberately empty, so per-feature checks rarely run; the audited/outdated invariant is
      // exercised against a populated feed in controllers.StreetAuditStatusSpec.
      val features = (json \ "features").asOpt[Seq[JsObject]]
      features mustBe defined

      // If the tiny bbox happens to contain a street, its properties must carry the max_speed key (may be null).
      features.get.headOption.foreach { feature => (feature \ "properties" \ "max_speed").toOption mustBe defined }
    }

    "list every OSM way a street lies on, the primary way among them, in street order (#5741)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/streets")).get
      status(resp) mustBe OK
      val features = (contentAsJson(resp) \ "features").as[Seq[JsObject]]
      features must not be empty
      features.foreach { feature =>
        val props = feature \ "properties"
        val ways  = (props \ "osm_ways").as[Seq[JsObject]]
        // The Infra3d placeholder -1 names no way and is left out of the list; any real primary way is in it.
        if ((props \ "osm_way_id").as[Long] != -1L)
          ways.map(w => (w \ "osm_way_id").as[Long]) must contain((props \ "osm_way_id").as[Long])
        ways.foreach { way =>
          way.keys mustBe Set("osm_way_id", "street_from_frac", "street_to_frac", "way_from_frac", "way_to_frac",
            "same_direction")
          // A positioned link carries every position column; an unpositioned one none of them.
          val positions = Seq("street_from_frac", "street_to_frac", "way_from_frac", "way_to_frac", "same_direction")
          positions.map(k => (way \ k).toOption.exists(_ != play.api.libs.json.JsNull)).distinct.size mustBe 1
        }
        val starts = ways.flatMap(w => (w \ "street_from_frac").asOpt[Double])
        starts mustBe starts.sorted
      }
    }

    "return CSV with the documented snake_case header when filetype=csv" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/streets?$tinyBbox&filetype=csv")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/csv")

      val body = contentAsString(resp)
      // Header from StreetDataForApi.csvHeader; assert snake_case field names are present and camelCase absent.
      body must include(
        "street_edge_id,osm_way_id,region_id,region_name,way_type,max_speed,status,user_ids,label_count," +
          "audit_count,outdated,user_count,first_label_date,last_label_date,osm_ways,start_point,end_point," +
          "mean_grade,max_grade,net_grade,total_climb_meters,total_descent_meters,meters_over_5pct,meters_over_8pct," +
          "grade_confidence,grade_quality,dem_source"
      )
      body must not include "streetEdgeId"
      body must not include "labelCount"
    }

    "carry a sampled street's grade fields, and nulls on a street with no gradient row (#5431)" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/streets?regionId=$gradeRegion")).get
      status(resp) mustBe OK
      val byId = (contentAsJson(resp) \ "features")
        .as[Seq[JsObject]]
        .map(f => (f \ "properties").as[JsObject])
        .map(p => (p \ "street_edge_id").as[Int] -> p)
        .toMap
      byId.keySet mustBe Set(sampledStreet, unsampledStreet)

      // The grade fields come last, after every field the endpoint already had.
      byId(sampledStreet).keys.toSeq.takeRight(gradeFieldNames.size) mustBe gradeFieldNames

      val sampled = byId(sampledStreet)
      (sampled \ "mean_grade").as[Double] mustBe 0.06
      (sampled \ "max_grade").as[Double] mustBe 0.09
      (sampled \ "net_grade").as[Double] mustBe -0.04
      (sampled \ "total_climb_meters").as[Double] mustBe 1.5
      (sampled \ "total_descent_meters").as[Double] mustBe 5.5
      (sampled \ "meters_over_5pct").as[Double] mustBe 40.0
      (sampled \ "meters_over_8pct").as[Double] mustBe 10.0
      (sampled \ "grade_confidence").as[String] mustBe "high"
      (sampled \ "grade_quality").as[String] mustBe "measured"
      (sampled \ "dem_source").as[String] mustBe "usgs-3dep-10m"
      // The profile stays on /v3/api/streetGrade.
      sampled.keys must not contain "profile"

      // Present and null, not missing, so every feature has the same keys.
      gradeFieldNames.foreach(name => (byId(unsampledStreet) \ name).toOption mustBe Some(JsNull))
    }

    "carry the grade fields as CSV cells, empty on a street with no gradient row (#5431)" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/streets?regionId=$gradeRegion&filetype=csv")).get
      status(resp) mustBe OK
      val lines  = contentAsString(resp).linesIterator.filter(_.nonEmpty).toSeq
      val header = lines.head.split(",", -1).toSeq
      header.takeRight(gradeFieldNames.size) mustBe gradeFieldNames
      // The point cells hold a comma inside quotes, so read the grade cells off the end of each row.
      def gradeCells(streetEdgeId: Int): Seq[String] =
        lines.find(_.startsWith(s"$streetEdgeId,")).value.split(",", -1).toSeq.takeRight(gradeFieldNames.size)

      gradeCells(sampledStreet) mustBe Seq("0.06", "0.09", "-0.04", "1.5", "5.5", "40.0", "10.0", "high", "measured",
        "usgs-3dep-10m")
      gradeCells(unsampledStreet) mustBe Seq.fill(gradeFieldNames.size)("")
    }

    "return 400 INVALID_PARAMETER for an unrecognized status value" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/streets?status=bogus")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "status"
    }

    "accept a valid status filter" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/streets?$tinyBbox&status=no_imagery")).get
      status(resp) mustBe OK
    }

    "return 400 INVALID_PARAMETER for a malformed bbox, as an RFC 7807 problem+json body" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/streets?bbox=not-a-bbox")).get
      status(resp) mustBe BAD_REQUEST
      contentType(resp) mustBe Some("application/problem+json") // RFC 7807 media type (#3931).
      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "about:blank"
      (json \ "title").as[String] mustBe "Invalid Parameter"
      (json \ "status").as[Int] mustBe 400
      (json \ "code").as[String] mustBe "INVALID_PARAMETER"
      (json \ "detail").asOpt[String] mustBe defined
      (json \ "parameter").as[String] mustBe "bbox"
    }

    "return 400 INVALID_PARAMETER for a non-positive regionId" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/streets?regionId=0")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "regionId"
    }
  }

  "GET /v3/api/streets?filetype=geopackage" should {
    "return a SQLite GeoPackage whose schema carries the JSON's field names, outdated and max_speed included" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/streets?filetype=geopackage")).get
      status(resp) mustBe OK

      val bytes = contentAsBytes(resp)
      // A GeoPackage is a raw SQLite database; its column names appear as plain text in the schema pages, so a
      // byte-level search proves the fields reached the export without pulling in a SQLite reader as a test dep.
      bytes.take(15).utf8String mustBe "SQLite format 3"
      bytes.containsSlice(org.apache.pekko.util.ByteString("outdated")) mustBe true
      bytes.containsSlice(org.apache.pekko.util.ByteString("max_speed")) mustBe true
      bytes.containsSlice(org.apache.pekko.util.ByteString("street_edge_id")) mustBe true   // #5273
      bytes.containsSlice(org.apache.pekko.util.ByteString("first_label_date")) mustBe true // #5273
      bytes.containsSlice(org.apache.pekko.util.ByteString("osm_ways")) mustBe true         // #5741
      bytes.containsSlice(org.apache.pekko.util.ByteString("first_label_time")) mustBe false
    }

    "carry the grade fields as columns (#5431)" in {
      val resp = route(app, FakeRequest(GET, s"/v3/api/streets?regionId=$gradeRegion&filetype=geopackage")).get
      status(resp) mustBe OK
      val bytes = contentAsBytes(resp)
      gradeFieldNames.foreach(name => bytes.containsSlice(ByteString(name)) mustBe true)
    }
  }

  "GET /v3/api/streets?filetype=shapefile" should {
    "return a nonempty ZIP archive" in {
      // The DBF field names live inside compressed entries, so this only smoke-tests that the export (including the
      // outdated featureBuilder wiring, which would 500 on a schema/value mismatch) still assembles end to end.
      val resp = route(app, FakeRequest(GET, "/v3/api/streets?filetype=shapefile")).get
      status(resp) mustBe OK
      contentAsBytes(resp).take(2).utf8String mustBe "PK"
    }

    "assemble with a sampled street in it (#5431)" in {
      // The grade columns' names and values are read back in RawLabelExportSpec; this proves the endpoint's own
      // stream carries the statistics into a writer whose schema has room for them.
      val resp = route(app, FakeRequest(GET, s"/v3/api/streets?regionId=$gradeRegion&filetype=shapefile")).get
      status(resp) mustBe OK
      contentAsBytes(resp).take(2).utf8String mustBe "PK"
    }
  }

  "GET /v3/api/streetTypes" should {
    "return 200 JSON with the {status, street_types:[{name, description, count}]} envelope" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/streetTypes")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "status").as[String] mustBe "OK"
      (json \ "streetTypes").toOption mustBe None // old camelCase envelope gone (#3871)
      val streetTypes = (json \ "street_types").as[Seq[JsObject]]

      // Each entry must expose name/description/count (StreetTypeForApi). If the DB has no streets the array can be
      // empty, so only assert the per-element shape when at least one entry is present.
      streetTypes.headOption.foreach { entry =>
        (entry \ "name").asOpt[String] mustBe defined
        (entry \ "description").asOpt[String] mustBe defined
        (entry \ "count").asOpt[Int] mustBe defined
      }
    }
  }
}
