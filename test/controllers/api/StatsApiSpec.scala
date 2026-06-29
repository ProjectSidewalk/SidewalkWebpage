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
}
