package models.api

import models.street._
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsNull, JsObject}

import java.time.OffsetDateTime

/**
 * The JSON of the street gradient API models (#5223): pure serialization, no database.
 *
 * What is pinned here is what a client cannot work out for itself: that the profile is served in meters at a stated
 * spacing, that a street with no profile says `null` and not an empty list, and that an elevation model nobody has
 * registered is still credited by name.
 */
class StreetGradientApiModelsSpec extends PlaySpec {

  private def stats(quality: StreetGradientQuality.Value, measured: Boolean, demSource: String = "usgs-3dep-10m") =
    StreetGradientStats(
      streetEdgeId = 7,
      quality = quality,
      confidence = StreetGradientConfidence.High,
      netGrade = if (measured) Some(-0.04) else None,
      meanGrade = if (measured) Some(0.06) else None,
      maxGrade = if (measured) Some(0.09) else None,
      metersOver5pctGrade = if (measured) Some(40.0) else None,
      metersOver8pctGrade = if (measured) Some(10.0) else None,
      climbM = if (measured) Some(1.5) else None,
      descentM = if (measured) Some(5.5) else None,
      elevStartM = Some(104.0),
      elevEndM = Some(100.0),
      demSource = demSource,
      demResolutionM = 10.0
    )

  private val sampledAt = OffsetDateTime.parse("2026-09-19T12:00:00Z")

  "StreetGradeForApi.toJson" should {
    "serve the profile in meters with the spacing its length implies" in {
      val row = StreetGradient(
        stats(StreetGradientQuality.Measured, measured = true),
        Some(List(10400, 10150, 10000)),
        "0" * 32,
        sampledAt,
        maxGradeFromM = Some(20.0),
        maxGradeToM = Some(50.0)
      )
      val json = StreetGradeForApi(row, lengthMeters = 100.0).toJson

      (json \ "street_edge_id").as[Int] mustBe 7
      (json \ "length_meters").as[Double] mustBe 100.0
      (json \ "mean_grade").as[Double] mustBe 0.06
      (json \ "total_climb_meters").as[Double] mustBe 1.5
      (json \ "total_descent_meters").as[Double] mustBe 5.5
      (json \ "meters_over_5pct").as[Double] mustBe 40.0
      (json \ "meters_over_8pct").as[Double] mustBe 10.0
      (json \ "grade_confidence").as[String] mustBe "high"
      (json \ "grade_quality").as[String] mustBe "measured"
      (json \ "elev_start_meters").as[Double] mustBe 104.0
      (json \ "dem_resolution_meters").as[Double] mustBe 10.0
      (json \ "profile" \ "spacing_meters").as[Double] mustBe 50.0
      (json \ "profile" \ "elevations_meters").as[Seq[Double]] mustBe Seq(104.0, 101.5, 100.0)
      (json \ "max_grade_from_meters").as[Double] mustBe 20.0
      (json \ "max_grade_to_meters").as[Double] mustBe 50.0
      (json \ "attribution" \ "dem_source").as[String] mustBe "usgs-3dep-10m"
      (json \ "attribution" \ "credit").as[String] must include("U.S. Geological Survey")
    }

    "say profile: null, and null grades, for a structure" in {
      val row  = StreetGradient(stats(StreetGradientQuality.Structure, measured = false), None, "0" * 32, sampledAt)
      val json = StreetGradeForApi(row, lengthMeters = 80.0).toJson

      (json \ "profile").get mustBe JsNull
      (json \ "mean_grade").get mustBe JsNull
      (json \ "max_grade_from_meters").get mustBe JsNull
      (json \ "grade_quality").as[String] mustBe "structure"
      (json \ "elev_end_meters").as[Double] mustBe 100.0
    }

    "leave out a one-sample profile, which has no spacing to state" in {
      val row =
        StreetGradient(stats(StreetGradientQuality.Measured, measured = true), Some(List(10400)), "0" * 32, sampledAt)
      (StreetGradeForApi(row, lengthMeters = 5.0).toJson \ "profile").get mustBe JsNull
    }
  }

  "the stale flag" should {
    "default to false and be stated when the street has moved since it was sampled" in {
      val row = StreetGradient(
        stats(StreetGradientQuality.Measured, measured = true),
        Some(List(100, 200)),
        "0" * 32,
        sampledAt
      )
      (StreetGradeForApi(row, 100.0).toJson \ "stale").as[Boolean] mustBe false
      (StreetGradeForApi(row, 100.0, stale = true).toJson \ "stale").as[Boolean] mustBe true
    }
  }

  "StreetGradientStats.percentLabel" should {
    "state a grade as a percentage with no trailing zeros" in {
      StreetGradientStats.percentLabel(0.05) mustBe "5%"
      StreetGradientStats.percentLabel(1.0 / 12.0) mustBe "8.33%"
      StreetGradientStats.percentLabel(0.125) mustBe "12.5%"
      StreetGradientStats.percentLabel(0.1) mustBe "10%"
      StreetGradientStats.percentLabel(0.0) mustBe "0%"
    }
  }

  "StreetGradientApiFields.statFields" should {
    "serialize an unsampled street as a null in every slope field" in {
      val values = StreetGradientApiFields.statFields.map(_.value(None))
      values must have size 10
      all(values) mustBe JsNull
    }

    "name the fields in snake_case, in the documented order" in {
      StreetGradientApiFields.statFields.map(_.name) mustBe Seq(
        "mean_grade", "max_grade", "net_grade", "total_climb_meters", "total_descent_meters", "meters_over_5pct",
        "meters_over_8pct", "grade_confidence", "grade_quality", "dem_source"
      )
    }
  }

  "DemSource.forName" should {
    "credit a registered model by its publisher" in {
      DemSource.forName("usgs-3dep-10m").licence mustBe "Public domain"
    }

    "credit an unregistered model by the name it was stored under" in {
      val source = DemSource.forName("inegi-mdt-5m")
      source.credit mustBe "Elevation: inegi-mdt-5m"
      source.url mustBe None
    }
  }

  "StreetGradientConfigForApi.toJson" should {
    "publish the two slope limits and each source's street count" in {
      val json = StreetGradientConfigForApi(Seq(DemSourceForApi(DemSource.forName("usgs-3dep-10m"), Some(2172)))).toJson

      (json \ "walking_surface_limit").as[Double] mustBe 0.05
      (json \ "ramp_limit").as[Double] mustBe (1.0 / 12.0)
      // Ascending, and holding both limits, or the map's classes would not line up with the numbers beside them.
      val breaks = (json \ "map_class_breaks").as[Seq[Double]]
      breaks mustBe breaks.sorted
      breaks must contain allOf (0.05, 1.0 / 12.0)
      val sources = (json \ "sources").as[Seq[JsObject]]
      sources must have size 1
      (sources.head \ "street_count").as[Int] mustBe 2172
    }
  }
}
