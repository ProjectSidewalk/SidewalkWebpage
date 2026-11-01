package controllers

import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import service.ApiService
import util.{SidewalkSpec, UserAgents}

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/**
 * The public contract of GET /report/neighborhood/:regionId (#5876): a report opens for someone with no session, on any
 * device, and a stale or mistyped link degrades rather than fails.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class ReportControllerSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val regionId: Int =
    Await
      .result(app.injector.instanceOf[ApiService].getRegionWithMostLabels, 60.seconds)
      .map(_.regionId)
      .getOrElse(cancel("The connected database has no labeled region."))

  private def report(query: String = "", headers: (String, String)*) =
    route(app, FakeRequest(GET, s"/report/neighborhood/$regionId$query").withHeaders(headers*)).get

  "GET /report/neighborhood/:regionId" must {
    "serve the page with no session at all" in {
      val resp = report()
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/html")
      contentAsString(resp) must include("report-coverage-title")
    }

    "state the screening limit on every report" in {
      val messages = app.injector.instanceOf[play.api.i18n.MessagesApi]
      val expected = messages("report.coverage.disclaimer")(using play.api.i18n.Lang("en"))
      play.twirl.api.HtmlFormat.raw(contentAsString(report())).body must include(
        play.twirl.api.HtmlFormat.escape(expected).body
      )
    }

    "be a 404 for a region that doesn't exist" in {
      status(route(app, FakeRequest(GET, s"/report/neighborhood/${Int.MaxValue}")).get) mustBe NOT_FOUND
    }

    "serve a mobile visitor the page rather than redirecting" in {
      status(report(headers = UserAgents.mobile)) mustBe OK
    }

    "render each preset, marking which is current, and treat an unknown one as the default" in {
      val coordinator = contentAsString(report("?preset=coordinator"))
      coordinator must include("""data-preset="coordinator"""")
      val unknown = report("?preset=nonsense")
      status(unknown) mustBe OK
      contentAsString(unknown) must include("""data-preset="advocate"""")
    }

    "put the inventory first for a coordinator and last for an advocate, with the same numbers" in {
      def order(body: String): Boolean = body.indexOf("report-inventory-title") < body.indexOf("report-streets-title")
      order(contentAsString(report("?preset=coordinator"))) mustBe true
      order(contentAsString(report("?preset=advocate"))) mustBe false
    }

    "never build a pano or a map, so that viewing it costs no billable Google call" in {
      val body = contentAsString(report())
      body must not include "pano-viewer"
      body must not include "StreetViewPanorama"
      body must not include "mapboxgl"
    }

    "leave the CSV of the labels it counts one click away" in {
      contentAsString(report()) must include(s"/v3/api/rawLabels?regionId=$regionId&amp;filetype=csv")
    }
  }
}
