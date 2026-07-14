package service

import models.utils.FunnelStat
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import java.time.{OffsetDateTime, ZoneOffset}

/**
 * Pure (no DB, no app boot) unit test for [[ConfigService.assembleCityFunnel]], the shared per-city funnel assembly
 * used by both the cross-city (#288) and single-city (#4379) reads.
 *
 * Pins the three behaviors the read paths rely on: segment keys map to the right [[CityFunnel]] fields, missing
 * segments zero-fill to the funnel's step count, and the stored six-slot steps are trimmed to the funnel's actual
 * length (so the 3-step contribution funnel never leaks the padding zeros of the 6-slot row).
 */
class FunnelAssemblySpec extends AnyFunSuite with Matchers {

  private val computedAt: OffsetDateTime = OffsetDateTime.of(2026, 6, 30, 12, 0, 0, 0, ZoneOffset.UTC)

  /** A funnel_stat row, padded to the stored six slots like the real table. */
  private def row(funnelType: String, segment: String, steps: Int*): FunnelStat =
    FunnelStat(funnelType, "30d", segment, steps.toSeq.padTo(6, 0), computedAt)

  test("maps each segment key to the matching CityFunnel field") {
    val rows = Seq(
      row("mapping", "all", 100, 80, 60, 40, 20, 10),
      row("mapping", "role:registered", 30, 28, 26, 24, 22, 20),
      row("mapping", "role:anon", 70, 52, 34, 16, 8, 4),
      row("mapping", "device:desktop", 60, 50, 40, 30, 20, 10),
      row("mapping", "device:mobile", 35, 25, 15, 5, 0, 0),
      row("mapping", "device:unknown", 5, 5, 5, 5, 0, 0)
    )
    val funnel = ConfigService.assembleCityFunnel("seattle-wa", "mapping", rows)

    funnel.cityId shouldBe "seattle-wa"
    funnel.all.steps shouldBe Seq(100, 80, 60, 40, 20, 10)
    funnel.registered.steps shouldBe Seq(30, 28, 26, 24, 22, 20)
    funnel.anonymous.steps shouldBe Seq(70, 52, 34, 16, 8, 4)
    funnel.desktop.steps shouldBe Seq(60, 50, 40, 30, 20, 10)
    funnel.mobile.steps shouldBe Seq(35, 25, 15, 5, 0, 0)
    funnel.deviceUnknown.steps shouldBe Seq(5, 5, 5, 5, 0, 0)
  }

  test("zero-fills every segment that has no row, to the funnel's step count") {
    // Only the "all" segment is present (e.g. a city with no anonymous or mobile users).
    val funnel = ConfigService.assembleCityFunnel("x", "mapping", Seq(row("mapping", "all", 10, 8, 6, 4, 2, 1)))

    val zeros = Seq(0, 0, 0, 0, 0, 0)
    funnel.registered.steps shouldBe zeros
    funnel.anonymous.steps shouldBe zeros
    funnel.desktop.steps shouldBe zeros
    funnel.mobile.steps shouldBe zeros
    funnel.deviceUnknown.steps shouldBe zeros
  }

  test("trims the stored six-slot steps to the contribution funnel's three steps") {
    // The contribution row is still stored padded to six slots; only the first three are real.
    val funnel =
      ConfigService.assembleCityFunnel("x", "contribution", Seq(row("contribution", "all", 100, 40, 12)))

    funnel.all.steps shouldBe Seq(100, 40, 12)
    funnel.all.steps.length shouldBe 3
    funnel.registered.steps shouldBe Seq(0, 0, 0) // zero-filled, also at the funnel's length, not six.
  }
}
