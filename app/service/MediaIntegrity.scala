package service

// The dashboard reports on exactly the directories the boot check guards, from the same list, so the page and the
// check can never disagree about which directories matter or which of them is currently unsafe (#4925).
import modules.PersistentMediaDirCheck
import modules.PersistentMediaDirCheck.PersistentDir
import play.api.{Configuration, Environment, Mode}

import java.io.File
import scala.util.{Failure, Success, Try}

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
    // The check arms only in prod mode, and in a dev checkout the relative defaults are supposed to land in the repo.
    // Reporting those as failures would make the dev dashboard permanently red and teach everyone to ignore it.
    val enforced = environment.mode == Mode.Prod
    val unsafe   = PersistentMediaDirCheck.unsafeDirs(config, environment).map(u => u.dir.key -> u.reason).toMap

    PersistentMediaDirCheck.persistentDirs.map { dir =>
      Try(MediaDirs.baseDir(config, environment, dir.key)) match {
        case Failure(e) =>
          status(dir, "—", "unresolved", "unusable value", "bad", Some(e.getMessage))
        case Success(resolved) =>
          val path = resolved.getAbsolutePath
          unsafe.get(dir.key) match {
            case Some(reason) =>
              val severity = if (!enforced) "ok" else if (dir.irreplaceable) "bad" else "warn"
              val label    = if (enforced) "a deploy will delete this" else "inside the build tree (dev)"
              status(dir, path, "unsafe", label, severity, Some(reason))
            // Not created yet is the normal state until the first upload — the write paths mkdirs on demand.
            case None if !resolved.exists()   => status(dir, path, "absent", "not created yet", "ok", None)
            case None if !resolved.canWrite() =>
              status(
                dir,
                path,
                "not_writable",
                "not writable",
                "bad",
                Some(s"${dir.envVar} points at a path this process cannot write to, so uploads will fail.")
              )
            case None => status(dir, path, "ok", "ok", "good", None)
          }
      }
    }
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
   * Which city's subdirectory each schema's media lives in.
   *
   * This instance's own schema takes `city-id`, because that is what `StoryService` builds its write path from —
   * the schema and `city-id` are independent settings, so on an instance where they disagree the scan has to look
   * where the files actually are. That claim is exclusive: no second schema may be pointed at the same directory,
   * or it would report the first schema's files as orphans. A schema left without a directory is reported unscanned,
   * which is the truth — nothing here can say where its files are.
   *
   * @param schemas       Schemas the scan covers.
   * @param currentSchema The schema this instance reads and writes.
   * @param currentCity   The `city-id` this instance writes media under.
   * @param configured    Schema to city id, from configuration alone.
   * @return              Schema to city id, for the schemas whose directory can be located.
   */
  def cityDirsBySchema(
      schemas: Seq[String],
      currentSchema: String,
      currentCity: String,
      configured: Map[String, String]
  ): Map[String, String] = {
    val others = schemas
      .filter(_ != currentSchema)
      .flatMap(schema => configured.get(schema).filter(_ != currentCity).map(schema -> _))
      .toMap
    if (schemas.contains(currentSchema)) others + (currentSchema -> currentCity) else others
  }

  /**
   * Compares one city's `story_media` rows against the files in its media directory.
   *
   * Both directions matter. A row with no file is destroyed content (#4925). A file with no row is the opposite
   * failure: a retraction whose row delete landed and whose file delete did not, which leaves a photo on disk that
   * its author believes they deleted — the hard-delete contract stories were built on (#4054).
   *
   * @param cityId    City the schema belongs to, or None when this instance's config doesn't name it — then the
   *                  directory can't be located and the row is reported unscanned rather than guessed at.
   * @param schema    Database schema the rows came from.
   * @param mediaIds  `story_media` ids in that schema.
   * @param fileNames Names in the city's media directory, or None when the directory isn't there. An absent
   *                  directory under a readable base is real loss, not an unknown, so its rows count as missing.
   * @return          Counts in both directions, with a short sample of ids to start looking from.
   */
  def compareCity(
      cityId: Option[String],
      schema: String,
      mediaIds: Seq[Int],
      fileNames: Option[Seq[String]]
  ): CityStoryMedia = {
    val rows = mediaIds.distinct
    if (cityId.isEmpty) {
      CityStoryMedia(cityId, schema, rows.size, 0, 0, Seq.empty, Seq.empty, scanned = false)
    } else {
      val onDisk =
        fileNames.getOrElse(Seq.empty).flatMap { case StoryMediaFileName(id) => id.toIntOption; case _ => None }.toSet
      val rowSet  = rows.toSet
      val missing = (rowSet -- onDisk).toSeq.sorted
      val orphans = (onDisk -- rowSet).toSeq.sorted
      CityStoryMedia(cityId, schema, rows.size, missing.size, orphans.size, missing.take(MaxSampleIds),
        orphans.take(MaxSampleIds), scanned = true)
    }
  }

  /** Lists a directory's file names, or None when it isn't a readable directory. Blocking; call on a blocking pool. */
  def listFileNames(dir: File): Option[Seq[String]] = Option(dir.list()).map(_.toSeq)
}
