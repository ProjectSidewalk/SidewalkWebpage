package service

import models.api.{IntersectionAccessScoreForApi, StreetAccessScoreForApi}
import models.label.{CropMarker, LabelType}
import models.report.{ReportLabel, ReportLocation, ReportRules}
import org.locationtech.jts.geom.{Coordinate, GeometryFactory}
import org.scalatest.time.{Seconds, Span}
import org.scalatest.concurrent.ScalaFutures
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.SidewalkSpec

import java.time.{OffsetDateTime, ZoneOffset}

/**
 * ReportService's marker math, plus a whole report built against the connected database (#5876). What the database half
 * guards is the page's central promise: its numbers are AccessScore's, every label in the region is accounted for, and
 * what a street's row links to is behind that street's score.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class ReportServiceSpec extends SidewalkSpec with GuiceOneAppPerSuite with ScalaFutures {
  implicit override val patienceConfig: PatienceConfig = PatienceConfig(timeout = Span(120, Seconds))

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val service: ReportService = app.injector.instanceOf[ReportService]

  private def label(id: Int, edge: Int, canvasX: Option[Int] = None, canvasY: Option[Int] = None): ReportLabel =
    ReportLabel(id, LabelType.Obstacle, Some(3), Nil, edge, "u", "p", OffsetDateTime.now(ZoneOffset.UTC), None, 0, 0, 0,
      None, canvasX, canvasY, None, None)

  "markerFraction" must {
    "use the recorded position as is when the crop already has the frame's shape" in {
      val marker = CropMarker(0.25, 0.75, Some(720), Some(480))
      ReportService.markerFraction(label(1, 1), Some(marker)) mustBe ((0.25, 0.75))
    }

    "re-express the position in the visible part of a crop the frame trims" in {
      val wide     = CropMarker(0.5, 0.25, Some(960), Some(480))
      val (wx, wy) = ReportService.markerFraction(label(1, 1), Some(wide))
      wx mustBe 0.5
      wy mustBe 0.25
      val offCenter = CropMarker(0.75, 0.5, Some(960), Some(480))
      ReportService.markerFraction(label(1, 1), Some(offCenter))._1 mustBe (0.8333 +- 0.001)
      val tall = CropMarker(0.5, 0.75, Some(480), Some(480))
      ReportService.markerFraction(label(1, 1), Some(tall))._2 mustBe 0.875
    }

    "fall back to the canvas fraction without a row, and to the center without a position" in {
      ReportService.markerFraction(label(1, 1, Some(180), Some(120)), None) mustBe ((0.25, 0.25))
      ReportService.markerFraction(label(1, 1), None) mustBe ((0.5, 0.5))
    }

    "keep the marker on the photo when a position falls outside it" in {
      ReportService.markerFraction(label(1, 1, Some(9000), Some(-40)), None) mustBe ((1.0, 0.0))
      val trimmedAway = CropMarker(0.01, 0.5, Some(1440), Some(480))
      ReportService.markerFraction(label(1, 1), Some(trimmedAway))._1 mustBe 0.0
    }
  }

  "neighborhoodReport" must {
    "say so for a region that doesn't exist" in {
      service.neighborhoodReport(Int.MaxValue).futureValue mustBe ReportOutcome.RegionNotFound
    }

    "agree with AccessScore and account for every counted label in the busiest region" in {
      val apiService   = app.injector.instanceOf[ApiService]
      val accessScores = app.injector.instanceOf[AccessScoreService]
      apiService.getRegionWithMostLabels.futureValue.foreach { region =>
        val report = service.neighborhoodReport(region.regionId).futureValue match {
          case ReportOutcome.Ready(ready) => ready
          case other                      => fail(s"Expected a report, got $other")
        }
        val counted = report.coverage.observationIds.toSet

        val published = accessScores.getFullCityRegionScores(5000).futureValue.toSeq.flatten
        report.score.score.foreach { score =>
          published.find(_.regionId == region.regionId).flatMap(_.score).foreach(_ mustBe (score +- 1e-9))
        }

        // The inventory divides the same labels by type, so its rows sum to the coverage's count.
        report.inventory.flatMap(_.observedIds) must contain theSameElementsAs report.coverage.observationIds
        report.coverage.excludedIds.toSet.intersect(counted) mustBe empty

        // A row's linked counts are exactly its stretch's locations, and each photo is a label behind one of them.
        report.streets.foreach { row =>
          val locations = row.street.worst.locations
          row.evidence.map(_.locations).sum mustBe locations.size
          row.evidence.flatMap(_.labelIds) must contain theSameElementsAs locations.flatMap(_.labelIds)
          row.photos.map(_.label.labelId).toSet.subsetOf(locations.flatMap(_.labelIds).toSet) mustBe true
          row.photos.size must be <= ReportService.PhotosPerStreet
          row.street.worst.isRanked mustBe true
          row.street.worst.score must be < AccessScoreSpotlight.LowestMaxScore
        }

        report.streets.size must be <= ReportService.TopStreets
        report.streets.map(_.rank) mustBe report.streets.indices.map(_ + 1)
        report.streets.map(_.street.worst.score) mustBe report.streets.map(_.street.worst.score).sorted

        report.fixes.size must be <= ReportService.FixListSize
        report.fixes.map(_.street.worst.osmWayId).distinct.size mustBe report.fixes.size
        report.fixes.foreach { fix =>
          fix.item.costPoints must be >= ReportRules.FixMinPoints
          fix.item.labelIds must contain(fix.photo.label.labelId)
          fix.photo.label.uncontested mustBe true
        }
      }
    }
  }

  "evidenceBox" must {
    "take in every street and reach past the attribution radius, or be empty with no streets" in {
      val gf                                                    = GeometryFactory()
      def street(x: Double, y: Double): StreetAccessScoreForApi = StreetAccessScoreForApi(
        1,
        1L,
        None,
        1,
        None,
        None,
        None,
        None,
        None,
        None,
        0,
        100.0,
        0,
        Map.empty,
        Map.empty,
        Map.empty,
        Map.empty,
        None,
        0.0,
        gf.createLineString(Array(Coordinate(x, y), Coordinate(x + 0.001, y + 0.001)))
      )
      ReportService.evidenceBox(Seq.empty) mustBe None
      val box    = ReportService.evidenceBox(Seq(street(-122.3, 47.6), street(-122.2, 47.7))).get
      val radius = AccessScoreCalculator.attributionRadiusMeters / 111320.0
      box.minLat must be < 47.6 - radius
      box.maxLat must be > 47.701 + radius
      box.minLng must be < -122.3 - radius
      box.maxLng must be > -122.199 + radius
    }
  }

  "regionLocations" must {
    "take a block's locations from the region's streets and a crossing's wherever they were labeled" in {
      def loc(id: Int, edge: Int, crossing: Option[Int]) =
        ReportLocation(id, LabelType.Obstacle, Some(3), edge, crossing, Seq(id), Map.empty, 47.6, -122.3)
      val gf     = GeometryFactory()
      val line   = gf.createLineString(Array(Coordinate(-122.3, 47.6), Coordinate(-122.2, 47.7)))
      val street = StreetAccessScoreForApi(
        1, 1L, None, 7, None, None, None, None, None, None, 0, 100.0, 0, Map.empty, Map.empty, Map.empty, Map.empty,
        None, 0.0, line
      )
      def intersection(id: Int, region: Int, gradeSeparated: Boolean = false) = IntersectionAccessScoreForApi(
        id,
        Some(region),
        3,
        gradeSeparated,
        Seq.empty,
        1,
        Some(0.5),
        0,
        Map.empty,
        Map.empty,
        Map.empty,
        Map.empty,
        gf.createPoint(Coordinate(-122.3, 47.6))
      )
      val all = Seq(
        loc(1, 1, None),      // Along one of the region's blocks.
        loc(2, 99, None),     // Along a neighbor's block.
        loc(3, 99, Some(50)), // At one of the region's crossings, labeled from next door.
        loc(4, 1, Some(60)),  // On the region's street, at a crossing the neighbor's score counts.
        loc(5, 1, Some(70))   // At a bridge, which no score counts.
      )
      val intersections = Seq(intersection(50, 7), intersection(60, 8), intersection(70, 7, gradeSeparated = true))
      ReportService.regionLocations(all, Seq(street), intersections, 7).map(_.clusterId) mustBe Seq(1, 3)
    }
  }
}
