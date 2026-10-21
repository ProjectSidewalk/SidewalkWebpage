package service

import play.api.libs.json.Json
import service.BackupFreshness.given
import util.SidewalkSpec

import java.nio.file.attribute.{FileTime, PosixFilePermissions}
import java.nio.file.{Files, Path}
import scala.util.Try

/**
 * Tests for the backup-freshness panel's scan and judgement (#4571).
 *
 * The contracts pinned here are the ones that decide whether a night without a backup can go unnoticed: a vanished
 * directory is red rather than empty, a kind that dropped out of retention still gets a row, age comes from mtime,
 * and a short file is called out without the panel going yellow every evening while the job is writing.
 */
class BackupFreshnessSpec extends SidewalkSpec {

  private val Hour: Long = 60L * 60 * 1000
  private val Day: Long  = 24 * Hour
  private val Now: Long  = 1_800_000_000_000L
  private val GB: Long   = 1_000_000_000L

  private def file(name: String, ageMs: Long, bytes: Long = 340 * GB) = BackupFile(name, Now - ageMs, bytes)

  /** A healthy fortnight: the kinds alternate nightly, the newest written last night. */
  private val healthy = Seq(
    file("prod_2026-10-20.sql", 14 * Hour),
    file("prod_2026-10-19.base.tar", 38 * Hour, 430 * GB),
    file("prod_2026-10-18.sql", 62 * Hour),
    file("prod_2026-10-17.base.tar", 86 * Hour, 430 * GB),
    file("prod_2026-10-16.sql", 110 * Hour)
  )

  private def kind(report: BackupFreshnessReport, k: String) = report.kinds.find(_.kind == k).get

  private def withTempDir[T](body: Path => T): T = {
    val dir = Files.createTempDirectory("backup-freshness")
    try body(dir)
    finally {
      Try(Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("rwx------")))
      Files.list(dir).forEach(p => Files.delete(p))
      Files.delete(dir)
    }
  }

  "BackupFreshness.scan" should {
    "report an unset directory as neutral, never as an alarm" in {
      val report = BackupFreshness.scan(None, Now)
      report.state mustBe "not_configured"
      report.status mustBe "neutral"
      report.kinds mustBe empty
    }

    "report a configured directory that does not exist as unavailable and red" in {
      withTempDir { dir =>
        val report = BackupFreshness.scan(Some(dir.resolve("gone")), Now)
        report.state mustBe "unavailable"
        report.status mustBe "bad"
        report.error.get must include("does not exist")
        report.kinds mustBe empty
      }
    }

    "report an unreadable directory as unavailable" in {
      withTempDir { dir =>
        val locked = Try(Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("-wx------"))).isSuccess
        // Root reads anything, and a non-POSIX filesystem has no such mode, so neither can make this case.
        assume(locked && !Files.isReadable(dir), "cannot make an unreadable directory here")
        val report = BackupFreshness.scan(Some(dir), Now)
        report.state mustBe "unavailable"
        report.error.get must include("not readable")
      }
    }

    "read files from disk by mtime and size, skipping subdirectories" in {
      withTempDir { dir =>
        val sql = Files.write(dir.resolve("a.sql"), Array.fill[Byte](10)(1))
        Files.setLastModifiedTime(sql, FileTime.fromMillis(Now - 2 * Hour))
        Files.createDirectory(dir.resolve("nested.sql"))
        val report = BackupFreshness.scan(Some(dir), Now)
        report.state mustBe "ok"
        kind(report, "sql").count mustBe 1
        kind(report, "sql").newestBytes mustBe Some(10L)
        kind(report, "sql").newestModifiedMs mustBe Some(Now - 2 * Hour)
        Files.delete(dir.resolve("nested.sql"))
      }
    }
  }

  "BackupFreshness.kindOf" should {
    "classify by suffix, ignoring case and any compressor suffix" in {
      Seq("x.sql", "x.SQL", "x.sql.gz", "x.sql.zst", "x.dump").map(BackupFreshness.kindOf).distinct mustBe Seq("sql")
      Seq("x.base.tar", "x.tar", "x.tar.gz", "x.tar.xz", "x.tgz").map(BackupFreshness.kindOf).distinct mustBe Seq(
        "base"
      )
      // A compressor suffix on its own, or a temp name, is not a dump.
      Seq("backup_pg.sh", "x.log", "README", "x.gz", "x.sql.tmp").map(BackupFreshness.kindOf).distinct mustBe
        Seq("other")
    }
  }

  "BackupFreshness.assess" should {
    "read a healthy alternating week as good, with the newest of each kind by mtime" in {
      // Listed out of order so that picking the first file, or sorting by name, would be caught.
      val report = BackupFreshness.assess(healthy.reverse, Now)
      report.status mustBe "good"
      report.newestKind mustBe Some("sql")
      report.newestModifiedMs mustBe Some(Now - 14 * Hour)
      kind(report, "sql").newestName mustBe Some("prod_2026-10-20.sql")
      kind(report, "sql").count mustBe 3
      kind(report, "base").newestName mustBe Some("prod_2026-10-19.base.tar")
      kind(report, "base").note mustBe "fresh"
    }

    "use mtime, not the name, to find the newest" in {
      val report = BackupFreshness.assess(Seq(file("z_old.sql", 3 * Day), file("a_new.sql", 1 * Hour)), Now)
      kind(report, "sql").newestName mustBe Some("a_new.sql")
    }

    "count unrecognized files without alarming on them" in {
      val report = BackupFreshness.assess(healthy :+ file("backup_pg.sh", 30 * Day, 2000), Now)
      report.otherCount mustBe 1
      report.status mustBe "good"
    }

    "always report both kinds, so one that fell out of retention reads none_found and red" in {
      val onlySql = healthy.filter(f => BackupFreshness.kindOf(f.name) == "sql")
      val report  = BackupFreshness.assess(onlySql, Now)
      kind(report, "base").count mustBe 0
      kind(report, "base").note mustBe "none_found"
      kind(report, "base").status mustBe "bad"
      report.status mustBe "bad"
    }

    "read an empty directory as red" in {
      val report = BackupFreshness.assess(Seq.empty, Now)
      report.status mustBe "bad"
      report.newestStatus mustBe None
      report.kinds.map(_.note) mustBe Seq("none_found", "none_found")
    }

    "map ages onto the per-kind and newest-of-any thresholds" in {
      def at(ageMs: Long) = BackupFreshness.assess(Seq(file("a.sql", ageMs), file("b.tar", ageMs)), Now)
      at(1 * Day).status mustBe "good"
      at(BackupFreshness.NewestWarnMs + Hour).newestStatus mustBe Some("warn")
      at(BackupFreshness.NewestWarnMs + Hour).status mustBe "warn"
      kind(at(BackupFreshness.KindWarnMs + Hour), "sql").status mustBe "warn"
      kind(at(BackupFreshness.KindWarnMs + Hour), "sql").note mustBe "stale"
      at(BackupFreshness.NewestBadMs + Hour).newestStatus mustBe Some("bad")
      kind(at(BackupFreshness.KindBadMs + Hour), "base").status mustBe "bad"
    }

    "turn the overall status red when one kind stops while the other keeps landing" in {
      val baseStopped = Seq(file("new.sql", 10 * Hour), file("old.tar", BackupFreshness.KindBadMs + Day))
      val report      = BackupFreshness.assess(baseStopped, Now)
      report.newestStatus mustBe Some("good")
      report.status mustBe "bad"
    }

    "flag a finished newest file far below its siblings' median as possibly truncated" in {
      val files = healthy :+ file("prod_2026-10-21.sql", 5 * Hour, 20 * GB)
      val sql   = kind(BackupFreshness.assess(files, Now), "sql")
      sql.medianBytes mustBe Some(340 * GB)
      sql.note mustBe "small"
      sql.status mustBe "warn"
    }

    "call a small newest file that is still being written writing, without changing its status" in {
      val files = healthy :+ file("prod_2026-10-21.sql", 30L * 60 * 1000, 20 * GB)
      val sql   = kind(BackupFreshness.assess(files, Now), "sql")
      sql.note mustBe "writing"
      sql.status mustBe "good"
    }

    "not flag a lone file, which has no siblings to compare with" in {
      val sql = kind(BackupFreshness.assess(Seq(file("only.sql", 10 * Hour, 1)), Now), "sql")
      sql.medianBytes mustBe None
      sql.note mustBe "fresh"
    }
  }

  "the JSON" should {
    "use snake_case and carry epoch milliseconds for the page to format" in {
      val js = Json.toJson(BackupFreshness.assess(healthy, Now))
      (js \ "newest_modified_ms").as[Long] mustBe Now - 14 * Hour
      (js \ "kinds" \ 0 \ "newest_bytes").as[Long] mustBe 340 * GB
      (js \ "other_count").as[Int] mustBe 0
    }
  }
}
