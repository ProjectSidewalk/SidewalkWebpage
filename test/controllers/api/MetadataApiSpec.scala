package controllers.api

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsObject
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * In-JVM functional tests for the metadata endpoints' output contract (labelTypes, labelTags, streetTypes, cities).
 *
 * Locks the v3 naming convention (#3871): all JSON output — envelope keys, item field names, and nested objects — is
 * snake_case. These endpoints previously emitted camelCase envelope keys (`labelTypes`) and item fields (`iconUrl`,
 * `cityId`, ...) via Play's default `Json.format` macro; the normalization is guarded here.
 */
class MetadataApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  "GET /v3/api/labelTypes" should {
    "use a snake_case envelope key and snake_case item fields" in {
      val json = contentAsJson(route(app, FakeRequest(GET, "/v3/api/labelTypes")).get)

      (json \ "label_types").asOpt[Seq[JsObject]] mustBe defined
      (json \ "labelTypes").toOption mustBe None // old camelCase envelope gone

      val first = (json \ "label_types" \ 0).as[JsObject]
      (first \ "icon_url").asOpt[String] mustBe defined
      (first \ "is_primary").asOpt[Boolean] mustBe defined
      (first \ "iconUrl").toOption mustBe None
      (first \ "isPrimary").toOption mustBe None
    }
  }

  "GET /v3/api/cities" should {
    "use snake_case city field names" in {
      val json  = contentAsJson(route(app, FakeRequest(GET, "/v3/api/cities")).get)
      val first = (json \ "cities" \ 0).as[JsObject]

      (first \ "city_id").asOpt[String] mustBe defined
      (first \ "city_name_short").asOpt[String] mustBe defined
      (first \ "cityId").toOption mustBe None
      (first \ "cityNameShort").toOption mustBe None
    }
  }
}
