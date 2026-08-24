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
 * Locks the response contract of GET /v3/api/labelEdits (#2575): a JSON array of snake_case edit objects carrying the
 * before/after severity and tags, a CSV whose header matches the JSON field order, and 400 INVALID_PARAMETER for an
 * unknown source, a malformed timestamp, or a spatial filetype. Asserts shape, not data values.
 *
 * Boots the real application against Postgres; the endpoint is a `UserAwareAction`, so no session is needed.
 */
class LabelEditsApiContractSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  // File-streamed responses (chunked JSON/CSV) need a real Materializer to consume.
  implicit lazy val mat: Materializer = app.materializer

  "GET /v3/api/labelEdits" should {
    "return 200 with a JSON array of edit objects using snake_case keys" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/labelEdits")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val arr = contentAsJson(resp).as[Seq[JsObject]]
      // The per-element contract is only checkable when the schema holds edits; an empty schema yields [].
      arr.headOption.foreach { e =>
        (e \ "label_edit_id").asOpt[Int] mustBe defined
        (e \ "label_id").asOpt[Int] mustBe defined
        (e \ "label_type").asOpt[String] mustBe defined
        (e \ "user_id").asOpt[String] mustBe defined
        (e \ "old_tags").asOpt[Seq[String]] mustBe defined
        (e \ "new_tags").asOpt[Seq[String]] mustBe defined
        (e \ "source").asOpt[String] mustBe defined
        (e \ "edit_time").asOpt[String] mustBe defined
        e.keys must contain("label_validation_id")
        (e \ "labelEditId").toOption mustBe None
      }
    }

    "return CSV whose header lists the JSON fields in order" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/labelEdits?filetype=csv")).get
      status(resp) mustBe OK
      contentAsString(resp).linesIterator.next() mustBe
        "label_edit_id,label_id,label_type_id,label_type,user_id,old_severity,new_severity,old_tags,new_tags," +
        "source,edit_time,label_validation_id"
    }

    "filter by a valid source and return only that source" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/labelEdits?source=Validate")).get
      status(resp) mustBe OK
      contentAsJson(resp).as[Seq[JsObject]].foreach { e => (e \ "source").as[String] mustBe "Validate" }
    }

    "filter to edits with or without a validation" in {
      val linked = route(app, FakeRequest(GET, "/v3/api/labelEdits?withValidation=true")).get
      status(linked) mustBe OK
      contentAsJson(linked).as[Seq[JsObject]].foreach { e => (e \ "label_validation_id").asOpt[Int] mustBe defined }

      val standalone = route(app, FakeRequest(GET, "/v3/api/labelEdits?withValidation=false")).get
      status(standalone) mustBe OK
      contentAsJson(standalone).as[Seq[JsObject]].foreach { e => (e \ "label_validation_id").asOpt[Int] mustBe None }
    }

    "return 400 INVALID_PARAMETER (parameter=source) for an unknown source" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/labelEdits?source=NotARealInterface")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "source"
    }

    "return 400 INVALID_PARAMETER (parameter=editTimestamp) for a malformed timestamp" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/labelEdits?editTimestamp=yesterday")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "editTimestamp"
    }

    "return 400 INVALID_PARAMETER (parameter=filetype) for a spatial filetype" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/labelEdits?filetype=shapefile")).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "parameter").as[String] mustBe "filetype"
    }
  }
}
