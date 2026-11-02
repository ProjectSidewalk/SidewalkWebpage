package controllers

import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.bind
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import service.{ApiService, ReportOutcome, ReportService}
import util.{SidewalkSpec, UserAgents}

import scala.concurrent.{Await, Future}
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
      contentAsString(resp) must include("report-overview-title")
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

    "put the inventory ahead of the fixes for a coordinator and behind them for an advocate" in {
      def order(body: String): Boolean = body.indexOf("report-inventory-title") < body.indexOf("report-punch-title")
      order(contentAsString(report("?preset=coordinator"))) mustBe true
      order(contentAsString(report("?preset=advocate"))) mustBe false
    }

    "never build a pano or a Mapbox map, so that viewing it costs no per-load charge" in {
      val body = contentAsString(report())
      body must not include "pano-viewer"
      body must not include "StreetViewPanorama"
      body must not include "mapboxgl"
    }

    "hand the browser what its maps and cards are drawn from" in {
      val body = contentAsString(report())
      body must include("""id="report-data"""")
      body must include("""id="report-region-map"""")
    }

    "leave the data that reproduces it one click away" in {
      val body = contentAsString(report())
      body must include(s"/v3/api/rawLabels?regionId=$regionId&amp;filetype=csv")
      body must include(s"/v3/api/accessScoreStreets?regionId=$regionId&amp;filetype=csv")
    }
  }
}

/**
 * While a city's AccessScores are being computed for the first time since a deploy, a report has nothing it can honestly
 * print, so its URL says so and says when to come back (#5418).
 */
class ReportControllerStillComputingSpec extends SidewalkSpec with GuiceOneAppPerSuite {
  private val computing: ReportService = (_: Int) => Future.successful(ReportOutcome.StillComputing)

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].overrides(bind[ReportService].toInstance(computing)).build()

  "GET /report/neighborhood/:regionId" must {
    "answer 503 with a page and a Retry-After, rather than a report with holes in it" in {
      val resp = route(app, FakeRequest(GET, "/report/neighborhood/1")).get
      status(resp) mustBe SERVICE_UNAVAILABLE
      header(RETRY_AFTER, resp) mustBe Some(ReportController.StillComputingRetryAfterSeconds.toString)
      contentType(resp) mustBe Some("text/html")
      contentAsString(resp) must include("report-title")
      contentAsString(resp) must not include "report-coverage-title"
    }
  }
}
