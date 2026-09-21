package controllers.api

import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsNull, JsObject}
import play.api.test.FakeRequest
import play.api.test.Helpers._
import util.{RolledBackDb, StreetFixtures}

/**
 * The 200s of GET /v3/api/streetGrade (#5223), which `AccessScoreApiSpec` cannot reach: CI's schema holds
 * no `street_gradient` rows, so without rows of its own a spec can only ever see the 404.
 *
 * A request runs in its own transaction, so these rows are committed, not rolled back: two streets seeded in
 * `beforeAll` and deleted in `afterAll` (the gradient rows go with them, by the table's `ON DELETE CASCADE`). The
 * streets sit at latitude 0 and belong to no region, so no other query selects them while they exist.
 *
 * `BeforeAndAfterAll` is mixed in before `GuiceOneAppPerSuite` so that `afterAll` runs while the app is still up.
 */
class StreetGradeApiSpec
    extends PlaySpec
    with BeforeAndAfterAll
    with GuiceOneAppPerSuite
    with RolledBackDb
    with StreetFixtures {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private var measuredStreet: Int  = 0
  private var structureStreet: Int = 0

  override def beforeAll(): Unit = {
    super.beforeAll()
    measuredStreet = run(insertStreet())
    structureStreet = run(insertStreet())
    // The measured row carries the street's real geometry hash, as the sampler writes it, so it starts out current.
    run(sqlu"""INSERT INTO street_gradient (street_edge_id, quality, confidence, net_grade, mean_grade, max_grade,
                                            meters_over_5pct_grade, meters_over_8pct_grade, climb_m, descent_m,
                                            elev_start_m, elev_end_m, profile_cm, dem_source, dem_resolution_m, geom_md5)
               SELECT $measuredStreet, 'measured', 'high', -0.04, 0.06, 0.09, 40, 10, 1.5, 5.5, 104.0, 100.0,
                      ARRAY[10400, 10250, 10150, 10050, 10000], 'usgs-3dep-10m', 10, md5(ST_AsBinary(geom))
               FROM street_edge
               WHERE street_edge_id = $measuredStreet""")
    val _ = run(sqlu"""INSERT INTO street_gradient (street_edge_id, quality, confidence, elev_start_m, elev_end_m,
                                                    dem_source, dem_resolution_m, geom_md5)
                       VALUES ($structureStreet, 'structure', 'high', 12.0, 12.5, 'spec-unregistered-dem', 10,
                               '0123456789abcdef0123456789abcdef')""")
  }

  override def afterAll(): Unit = {
    try {
      val _ = run(sqlu"DELETE FROM street_edge WHERE street_edge_id IN ($measuredStreet, $structureStreet)")
    } finally super.afterAll()
  }

  private def profileOf(streetEdgeId: Int): JsObject = {
    val resp = route(app, FakeRequest(GET, s"/v3/api/streetGrade?streetEdgeId=$streetEdgeId")).get
    status(resp) mustBe OK
    contentType(resp) mustBe Some("application/json")
    contentAsJson(resp).as[JsObject]
  }

  "GET /v3/api/streetGrade" should {
    "serve a measured street's statistics, its profile in meters at the spacing its length implies, and its credit" in {
      val json = profileOf(measuredStreet)

      (json \ "street_edge_id").as[Int] mustBe measuredStreet
      (json \ "mean_grade").as[Double] mustBe 0.06
      (json \ "net_grade").as[Double] mustBe -0.04
      (json \ "total_climb_meters").as[Double] mustBe 1.5
      (json \ "meters_over_5pct").as[Double] mustBe 40.0
      (json \ "grade_quality").as[String] mustBe "measured"
      (json \ "stale").as[Boolean] mustBe false
      (json \ "profile" \ "elevations_meters").as[Seq[Double]] mustBe Seq(104.0, 102.5, 101.5, 100.5, 100.0)
      // Five samples span the street, so four gaps: whatever the fixture street's geodesic length is, a quarter of it.
      (json \ "profile" \ "spacing_meters").as[Double] mustBe ((json \ "length_meters").as[Double] / 4 +- 1e-9)
      (json \ "attribution" \ "credit").as[String] must include("U.S. Geological Survey")
      json.toString must not include "streetEdgeId"
    }

    "answer 200 with profile: null for a structure, crediting an unregistered model by its name" in {
      val json = profileOf(structureStreet)

      (json \ "grade_quality").as[String] mustBe "structure"
      (json \ "profile").get mustBe JsNull
      (json \ "mean_grade").get mustBe JsNull
      (json \ "elev_start_meters").as[Double] mustBe 12.0
      (json \ "attribution" \ "credit").as[String] mustBe "Elevation: spec-unregistered-dem"
      // A hash that was never the street's: what a row left behind by an edited street looks like.
      (json \ "stale").as[Boolean] mustBe true
    }

    "answer 404 for a street that exists and has not been sampled" in {
      val unsampled = run(insertStreet())
      try {
        val resp = route(app, FakeRequest(GET, s"/v3/api/streetGrade?streetEdgeId=$unsampled")).get
        status(resp) mustBe NOT_FOUND
        (contentAsJson(resp) \ "detail").as[String] must include("has no gradient data")
      } finally { val _ = run(sqlu"DELETE FROM street_edge WHERE street_edge_id = $unsampled") }
    }
  }
}
