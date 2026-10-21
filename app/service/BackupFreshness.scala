package service

import play.api.libs.json.*

import java.nio.file.{Files, LinkOption, Path}
import scala.jdk.CollectionConverters.*
import scala.util.{Try, Using}

/**
 * One regular file found in the backup directory.
 *
 * @param name       File name, without its directory.
 * @param modifiedMs Last-modified time, epoch milliseconds.
 * @param bytes      Size on disk.
 */
case class BackupFile(name: String, modifiedMs: Long, bytes: Long)

/**
 * The newest file of one backup kind and how it compares to its siblings (#4571).
 *
 * @param kind        `sql` or `base`, from [[BackupFreshness.kindOf]].
 * @param label       What the kind is, for the page.
 * @param count       Files of this kind in the directory.
 * @param newestName  The most recently modified file of this kind.
 * @param newestModifiedMs Its mtime, epoch milliseconds; the page derives the age from it.
 * @param newestBytes Its size.
 * @param medianBytes Median size of the *other* files of this kind, the yardstick for a short newest file.
 * @param status      `good`, `warn` or `bad`.
 * @param note        Why: `fresh`, `stale`, `none_found`, `small` (well under its siblings' median and finished
 *                    writing, so possibly truncated) or `writing` (small but modified so recently that the dump is
 *                    probably still running).
 */
case class BackupKindStatus(
    kind: String,
    label: String,
    count: Int,
    newestName: Option[String],
    newestModifiedMs: Option[Long],
    newestBytes: Option[Long],
    medianBytes: Option[Long],
    status: String,
    note: String
)

/**
 * The backup-freshness panel's payload.
 *
 * @param state       `not_configured` (no directory set, a neutral state for dev and test), `unavailable` (set, but
 *                    missing or unreadable: the job stopped or the mount is gone), or `ok` (scanned).
 * @param status      `neutral`, `good`, `warn` or `bad`: the worst of the overall and per-kind statuses.
 * @param checkedAtMs When the directory was scanned, epoch milliseconds (the result is cached for minutes).
 * @param error       Why the directory could not be read, when `unavailable`.
 * @param newestKind  Kind of the newest file of any recognized kind.
 * @param newestModifiedMs That file's mtime, epoch milliseconds.
 * @param newestStatus How the newest-of-any age reads against its thresholds.
 * @param kinds       One row per recognized kind, always both, so a kind that vanished reads as `none_found`.
 * @param otherCount  Files that match no recognized kind; counted, never alarmed on.
 */
case class BackupFreshnessReport(
    state: String,
    status: String,
    checkedAtMs: Long,
    error: Option[String],
    newestKind: Option[String],
    newestModifiedMs: Option[Long],
    newestStatus: Option[String],
    kinds: Seq[BackupKindStatus],
    otherCount: Int
)

/**
 * Reads the nightly database-backup directory and judges how fresh it is (#4571).
 *
 * The production job dumps the whole cluster nightly at 22:00 into one directory, alternating between a `pg_dumpall`
 * SQL file and a `pg_basebackup` tarball, and prunes with `find -mtime +7`, so 8 to 9 nights exist at once. Each kind
 * is therefore expected about every other night, and something of either kind every night. Age is read from the file
 * mtime rather than the name: the naming pattern is the script's business, and mtime is also what its pruning keys on.
 *
 * The IO ([[listFiles]]) is kept apart from the judgement ([[assess]]) so the latter is testable without a filesystem.
 */
object BackupFreshness {

  private val Day: Long = 24L * 60 * 60 * 1000

  /** Something of either kind lands nightly, so two missed nights is worth a look and four is an outage. */
  val NewestWarnMs: Long = 2 * Day
  val NewestBadMs: Long  = 4 * Day

  /**
   * Each kind lands every other night, so a kind older than three days has missed its turn once, and one older than
   * six has missed it twice. Retention is 8 to 9 days, so past that the kind is gone and reads `none_found`.
   */
  val KindWarnMs: Long = 3 * Day
  val KindBadMs: Long  = 6 * Day

  /**
   * A newest file under this share of its siblings' median size is flagged as possibly truncated. Dumps grow slowly,
   * so a real one never shrinks by this much overnight.
   */
  val SmallRatio: Double = 0.25

  /**
   * A small newest file modified this recently is probably still being written. The age is measured from the last
   * write, and a running dump touches its file continuously, so the window only has to outlast the longest pause a
   * healthy run makes, not the run itself (about an hour for the SQL dump, up to three for the base backup). Reported
   * as `writing`, without changing the status, so the panel does not go yellow every evening while the job runs; the
   * cost is that a dump that died early reads `writing` for this long before it reads `small`.
   */
  val WritingWindowMs: Long = 4L * 60 * 60 * 1000

  /** The recognized kinds, in display order, with the label the page shows. */
  val Kinds: Seq[(String, String)] =
    Seq("sql" -> "SQL dump (pg_dumpall)", "base" -> "File-level copy (pg_basebackup)")

  private val SqlSuffixes  = Seq(".sql", ".dump")
  private val BaseSuffixes = Seq(".tar", ".tgz")

  /** Compressor suffixes the job might add; which one it uses is its business, not a reason to lose the kind. */
  private val CompressionSuffixes = Seq(".gz", ".zst", ".xz", ".bz2")

  /**
   * Which kind a file name is, by suffix, with any compressor suffix stripped first (`.sql.gz` and `.sql.zst` are both
   * SQL dumps).
   *
   * @param name A file name.
   * @return     `sql`, `base`, or `other`.
   */
  def kindOf(name: String): String = {
    val lowerName = name.toLowerCase
    val lower     = CompressionSuffixes.find(lowerName.endsWith).fold(lowerName)(lowerName.stripSuffix)
    if (SqlSuffixes.exists(lower.endsWith)) "sql"
    else if (BaseSuffixes.exists(lower.endsWith)) "base"
    else "other"
  }

  /**
   * Scans the configured directory, or reports that none is configured.
   *
   * @param dir   The configured directory, if any.
   * @param nowMs The current time, epoch milliseconds.
   * @return      The panel's report; never throws.
   */
  def scan(dir: Option[Path], nowMs: Long): BackupFreshnessReport = dir match {
    case None       => notConfigured(nowMs)
    case Some(path) =>
      listFiles(path) match {
        case Left(error)  => unavailable(error, nowMs)
        case Right(files) => assess(files, nowMs)
      }
  }

  /** The neutral report for a checkout with no backup directory, which is every one but production. */
  def notConfigured(nowMs: Long): BackupFreshnessReport =
    BackupFreshnessReport("not_configured", "neutral", nowMs, None, None, None, None, Seq.empty, 0)

  /** The red report for a directory that is configured but cannot be read. */
  def unavailable(error: String, nowMs: Long): BackupFreshnessReport =
    BackupFreshnessReport("unavailable", "bad", nowMs, Some(error), None, None, None, Seq.empty, 0)

  /**
   * Lists the regular files directly in a directory, without descending: the job writes to the top level only, and a
   * recursive walk of a backup tree would be the one expensive thing on a page polled every 20 seconds.
   *
   * @param dir The directory.
   * @return    Its files, or why they could not be read.
   */
  def listFiles(dir: Path): Either[String, Seq[BackupFile]] = {
    if (!Files.exists(dir)) Left("The backup directory does not exist.")
    else if (!Files.isDirectory(dir)) Left("The backup path is not a directory.")
    else if (!Files.isReadable(dir)) Left("The backup directory is not readable by the app.")
    else
      Try {
        Using.resource(Files.list(dir)) { paths =>
          paths
            .iterator()
            .asScala
            .filter(p => Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS))
            .map(p => BackupFile(p.getFileName.toString, Files.getLastModifiedTime(p).toMillis, Files.size(p)))
            .toSeq
        }
      }.toEither.left.map(e => s"Could not list the backup directory: ${e.getClass.getSimpleName}")
  }

  /**
   * Judges a directory listing.
   *
   * @param files The directory's files.
   * @param nowMs The current time, epoch milliseconds.
   * @return      The `ok` report, whose status is the worst of the newest-of-any and per-kind statuses.
   */
  def assess(files: Seq[BackupFile], nowMs: Long): BackupFreshnessReport = {
    val byKind = files.groupBy(f => kindOf(f.name))
    val kinds  = Kinds.map { case (kind, label) => assessKind(kind, label, byKind.getOrElse(kind, Seq.empty), nowMs) }

    val newest       = files.filter(f => kindOf(f.name) != "other").maxByOption(_.modifiedMs)
    val newestStatus = newest.map(f => ageStatus(nowMs - f.modifiedMs, NewestWarnMs, NewestBadMs))
    // An empty directory is the same alarm as a stale one: nothing to restore from.
    val overall = worst(newestStatus.getOrElse("bad") +: kinds.map(_.status))
    BackupFreshnessReport(
      state = "ok",
      status = overall,
      checkedAtMs = nowMs,
      error = None,
      newestKind = newest.map(f => kindOf(f.name)),
      newestModifiedMs = newest.map(_.modifiedMs),
      newestStatus = newestStatus,
      kinds = kinds,
      otherCount = byKind.get("other").map(_.size).getOrElse(0)
    )
  }

  /** One kind's row: its newest file, how old it is, and whether it is far smaller than the rest. */
  private def assessKind(kind: String, label: String, files: Seq[BackupFile], nowMs: Long): BackupKindStatus = {
    val sorted = files.sortBy(-_.modifiedMs)
    sorted.headOption match {
      case None =>
        BackupKindStatus(kind, label, 0, None, None, None, None, "bad", "none_found")
      case Some(newest) =>
        val ageMs          = nowMs - newest.modifiedMs
        val ageTone        = ageStatus(ageMs, KindWarnMs, KindBadMs)
        val siblings       = sorted.tail.map(_.bytes)
        val median         = medianOf(siblings)
        val isSmall        = median.exists(m => m > 0 && newest.bytes < m * SmallRatio)
        val isWriting      = isSmall && ageMs < WritingWindowMs
        val (status, note) =
          if (ageTone != "good") (ageTone, "stale")
          else if (isWriting) ("good", "writing")
          else if (isSmall) ("warn", "small")
          else ("good", "fresh")
        BackupKindStatus(kind, label, files.size, Some(newest.name), Some(newest.modifiedMs), Some(newest.bytes),
          median, status, note)
    }
  }

  /**
   * How an age reads against a pair of thresholds.
   *
   * @return `bad` past `badMs`, `warn` past `warnMs`, otherwise `good`.
   */
  def ageStatus(ageMs: Long, warnMs: Long, badMs: Long): String =
    if (ageMs > badMs) "bad" else if (ageMs > warnMs) "warn" else "good"

  /** The lower median, so a pair of sizes yields a real file's size rather than an average of two. */
  private def medianOf(values: Seq[Long]): Option[Long] =
    if (values.isEmpty) None else Some(values.sorted.apply((values.size - 1) / 2))

  private val Rank = Map("good" -> 0, "warn" -> 1, "bad" -> 2)

  private def worst(statuses: Seq[String]): String = statuses.maxBy(s => Rank.getOrElse(s, 2))

  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  given backupKindStatusWrites: Writes[BackupKindStatus]           = Json.writes[BackupKindStatus]
  given backupFreshnessReportWrites: Writes[BackupFreshnessReport] = Json.writes[BackupFreshnessReport]
}
