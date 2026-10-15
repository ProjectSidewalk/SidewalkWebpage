package service

import controllers.BasemapController
import org.scalatest.OptionValues
import play.api.libs.json.{JsNull, Json}
import util.SidewalkSpec

import java.time.{Instant, LocalDate}

/**
 * Unit tests for the minimap basemap refresh's pure halves (#5716): when the nightly tick builds, which Protomaps
 * build it cuts from, and how archives are named and ordered. No application, DB, or network required.
 */
class BasemapServiceSpec extends SidewalkSpec with OptionValues {

  private def date(text: String) = LocalDate.parse(text)

  "isDue" should {
    "build for a city that has no archive" in {
      BasemapService.isDue(None, date("2026-10-15")) mustBe true
    }

    "build on the first of a refresh month, but not on the first of another month" in {
      BasemapService.isDue(Some(date("2026-07-02")), date("2026-10-01")) mustBe true
      BasemapService.isDue(Some(date("2026-10-02")), date("2026-11-01")) mustBe false
    }

    "not rebuild on a refresh date from data that is already that fresh" in {
      // A rebuild the admin ran the day before, or one the startup tick made that morning.
      BasemapService.isDue(Some(date("2026-09-30")), date("2026-10-01")) mustBe false
    }

    "build any night once the data passes its maximum age, which catches a missed refresh date" in {
      val today = date("2026-10-15")
      BasemapService.isDue(Some(today.minusDays(BasemapService.MaxAgeDays)), today) mustBe false
      BasemapService.isDue(Some(today.minusDays(BasemapService.MaxAgeDays + 1)), today) mustBe true
    }
  }

  "latestBuild" should {
    "pick the newest build in the style's schema version" in {
      val builds = Json.arr(
        Json.obj("key" -> "20261013.pmtiles", "version" -> "4.15.2"),
        Json.obj("key" -> "20261015.pmtiles", "version" -> "4.15.2"),
        Json.obj("key" -> "20261014.pmtiles", "version" -> "4.15.1")
      )
      BasemapService.latestBuild(builds).value mustBe "20261015"
    }

    "skip a newer build in a schema version the style isn't written for" in {
      val builds = Json.arr(
        Json.obj("key" -> "20261014.pmtiles", "version" -> s"${BasemapService.SchemaMajorVersion}.15.2"),
        Json.obj("key" -> "20261015.pmtiles", "version" -> s"${BasemapService.SchemaMajorVersion + 1}.0.0")
      )
      BasemapService.latestBuild(builds).value mustBe "20261014"
    }

    "find nothing in a listing it can't read" in {
      BasemapService.latestBuild(Json.obj("error" -> "gone")) mustBe None
      BasemapService.latestBuild(Json.arr(Json.obj("key" -> "planet.pmtiles", "version" -> "4.1.0"))) mustBe None
    }
  }

  "archive names" should {
    "carry the build date, read back for the age check" in {
      val name = BasemapService.archiveName("20261015", Instant.ofEpochSecond(1760572800L))
      name mustBe "basemap-20261015-1760572800.pmtiles"
      BasemapService.buildDate(name).value mustBe date("2026-10-15")
    }

    "sort newest first by build, then by when they were cut, ignoring other files" in {
      val names = Seq(
        "basemap-20261015-100.pmtiles", ".basemap-20261016-300.pmtiles.part", "basemap-20260701-900.pmtiles",
        "basemap-20261015-200.pmtiles", "notes.txt"
      )
      BasemapService.newestFirst(names) mustBe Seq(
        "basemap-20261015-200.pmtiles",
        "basemap-20261015-100.pmtiles",
        "basemap-20260701-900.pmtiles"
      )
    }
  }

  "cliArch" should {
    "name the release file for the processors pmtiles builds for, and nothing for others" in {
      BasemapService.cliArch("amd64").value mustBe "x86_64"
      BasemapService.cliArch("aarch64").value mustBe "arm64"
      BasemapService.cliArch("ppc64le") mustBe None
      BasemapService.CliSha256.keySet mustBe Set("x86_64", "arm64")
    }
  }

  "BasemapController.pageData" should {
    "hand the minimap the archive's URL, or null before the first build, and the glyph pattern either way" in {
      val glyphs = "/basemap/glyphs/{fontstack}/{range}.pbf"
      BasemapController.pageData(Some("basemap-20261015-1.pmtiles")) mustBe
        Json.obj("tilesUrl" -> "/basemap/basemap-20261015-1.pmtiles", "glyphsUrl" -> glyphs)
      BasemapController.pageData(None) mustBe Json.obj("tilesUrl" -> JsNull, "glyphsUrl" -> glyphs)
    }
  }
}
