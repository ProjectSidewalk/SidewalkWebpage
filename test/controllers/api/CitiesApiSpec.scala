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
 * Contract tests for GET /v3/api/cities.
 *
 * Locks the response shape for all three output formats (JSON, CSV, GeoJSON) and verifies that
 * errors use the standard ApiError envelope. Boots the real application (real Slick/PostGIS) and
 * exercises the route end to end. The endpoint is UserAwareAction (no auth needed). The eager
 * scheduling actors are disabled so they don't fire background DB/WS work during tests.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class CitiesApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  implicit lazy val mat: Materializer = app.materializer

  /** Splits a CSV row on commas outside quotes, so a quoted city name like "Washington, DC" stays one cell. */
  private def splitCsvRow(row: String): Seq[String] = {
    val cells    = scala.collection.mutable.ListBuffer.empty[String]
    val cell     = new StringBuilder
    var inQuotes = false
    row.foreach {
      case '"'              => inQuotes = !inQuotes
      case ',' if !inQuotes => cells += cell.toString; cell.clear()
      case c                => cell += c
    }
    (cells += cell.toString).toSeq
  }

  "GET /v3/api/cities (default JSON)" should {
    "return 200 with the {status, cities:[...]} envelope" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/cities")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/json")

      val json = contentAsJson(resp)
      (json \ "status").as[String] mustBe "OK"
      (json \ "cities").asOpt[Seq[JsObject]] mustBe defined
    }

    "include snake_case fields in each city object" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/cities")).get
      status(resp) mustBe OK

      val cities = (contentAsJson(resp) \ "cities").as[Seq[JsObject]]
      // The endpoint may have 0 cities if DB is empty, so only assert shape when data is present.
      cities.headOption.foreach { city =>
        (city \ "city_id").asOpt[String] mustBe defined
        (city \ "city_name_short").asOpt[String] mustBe defined
        (city \ "city_name_formatted").asOpt[String] mustBe defined
        // camelCase keys must not appear in the output per v3 naming convention (#3871).
        (city \ "cityId").toOption mustBe None
        (city \ "cityNameShort").toOption mustBe None
      }
    }
  }

  "GET /v3/api/cities" should {
    "publish a url for public cities and null for every other visibility" in {
      // These deployments are research partnerships and internal UW studies. /cities is in the sitemap and the map
      // component it loads fetches this endpoint client-side, so a url here is a url a crawler follows (#5259).
      val cities = (contentAsJson(route(app, FakeRequest(GET, "/v3/api/cities")).get) \ "cities").as[Seq[JsObject]]
      cities.count(c => (c \ "visibility").as[String] != "public") must be > 0
      cities.foreach { city =>
        val cityId: String = (city \ "city_id").as[String]
        withClue(s"$cityId: ") {
          // The key stays present either way, so response shape and CSV column layout don't change.
          (city \ "url").toOption mustBe defined
          if ((city \ "visibility").as[String] == "public") (city \ "url").as[String] must startWith("http")
          else (city \ "url").get mustBe play.api.libs.json.JsNull
        }
      }
    }

    "render the withheld url as an empty CSV cell, not the literal \"null\"" in {
      val body    = contentAsString(route(app, FakeRequest(GET, "/v3/api/cities?filetype=csv")).get)
      val lines   = body.split("\n").toSeq.filter(_.nonEmpty)
      val headers = splitCsvRow(lines.head)
      val urlCol  = headers.indexOf("url")
      val visCol  = headers.indexOf("visibility")
      urlCol must be >= 0
      lines.tail.foreach { row =>
        val cells = splitCsvRow(row)
        withClue(s"${cells.head}: ") {
          if (cells(visCol) == "public") cells(urlCol) must startWith("http")
          else cells(urlCol) mustBe ""
        }
      }
    }

    "withhold the url in GeoJSON properties too" in {
      val json     = contentAsJson(route(app, FakeRequest(GET, "/v3/api/cities?filetype=geojson")).get)
      val features = (json \ "features").as[Seq[JsObject]]
      features.map(f => (f \ "properties").as[JsObject]).foreach { props =>
        if ((props \ "visibility").as[String] == "public") (props \ "url").as[String] must startWith("http")
        else (props \ "url").get mustBe play.api.libs.json.JsNull
      }
    }

    "keep publishing the non-url fields for a private city, so counts and geometry still work" in {
      val cities   = (contentAsJson(route(app, FakeRequest(GET, "/v3/api/cities")).get) \ "cities").as[Seq[JsObject]]
      val private_ = cities.filter(c => (c \ "visibility").as[String] != "public")
      private_.foreach { city =>
        (city \ "city_id").asOpt[String] mustBe defined
        (city \ "city_name_formatted").asOpt[String] mustBe defined
        (city \ "visibility").asOpt[String] mustBe defined
      }
    }
  }

  "GET /v3/api/cities?filetype=csv" should {
    "return 200 CSV with the documented snake_case header" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/cities?filetype=csv")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/csv")

      val body = contentAsString(resp)
      body must include("city_id,country_id,city_name_short,city_name_formatted,url,visibility")
      // camelCase headers must not appear.
      body must not include "cityId"
      body must not include "cityNameShort"
    }
  }

  "GET /v3/api/cities?filetype=geojson" should {
    "return 200 GeoJSON FeatureCollection" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/cities?filetype=geojson")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/geo+json")

      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      (json \ "features").asOpt[Seq[JsObject]] mustBe defined
    }

    "include Point geometry with [lng, lat] coordinate order for cities that have coordinates" in {
      val resp     = route(app, FakeRequest(GET, "/v3/api/cities?filetype=geojson")).get
      val features = (contentAsJson(resp) \ "features").as[Seq[JsObject]]

      features.headOption.foreach { feature =>
        (feature \ "type").as[String] mustBe "Feature"
        (feature \ "geometry" \ "type").as[String] mustBe "Point"
        // GeoJSON coordinate order is [longitude, latitude]; the array must have exactly 2 elements.
        val coords = (feature \ "geometry" \ "coordinates").as[Seq[Double]]
        coords must have length 2
      }
    }
  }
}
