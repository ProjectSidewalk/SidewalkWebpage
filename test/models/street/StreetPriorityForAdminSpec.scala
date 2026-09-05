package models.street

import org.scalatest.matchers.must.Matchers
import org.scalatest.wordspec.AnyWordSpec
import play.api.libs.json.{JsNull, JsObject, Json}

import java.time.{LocalDate, OffsetDateTime, ZoneOffset}

/**
 * Unit tests for the field contract of `/adminapi/streetPriority` (#4908).
 *
 * The Imagery page joins these rows onto street geometry and reads every other field by name — the map's colors, both
 * tables, the KPIs and the roll-ups all index into this object. A field renamed here and not there is a blank column
 * or a silently miscounted tier rather than an error, and the page's own tests run against fixtures, so the exact key
 * set is pinned on this side.
 *
 * No DB and no app boot.
 */
class StreetPriorityForAdminSpec extends AnyWordSpec with Matchers {

  private val fullyPopulated = StreetPriorityForAdmin(
    streetEdgeId = 42,
    regionId = 7,
    regionName = "Ballard",
    priority = 0.6666666666666666,
    freshGoodCount = 1,
    outdatedGoodCount = 2,
    badCount = 3,
    outdated = true,
    lastAuditDate = Some(LocalDate.parse("2021-05-04")),
    medianNewestCapture = Some(LocalDate.parse("2025-06-01")),
    imageryUpdatedAt = Some(OffsetDateTime.of(2026, 8, 15, 0, 45, 0, 0, ZoneOffset.UTC)),
    lengthMeters = 1609.34
  )

  private val neverTouched = fullyPopulated.copy(
    outdated = false,
    lastAuditDate = None,
    medianNewestCapture = None,
    imageryUpdatedAt = None
  )

  "the street priority writer" should {
    "publish exactly the fields the page reads, in snake_case" in {
      Json.toJson(fullyPopulated).as[JsObject].keys mustBe Set(
        "street_edge_id", "region_id", "region_name", "priority", "fresh_good_count", "outdated_good_count",
        "bad_count", "outdated", "last_audit_date", "median_newest_capture", "imagery_updated_at", "length_m"
      )
    }

    "carry the priority and its inputs unrounded, so the page can explain one from the other" in {
      val json = Json.toJson(fullyPopulated)
      (json \ "priority").as[Double] mustBe 0.6666666666666666
      (json \ "fresh_good_count").as[Int] mustBe 1
      (json \ "outdated_good_count").as[Int] mustBe 2
      (json \ "bad_count").as[Int] mustBe 3
      (json \ "length_m").as[Double] mustBe 1609.34
    }

    "render dates as plain ISO days, which is what the page compares and displays" in {
      val json = Json.toJson(fullyPopulated)
      (json \ "last_audit_date").as[String] mustBe "2021-05-04"
      (json \ "median_newest_capture").as[String] mustBe "2025-06-01"
    }

    "keep the imagery timestamp's offset, since the page compares those as instants" in {
      // The page reduces over these to find the oldest record; a rendering that dropped the offset would leave two
      // timestamps that sort one way lexically and the other way in time.
      (Json.toJson(fullyPopulated) \ "imagery_updated_at").as[String] must include("Z")
    }

    "null an absent date rather than omitting the field" in {
      val json = Json.toJson(neverTouched)
      // The page tests these with a truthiness check; an omitted key reads the same, but a null one keeps the row's
      // shape identical across streets, which is what lets the tables index rows by column key.
      (json \ "last_audit_date").get mustBe JsNull
      (json \ "median_newest_capture").get mustBe JsNull
      (json \ "imagery_updated_at").get mustBe JsNull
      json.as[JsObject].keys must contain("last_audit_date")
    }

    "carry the site-wide re-audit flag as a boolean, not as a count" in {
      // The KPI counts these directly; a truthy number here would make every audited street read as needing one.
      (Json.toJson(fullyPopulated) \ "outdated").as[Boolean] mustBe true
      (Json.toJson(neverTouched) \ "outdated").as[Boolean] mustBe false
    }
  }

  "the payload" should {
    "wrap the rows under `streets`, so the response can grow without breaking the client" in {
      val json = StreetPriorityForAdmin.payload(Seq(fullyPopulated, neverTouched))
      (json \ "streets").as[Seq[JsObject]].size mustBe 2
      ((json \ "streets")(0) \ "street_edge_id").as[Int] mustBe 42
    }

    "render a city with no routable streets as an empty list rather than an absent key" in {
      // The page reads `priority.streets || []` and reports "no routable streets" from its length; an absent key and
      // an empty one must say the same thing.
      (StreetPriorityForAdmin.payload(Seq.empty) \ "streets").as[Seq[JsObject]] mustBe empty
    }
  }
}
