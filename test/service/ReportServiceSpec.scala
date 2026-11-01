package service

import models.label.{CropMarker, LabelType}
import models.report.{RankingRule, ReportLabel}
import org.scalatest.time.{Seconds, Span}
import org.scalatest.concurrent.ScalaFutures
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.SidewalkSpec

import java.time.{OffsetDateTime, ZoneOffset}

/**
 * ReportService's grouping and marker math, plus a whole report built against the connected database (#5876). What the
 * database half guards is the page's central promise: every label in the region is accounted for, and what a street's
 * row links to is actually on that street.
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

  "groupStreets" must {
    "merge a road's edges under one name, whatever the case, and sum only their lengths" in {
      val streets = ReportService.groupStreets(
        Seq(label(1, 10), label(2, 11), label(3, 12), label(4, 13)),
        Map(10 -> "Washington Ave", 11 -> "WASHINGTON AVE", 12 -> "Henderson St"),
        Map(10 -> 100.0, 11            -> 50.0, 12             -> 25.0, 13 -> 5.0, 99 -> 1000.0)
      )
      streets.size mustBe 3
      val washington = streets.find(_.streetEdgeIds == Seq(10, 11)).get
      washington.name mustBe Some("Washington Ave")
      washington.lengthMeters mustBe 150.0
      washington.labels.map(_.labelId) must contain theSameElementsAs Seq(1, 2)
    }

    "keep unnamed edges apart, since nothing says they are one road" in {
      val streets = ReportService.groupStreets(Seq(label(1, 10), label(2, 11)), Map.empty, Map.empty)
      streets.map(_.streetEdgeIds) must contain theSameElementsAs Seq(Seq(10), Seq(11))
      streets.flatMap(_.name) mustBe empty
    }
  }

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
    "be None for a region that doesn't exist" in {
      service.neighborhoodReport(Int.MaxValue).futureValue mustBe None
    }

    "account for every counted label in the busiest region, on the street it belongs to" in {
      val apiService = app.injector.instanceOf[ApiService]
      apiService.getRegionWithMostLabels.futureValue.foreach { region =>
        val report  = service.neighborhoodReport(region.regionId).futureValue.get
        val counted = report.coverage.observationIds.toSet

        // The inventory divides the same labels by type, so its rows sum to the coverage's count.
        report.inventory.flatMap(_.observedIds) must contain theSameElementsAs report.coverage.observationIds
        report.coverage.excludedIds.toSet.intersect(counted) mustBe empty

        // A row's linked counts are exactly its street's labels, and every photo shown is one of them.
        report.streets.foreach { row =>
          val streetIds = row.street.labels.map(_.labelId)
          row.typeIds.flatMap(_._2) must contain theSameElementsAs streetIds
          row.photos.map(_.label.labelId).toSet.subsetOf(streetIds.toSet) mustBe true
          row.street.labels.map(_.streetEdgeId).toSet.subsetOf(row.street.streetEdgeIds.toSet) mustBe true
          row.score mustBe RankingRule.streetScore(row.street.labels)
          row.photos.size must be <= ReportService.PhotosPerStreet
        }

        report.streets.size must be <= ReportService.TopStreets
        report.streets.map(_.rank) mustBe report.streets.indices.map(_ + 1)
        report.streets.map(_.score) mustBe report.streets.map(_.score).sorted(using Ordering[Int].reverse)

        report.punchList.size must be <= ReportService.PunchListSize
        report.punchList.map(_._1.streetEdgeIds).distinct.size mustBe report.punchList.size
        report.punchList.foreach { case (street, photo) =>
          street.labels.map(_.labelId) must contain(photo.label.labelId)
          RankingRule.isWorst(photo.label) mustBe true
          photo.label.humanAgree must be > 0
          photo.label.humanDisagree mustBe 0
        }
      }
    }
  }
}
