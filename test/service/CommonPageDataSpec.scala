package service

import play.api.i18n.Lang
import util.SidewalkSpec

import java.time.{LocalDate, OffsetDateTime}

/** Checks the footer's release date (#5696): read in UTC and written in the reader's language. */
class CommonPageDataSpec extends SidewalkSpec {

  // The release from #5696: evening Pacific time, which is already the next day in UTC.
  private val released = OffsetDateTime.parse("2026-10-06T17:32:11.557793-07:00")

  "releaseDate" should {
    "use the UTC day, so the date doesn't depend on the server's time zone" in {
      CommonPageData.releaseDate(released) mustBe LocalDate.of(2026, 10, 7)
      CommonPageData.releaseDate(released.withOffsetSameInstant(java.time.ZoneOffset.UTC)) mustBe
        LocalDate.of(2026, 10, 7)
    }
  }

  "releaseDateLabel" should {
    "write the date in the reader's language" in {
      CommonPageData.releaseDateLabel(released, Lang("en")) mustBe "October 7, 2026"
      CommonPageData.releaseDateLabel(released, Lang("de")) mustBe "7. Oktober 2026"
    }
  }
}
