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
 * Locks the response contract of GET /v3/api/validations after the validation_option enum migration (#4263):
 * a JSON array whose objects carry snake_case keys including a STRING `validation_result` ("Agree"/"Disagree"/"Unsure")
 * with no `validation_result_string`, plus 400 INVALID_PARAMETER for an unknown validationResult or a shapefile
 * filetype. Asserts shape, not data values.
 *
 * Boots the real application (real Slick/PostGIS) and exercises the route end to end. The endpoint is a
 * `UserAwareAction` (no auth needed) and makes no external WS calls on the request path. The eager scheduling actors
 * are disabled so they don't fire background DB/WS work during the test.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class ValidationsApiContractSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .build()

  // File-streamed responses (chunked JSON) need a real Materializer to consume; the test default is NoMaterializer,
  // which only works for strict bodies like JSON.
  implicit lazy val mat: Materializer = app.materializer

  private val validResults = Set("Agree", "Disagree", "Unsure")

  "GET /v3/api/validations" should {
    "return 200 with a JSON array of validation objects using snake_case keys" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/validations")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val arr = contentAsJson(resp).as[Seq[JsObject]]

      // Only assert the per-element contract when the DB actually has validations; an empty DB yields an empty array.
      arr.headOption.foreach { v =>
        (v \ "label_validation_id").asOpt[Int] mustBe defined
        (v \ "label_id").asOpt[Int] mustBe defined
        (v \ "label_type").asOpt[String] mustBe defined
        (v \ "user_id").asOpt[String] mustBe defined

        // #4263: validation_result is now a STRING enum value, and validation_result_string was removed.
        validResults must contain((v \ "validation_result").as[String])
        (v \ "validation_result_string").toOption mustBe None

        // Sanity-check that snake_case (not camelCase) keys are emitted.
        (v \ "labelValidationId").toOption mustBe None
        (v \ "validationResult").toOption mustBe None
      }
    }

    "filter without error for a valid validationResult and keep the array contract" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/validations?validationResult=Agree")).get
      status(resp) mustBe OK
      val arr = contentAsJson(resp).as[Seq[JsObject]]
      arr.foreach { v => (v \ "validation_result").as[String] mustBe "Agree" }
    }

    "return 400 INVALID_PARAMETER (parameter=validationResult) for an unknown validationResult" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/validations?validationResult=Banana")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "validationResult"
    }

    "return 400 INVALID_PARAMETER (parameter=filetype) for an unsupported shapefile filetype" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/validations?filetype=shapefile")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "filetype"
    }
  }
}
