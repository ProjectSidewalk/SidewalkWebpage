package controllers.api

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsObject, JsValue}
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * In-JVM functional tests for the stats endpoints' output contract. Boots the real app (no auth needed — these are
 * `UserAwareAction`) and asserts response shape, not data values, so it is robust to whatever the test DB contains.
 *
 * Locks the v3 naming convention (#3871): all JSON output field names are snake_case. `aggregateStats` was the lone
 * endpoint emitting camelCase keys (built to match the frontend aggregator); this guards the normalization.
 */
class StatsApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  "GET /v3/api/aggregateStats" should {
    "return 200 JSON with snake_case top-level keys (not camelCase)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/aggregateStats")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "status").as[String] mustBe "OK"
      (json \ "km_explored").asOpt[Double] mustBe defined
      (json \ "total_labels").asOpt[Long] mustBe defined
      (json \ "tutorial_labels").asOpt[Long] mustBe defined
      (json \ "total_users").asOpt[Long] mustBe defined
      (json \ "num_cities").asOpt[Int] mustBe defined
      (json \ "by_label_type").asOpt[JsObject] mustBe defined

      // The pre-normalization camelCase keys must be gone.
      (json \ "kmExplored").toOption mustBe None
      (json \ "totalLabels").toOption mustBe None
      (json \ "byLabelType").toOption mustBe None
    }

    // The CSV export must expose total_users too (#3976) — field changes need coverage in every output format, not
    // just JSON, since the formats are serialized independently.
    "include a total_users row in the CSV export" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/aggregateStats?filetype=csv")).get
      status(resp) mustBe OK
      val body = contentAsString(resp)
      body must include("metric,value")
      body.linesIterator.exists(_.startsWith("total_users,")) mustBe true
    }

    // Regression guard for #3981: the per-label-type breakdown must reconcile with the headline total. This held only
    // for overallStats before; aggregateStats derived the two from differently-filtered queries (and a legacy DC
    // constant whose total didn't match its own breakdown), so they drifted. Data-independent: holds for any test DB.
    "report total_labels equal to the sum of by_label_type label counts" in {
      val json          = contentAsJson(route(app, FakeRequest(GET, "/v3/api/aggregateStats")).get)
      val totalLabels   = (json \ "total_labels").as[Long]
      val byLabelType   = (json \ "by_label_type").as[JsObject]
      val perTypeLabels = byLabelType.values.map { (lt: JsValue) => (lt \ "labels").as[Long] }.sum

      perTypeLabels mustBe totalLabels
    }
  }

  "GET /v3/api/overallStats" should {
    "return 200 JSON exposing the km-by-status and redundant-coverage fields (#3080)" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/overallStats")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "km_explored_multiple_users").asOpt[Double] mustBe defined
      (json \ "km_explored_single_user").asOpt[Double] mustBe defined
      (json \ "km_explorable").asOpt[Double] mustBe defined
      (json \ "km_by_status" \ "open").asOpt[Double] mustBe defined
      (json \ "km_by_status" \ "no_imagery").asOpt[Double] mustBe defined
      (json \ "km_by_status" \ "closed").asOpt[Double] mustBe defined
      (json \ "km_by_status" \ "disabled").asOpt[Double] mustBe defined

      // #3080 ask #1 ("labels with at least one validation") is surfaced as the Overall rollup of has_a_validation.
      (json \ "validations" \ "combined" \ "Overall" \ "has_a_validation").asOpt[Long] mustBe defined
    }

    // Data-independent invariants: hold for any test DB contents.
    "reconcile single + multiple user km with no-overlap km, and alias km_explorable to km_by_status.open" in {
      val json       = contentAsJson(route(app, FakeRequest(GET, "/v3/api/overallStats")).get)
      val noOverlap  = (json \ "km_explored_no_overlap").as[Double]
      val multiple   = (json \ "km_explored_multiple_users").as[Double]
      val single     = (json \ "km_explored_single_user").as[Double]
      val explorable = (json \ "km_explorable").as[Double]
      val open       = (json \ "km_by_status" \ "open").as[Double]

      // single + multiple == no_overlap (single is derived as no_overlap − multiple), and multiple ≤ no_overlap.
      (single + multiple) mustBe (noOverlap +- 0.001)
      multiple must be <= (noOverlap + 0.001)
      // km_explorable is an alias of the open bucket. NOTE: we deliberately do NOT assert noOverlap ≤ explorable —
      // a street can be audited and later become closed/no_imagery, so explored can exceed the auditable-now network.
      explorable mustBe (open +- 0.001)
    }

    "return 200 CSV containing the new km rows" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/overallStats?filetype=csv")).get
      status(resp) mustBe OK
      val body = contentAsString(resp)
      Seq(
        "km_explored_multiple_users", "km_explored_single_user", "km_explorable", "km_open", "km_no_imagery",
        "km_closed", "km_disabled"
      ).foreach(key => body must include(key))
    }
  }
}
