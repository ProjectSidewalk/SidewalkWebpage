package controllers

import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.bind
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import models.api.StreetAccessScoreForApi
import models.region.NamedRegionCompletion
import models.report.{CityReport, CoverageTally}
import org.locationtech.jts.geom.{Coordinate, GeometryFactory}
import service.{AccessScoreWeights, AccessScores, ApiService, ReportOutcome, ReportService}
import util.{SidewalkSpec, UserAgents}

import java.time.{OffsetDateTime, ZoneOffset}

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

  private lazy val slug: String =
    Await.result(app.injector.instanceOf[ReportService].regionSlugs, 60.seconds)(regionId)

  private def report(query: String = "", headers: (String, String)*) =
    route(app, FakeRequest(GET, s"/report/neighborhood/$slug$query").withHeaders(headers*)).get

  "GET /report/neighborhood/:key" must {
    "send an id, or a slug in other letter case, to the one slug address, weights and all" in {
      val byId = route(app, FakeRequest(GET, s"/report/neighborhood/$regionId?w=NoCurbRamp:3")).get
      // Temporary, since a rename moves the slug and a browser would keep a permanent one.
      status(byId) mustBe FOUND
      redirectLocation(byId) mustBe Some(s"/report/neighborhood/$slug?w=NoCurbRamp:3")
      val upper = route(app, FakeRequest(GET, s"/report/neighborhood/${slug.toUpperCase}")).get
      status(upper) mustBe MOVED_PERMANENTLY
      redirectLocation(upper) mustBe Some(s"/report/neighborhood/$slug")
    }

    "be a 404 for a name no region has" in {
      status(route(app, FakeRequest(GET, "/report/neighborhood/no-such-neighborhood")).get) mustBe NOT_FOUND
    }

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

    "score the whole report under a link's weights, and say so" in {
      contentAsString(report()) must not include "report-custom-stamp"
      val custom = contentAsString(report("?w=NoCurbRamp:3,CurbRamp:0&gs=w:0"))
      custom must include("report-custom-stamp")
      custom must include("&amp;w=CurbRamp:0,NoCurbRamp:3")
    }

    "read a malformed weights link as the engine's own rather than failing" in {
      val resp = report("?w=NoCurbRamp:lots,Nonsense:2,&gs=w:")
      status(resp) mustBe OK
      contentAsString(resp) must not include "report-custom-stamp"
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
      // The worst-problems section is always there, as a map with its dots or as its empty state.
      body must include("""id="report-worst-title"""")
      body must include("\"worst\":[")
    }

    "lead back to the city's list of neighborhoods" in {
      contentAsString(report()) must include("""href="/reports" data-report-event="Report_OpenCity"""")
    }

    "leave the data that reproduces it one click away" in {
      val body = contentAsString(report())
      body must include(s"/v3/api/rawLabels?regionId=$regionId&amp;filetype=csv")
      body must include(s"/v3/api/accessScoreStreets?regionId=$regionId&amp;filetype=csv")
    }
  }
}

/**
 * The public contract of GET /reports (#6041): the city's page of neighborhood reports opens for anyone on any device,
 * leads to every neighborhood's report, and is reached from the Tools menu on phones too.
 */
class CityReportControllerSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val slugs: Map[Int, String] =
    Await.result(app.injector.instanceOf[ReportService].regionSlugs, 60.seconds)

  private def reports(headers: (String, String)*) = route(app, FakeRequest(GET, "/reports").withHeaders(headers*)).get

  "GET /reports" must {
    "serve the page with no session, linking every neighborhood's report, with its menu item" in {
      val resp = reports()
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/html")
      val body = contentAsString(resp)
      if (slugs.isEmpty) cancel("The connected database has no region.")
      slugs.values.foreach(slug => body must include(s"""href="/report/neighborhood/$slug""""))
      body must include("""id="navbar-reports-btn"""")
      body must include("""id="reports-data"""")
      // The menu marks the page it is on.
      body must include("""id="navbar-reports-btn" href="/reports" class="is-active" aria-current="page"""")
    }

    "serve a phone the page and the menu item rather than redirecting" in {
      val resp = reports(UserAgents.mobile)
      status(resp) mustBe OK
      contentAsString(resp) must include("""id="navbar-reports-btn"""")
    }

    "never build a pano or a Mapbox map, so that viewing it costs no per-load charge" in {
      val body = contentAsString(reports())
      body must not include "pano-viewer"
      body must not include "StreetViewPanorama"
      body must not include "mapboxgl"
    }
  }

  "The Reports menu item" must {
    "be on other pages too, unmarked there" in {
      val body = contentAsString(route(app, FakeRequest(GET, "/leaderboard")).get)
      body must include("""id="navbar-reports-btn" href="/reports">""")
    }
  }
}

/**
 * While a city's AccessScores are being computed for the first time since a deploy, a report has nothing it can honestly
 * print, so its URL says so and says when to come back (#5418).
 */
class ReportControllerStillComputingSpec extends SidewalkSpec with GuiceOneAppPerSuite {
  private val now  = OffsetDateTime.of(2026, 11, 26, 12, 0, 0, 0, ZoneOffset.UTC)
  private val line = GeometryFactory().createLineString(Array(Coordinate(-122.3, 47.6), Coordinate(-122.31, 47.61)))

  /** A city of one neighborhood, explored past the floor, with a street scoring 0.42. */
  private val scores = AccessScores(
    Seq(
      StreetAccessScoreForApi(
        1,
        1L,
        Some("A St"),
        1,
        Some(0.42),
        Some(0.42),
        None,
        None,
        None,
        None,
        1,
        100.0,
        0,
        Map.empty,
        Map("NoCurbRamp" -> -0.5),
        Map.empty,
        Map.empty,
        None,
        0.0,
        line
      )
    ),
    Seq.empty
  )

  private def city(scores: Option[AccessScores], tallies: Option[Map[Int, CoverageTally]]): CityReport =
    CityReport.build(
      Seq(1 -> "A Neighborhood"),
      Map(1 -> "a-neighborhood"),
      Seq(NamedRegionCompletion(1, "A Neighborhood", 1000, 900)),
      scores,
      tallies,
      now
    )

  @volatile private var cityPage: CityReport = city(None, None)

  private val computing: ReportService = new ReportService {
    def neighborhoodReport(regionId: Int, weights: AccessScoreWeights) = Future.successful(ReportOutcome.StillComputing)
    def regionSlugs                                                    = Future.successful(Map(1 -> "a-neighborhood"))
    def cityReport                                                     = Future.successful(cityPage)
  }

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].overrides(bind[ReportService].toInstance(computing)).build()

  "GET /report/neighborhood/:key" must {
    "answer 503 with a page and a Retry-After, rather than a report with holes in it" in {
      val resp = route(app, FakeRequest(GET, "/report/neighborhood/a-neighborhood")).get
      status(resp) mustBe SERVICE_UNAVAILABLE
      header(RETRY_AFTER, resp) mustBe Some(ReportController.StillComputingRetryAfterSeconds.toString)
      contentType(resp) mustBe Some("text/html")
      contentAsString(resp) must include("report-title")
      contentAsString(resp) must not include "report-coverage-title"
    }
  }

  "GET /reports" must {
    "list the neighborhoods and link their reports without a score while the scores are being computed" in {
      cityPage = city(None, Some(Map.empty))
      val resp = route(app, FakeRequest(GET, "/reports")).get
      status(resp) mustBe OK
      val body = contentAsString(resp)
      body must include("""id="reports-scores-computing"""")
      body must include("""href="/report/neighborhood/a-neighborhood"""")
      body must include("A Neighborhood")
      body must not include "reports-score__value"
      body must not include "42.0"
      body must not include "reports-summary"
      body must not include "reports-quality-computing"
    }

    "print the scores, and say the quality columns are still being counted, while the label tally is" in {
      cityPage = city(Some(scores), None)
      val resp = route(app, FakeRequest(GET, "/reports")).get
      status(resp) mustBe OK
      val body = contentAsString(resp)
      body must include("reports-score__value")
      body must include("42.0")
      body must include("""id="reports-quality-computing"""")
      body must not include "reports-quality__value"
      body must not include "reports-scores-computing"
    }
  }
}
