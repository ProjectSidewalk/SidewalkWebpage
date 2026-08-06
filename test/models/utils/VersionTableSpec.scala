package models.utils

import org.scalatestplus.play.PlaySpec

import java.time.OffsetDateTime

/**
 * Pure unit tests for `VersionTable.latestVersion`. No app boot or DB required.
 *
 * Versions released together share one `version_start_time` (their rows are inserted by a single release evolution),
 * so picking the current version needs a numeric version-id tiebreak on top of the timestamp ordering.
 */
class VersionTableSpec extends PlaySpec {
  private val t1 = OffsetDateTime.parse("2026-06-25T23:34:51Z")
  private val t2 = OffsetDateTime.parse("2026-07-18T16:22:52Z")

  private def v(id: String, time: OffsetDateTime): Version = Version(id, time, None)

  "latestVersion" should {
    "pick the row with the latest timestamp, even over a higher version id" in {
      VersionTable.latestVersion(Seq(v("11.5.0", t1), v("11.4.3", t2))).versionId mustBe "11.4.3"
    }

    "break timestamp ties by highest numeric version id" in {
      val tied = Seq(v("11.6.1", t2), v("11.7.0", t2), v("11.6.0", t2), v("11.5.0", t1))
      VersionTable.latestVersion(tied).versionId mustBe "11.7.0"
    }

    "compare version components numerically, not lexically" in {
      VersionTable.latestVersion(Seq(v("11.9.0", t2), v("11.10.0", t2))).versionId mustBe "11.10.0"
    }
  }
}
