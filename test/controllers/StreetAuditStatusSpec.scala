package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsValue
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Contract test for the street layer feed behind LabelMap and the admin maps (#4384).
 *
 * Streets carry a three-state audit status as two boolean GeoJSON properties: `audited` (has a completed audit on
 * current imagery) and `outdated` (audited before, but every audit predates newer imagery). The states are mutually
 * exclusive; a street with neither is unaudited. Requires a Postgres+PostGIS database, like the API specs.
 */
class StreetAuditStatusSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  "GET /contribution/streets/all" should {
    "expose boolean audited and outdated properties on every feature, never both true" in {
      val resp = route(app, FakeRequest(GET, "/contribution/streets/all?filterLowQuality=true")).get
      status(resp) mustBe OK

      val json     = contentAsJson(resp)
      val features = (json \ "features").as[Seq[JsValue]]
      features.foreach { feature =>
        val props    = feature \ "properties"
        val audited  = (props \ "audited").as[Boolean]
        val outdated = (props \ "outdated").as[Boolean]
        (audited && outdated) mustBe false
      }
    }
  }
}
