package service

// The dashboard reports on exactly the directories the boot check guards, from the same list, so the page and the
// check can never disagree about which directories matter or which of them is currently unsafe (#4925).
import modules.PersistentMediaDirCheck
import modules.PersistentMediaDirCheck.PersistentDir
import play.api.{Configuration, Environment}

import java.io.File
import scala.util.{Failure, Success, Try}

/**
 * What listing one city's media directory found.
 *
 * `File.list` answers null for a directory that isn't there and for one this process may not read alike, and those
 * mean opposite things to a data-loss monitor: nothing uploaded yet, versus no idea what is in there. Collapsing them
 * would let a permissions change announce a whole city's photos as destroyed, so they stay distinct all the way to
 * the page.
 */
sealed trait DirListing
object DirListing {

  /** The names the directory holds. */
  case class Listed(names: Seq[String]) extends DirListing

  /** No directory at that path: no upload has landed for this city yet, or one that had landed is gone. */
  case object Absent extends DirListing

  /** The path is there but unreadable, so nothing can be concluded about what it holds. */
  case object Unreadable extends DirListing
}

/** Where one schema's story media lives on this instance, or why this instance can't say. */
sealed trait ScanTarget
object ScanTarget {

  /** The city subdirectory holding that schema's media. */
  case class Dir(cityId: String) extends ScanTarget

  /** No directory can be attributed to the schema, phrased for the operator reading the panel. */
  case class Unlocatable(reason: String) extends ScanTarget
}

/**
 * The pure logic behind the Health dashboard's media-storage panel (#4926): what each persistent media directory
 * looks like from this instance, and which `story_media` rows have lost their bytes.
 *
 * Split from [[HealthService]] — which owns the database reads, the cache, and the thread pool — so a spec can pin
 * the parts that are easy to get quietly wrong (an absent directory reported as data loss, a blank config value
 * treated as the filesystem root) without booting an application or touching a database.
 */
object MediaIntegrity {

  /** Longest list of ids the payload carries per city; the counts are the signal, the ids are just a starting point. */
  private val MaxSampleIds = 20

  /** `StoryService.storyMediaFile` names every file this way, which is what lets one directory listing replace N stats. */
  private val StoryMediaFileName = """^story_(\d+)\.jpg$""".r

  /**
   * How each persistent media directory resolves on this instance, in `persistentDirs` order.
   *
   * @param config      Application configuration.
   * @param environment Play environment supplying the application root and the run mode.
   * @return            One status per directory, carrying its own display label and severity so the page holds no
   *                    copy of the rules.
   */
  def directoryStatuses(config: Configuration, environment: Environment): Seq[MediaDirStatus] = {
    val enforced = PersistentMediaDirCheck.arms(environment)
    val unsafe   = PersistentMediaDirCheck.unsafeDirs(config, environment).map(u => u.dir.key -> u.reason).toMap

    PersistentMediaDirCheck.persistentDirs.map { dir =>
      Try(MediaDirs.baseDir(config, environment, dir.key)) match {
        case Failure(e) =>
          status(dir, "—", "unresolved", "unusable value", "bad", Some(e.getMessage))
        case Success(resolved) =>
          val probe = DirProbe(resolved.exists(), resolved.canRead(), resolved.canWrite())
          dirStatus(dir, resolved.getAbsolutePath, probe, unsafe.get(dir.key), enforced)
      }
    }
  }

  /**
   * What a stat of one media directory saw — the only facts about it the status rules turn on.
   *
   * @param exists   Whether anything is at the path.
   * @param readable Whether this process may read it.
   * @param writable Whether this process may write to it.
   */
  case class DirProbe(exists: Boolean, readable: Boolean, writable: Boolean)

  /**
   * What one directory's observed state means, separated from observing it so every branch is reachable from a spec:
   * the permission branches can't be provoked from a test that runs as root, which CI and the dev container both do.
   *
   * @param dir          The directory being judged.
   * @param path         Where it resolved, for display.
   * @param probe        What a stat of it saw.
   * @param unsafeReason The boot check's objection to it, when it has one.
   * @param enforced     Whether the boot check arms on this instance. When it doesn't, a directory inside the build
   *                     tree is the intended dev arrangement rather than a fault, and saying otherwise would make the
   *                     dev dashboard permanently red and teach everyone to ignore it.
   * @return             The status, carrying its own display label and severity so the page holds no copy of the
   *                     rules.
   */
  private[service] def dirStatus(
      dir: PersistentDir,
      path: String,
      probe: DirProbe,
      unsafeReason: Option[String],
      enforced: Boolean
  ): MediaDirStatus = unsafeReason match {
    case Some(reason) =>
      val severity = if (!enforced) "ok" else if (dir.irreplaceable) "bad" else "warn"
      val label    = if (enforced) "a deploy will delete this" else "inside the build tree (dev)"
      status(dir, path, "unsafe", label, severity, Some(reason))
    // Not created yet is the normal state until the first upload — the write paths mkdirs on demand.
    case None if !probe.exists   => status(dir, path, "absent", "not created yet", "ok", None)
    case None if !probe.readable =>
      val detail = s"${dir.envVar} points at a path this process cannot read, so nothing in it can be verified."
      status(dir, path, "not_readable", "not readable", "bad", Some(detail))
    case None if !probe.writable =>
      val detail = s"${dir.envVar} points at a path this process cannot write to, so uploads will fail."
      status(dir, path, "not_writable", "not writable", "bad", Some(detail))
    case None => status(dir, path, "ok", "ok", "good", None)
  }

  private def status(
      dir: PersistentDir,
      path: String,
      key: String,
      label: String,
      severity: String,
      detail: Option[String]
  ): MediaDirStatus =
    MediaDirStatus(dir.key, dir.envVar, dir.irreplaceable, path, key, label, severity, detail)

  /**
   * Whether the story-media scan can run against this base directory at all, and if not, what to say instead.
   *
   * Both refusals report the scan as unavailable rather than as loss, and the second is the one that is easy to get
   * wrong: `isDirectory` answers true for a directory this process may not read, and every per-city listing beneath
   * an unreadable base comes back empty — which would announce every story photo on the stage as destroyed. A monitor
   * that cries data loss over a permissions change gets muted, and a muted monitor leaves us where #4925 found us.
   *
   * @param path        Where the base directory resolved, named in the message so an operator knows what to look at.
   * @param isDirectory Whether a directory is there.
   * @param canRead     Whether this process may read it.
   * @return            The reason the scan declined, or None when it can proceed.
   */
  def scanRefusal(path: String, isDirectory: Boolean, canRead: Boolean): Option[String] = {
    // Nothing has been uploaded on this stage yet, or the directory is gone. Either way there is nothing to compare
    // against, and the directory panel already reports the state of the path itself.
    if (!isDirectory) Some(s"No media directory at $path to scan.")
    else if (!canRead) Some(s"Media directory $path is not readable by this process.")
    else None
  }

  /**
   * Which city's subdirectory each schema's media lives in, or why it can't be located.
   *
   * This instance's own schema takes `city-id`, because that is what `StoryService` builds its write path from —
   * the schema and `city-id` are independent settings, so on an instance where they disagree the scan has to look
   * where the files actually are. That claim is exclusive: no second schema may be pointed at the same directory,
   * or it would report the first schema's files as orphans. Every schema that loses a directory that way carries
   * the reason with it, since "no city configured" and "this instance took that directory" send an operator looking
   * in very different places.
   *
   * @param schemas       Schemas the scan covers.
   * @param currentSchema The schema this instance reads and writes.
   * @param currentCity   The `city-id` this instance writes media under.
   * @param configured    Schema to city id, from configuration alone.
   * @return              One target per schema, in no particular order.
   */
  def scanTargets(
      schemas: Seq[String],
      currentSchema: String,
      currentCity: String,
      configured: Map[String, String]
  ): Map[String, ScanTarget] = schemas.map { schema =>
    schema -> {
      if (schema == currentSchema) ScanTarget.Dir(currentCity)
      else
        configured.get(schema) match {
          case Some(`currentCity`) =>
            ScanTarget.Unlocatable(
              s"this instance writes $currentCity media under schema $currentSchema, so the $currentCity directory " +
                s"can't also be read as $schema"
            )
          case Some(cityId) => ScanTarget.Dir(cityId)
          case None         => ScanTarget.Unlocatable(s"no city on this stage is configured to use schema $schema")
        }
    }
  }.toMap

  /**
   * Compares one city's `story_media` rows against the files in its media directory.
   *
   * Both directions matter. A row with no file is destroyed content (#4925). A file with no row is the opposite
   * failure: a retraction whose row delete landed and whose file delete did not, which leaves a photo on disk that
   * its author believes they deleted — the hard-delete contract stories were built on (#4054).
   *
   * @param cityId   City the schema belongs to, which names the directory that was listed.
   * @param schema   Database schema the rows came from.
   * @param mediaIds `story_media` ids in that schema.
   * @param listing  What the city's directory held. An absent directory is real loss — the write path creates it and
   *                 never removes it — but an unreadable one proves nothing, so it reports unscanned instead.
   * @return         Counts in both directions, with a short sample of ids to start looking from.
   */
  def compareCity(cityId: String, schema: String, mediaIds: Seq[Int], listing: DirListing): CityStoryMedia = {
    val rows = mediaIds.distinct.toSet
    listing match {
      case DirListing.Unreadable =>
        unscannedCity(Some(cityId), schema, mediaIds, s"the $cityId media directory is not readable by this process")
      case DirListing.Absent        => diff(cityId, schema, rows, Set.empty)
      case DirListing.Listed(names) =>
        diff(
          cityId,
          schema,
          rows,
          names.flatMap { case StoryMediaFileName(id) => id.toIntOption; case _ => None }.toSet
        )
    }
  }

  /**
   * One city's row whose directory could not be scanned, so its counts stand for nothing and read as blank.
   *
   * @param cityId   City the schema belongs to, when one is known.
   * @param schema   Database schema the rows came from.
   * @param mediaIds `story_media` ids in that schema, which are still worth reporting as a row count.
   * @param reason   Why the scan couldn't run, phrased for the operator reading the panel.
   */
  def unscannedCity(cityId: Option[String], schema: String, mediaIds: Seq[Int], reason: String): CityStoryMedia =
    CityStoryMedia(cityId, schema, mediaIds.distinct.size, 0, 0, Seq.empty, Seq.empty, scanned = false, Some(reason))

  private def diff(cityId: String, schema: String, rows: Set[Int], onDisk: Set[Int]): CityStoryMedia = {
    val missing = (rows -- onDisk).toSeq.sorted
    val orphans = (onDisk -- rows).toSeq.sorted
    CityStoryMedia(
      Some(cityId), schema, rows.size, missing.size, orphans.size, missing.take(MaxSampleIds),
      orphans.take(MaxSampleIds), scanned = true, None
    )
  }

  /**
   * What a media directory holds, telling an absent directory apart from one this process may not read.
   *
   * Blocking; call on a blocking pool.
   *
   * @param dir Directory to list.
   * @return    Its file names, or which of the two null-answering states `File.list` was in.
   */
  def listing(dir: File): DirListing = Option(dir.list()) match {
    case Some(names) => DirListing.Listed(names.toSeq)
    // `list` also answers null on an I/O error against a directory that is there, which is no more conclusive than a
    // permissions refusal — so anything that exists but won't list is Unreadable rather than Absent.
    case None if dir.exists() => DirListing.Unreadable
    case None                 => DirListing.Absent
  }
}
