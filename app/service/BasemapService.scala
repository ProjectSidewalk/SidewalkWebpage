package service

import com.google.inject.ImplementedBy
import executors.CpuIntensiveExecutionContext
import models.region.RegionTable
import models.utils.{LatLngBBox, MyPostgresProfile}
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.FileIO
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.libs.ws.WSClient
import play.api.{Configuration, Environment, Logger}

import java.io.File
import java.nio.file.{Files, StandardCopyOption}
import java.security.MessageDigest
import java.time.format.DateTimeFormatter
import java.time.{Instant, LocalDate, ZoneId}
import java.util.HexFormat
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.*
import scala.concurrent.{blocking, ExecutionContext, Future}
import scala.util.Try

/**
 * What a run of the basemap refresh did (#5716).
 *
 * @param skipped True when nothing was built: the city's archive was recent enough, or the city has no regions yet.
 * @param archive The archive the minimap reads afterwards, if there is one.
 * @param build   The Protomaps build it was cut from, as its date (`20261015`), when this run built it.
 * @param bytes   Its size, when this run built it.
 */
case class BasemapRefreshResult(skipped: Boolean, archive: Option[String], build: Option[String], bytes: Option[Long]) {

  /**
   * The run as it is stored against a `background_job_run` row.
   *
   * @return The run's `details` object.
   */
  def runDetails: JsObject = Json.obj("skipped" -> skipped, "archive" -> archive, "build" -> build, "bytes" -> bytes)
}

/** Builds and finds the city's minimap basemap archive (#5716); see [[BasemapServiceImpl]]. */
@ImplementedBy(classOf[BasemapServiceImpl])
trait BasemapService {

  /**
   * Cuts the city out of the newest Protomaps world build and makes it the archive the minimap reads.
   *
   * At most one run at a time: a second call while one is in flight fails with [[IllegalStateException]].
   *
   * @param force True to build whatever the current archive's age; false (the nightly tick) builds only when
   *              [[BasemapService.isDue]] says so.
   */
  def refresh(force: Boolean): Future[BasemapRefreshResult]

  /** Whether a refresh is in flight. */
  def isRunning: Boolean

  /** The newest archive's file name, which is also its URL path segment; None until the city's first build. */
  def currentArchive: Option[String]

  /**
   * The archive with this file name, if it is one this city serves.
   *
   * @param name A file name from [[currentArchive]], possibly an older one a page loaded before the last refresh.
   */
  def archiveFile(name: String): Option[File]
}

object BasemapService {

  /**
   * The pmtiles command-line tool the app downloads for itself (no package manager carries it, and the servers
   * aren't ours to install on). Each checksum is the one GitHub publishes for that release file, so a swapped
   * download is refused rather than run.
   */
  val CliVersion: String             = "1.31.2"
  val CliSha256: Map[String, String] = Map(
    "x86_64" -> "3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f",
    "arm64"  -> "f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1"
  )

  /** Lists Protomaps' world builds. Their URLs change and old ones are deleted, so each run looks up the newest. */
  val BuildsUrl: String = "https://build-metadata.protomaps.dev/builds.json"

  /** Where a build listed in [[BuildsUrl]] is downloaded from, by its `key`. */
  val BuildBaseUrl: String = "https://build.protomaps.com/"

  /**
   * The schema version MinimapBasemapStyle.js is written for. A new major version renames layers or kinds, so a run
   * keeps cutting the newest build of this one until the style is updated.
   */
  val SchemaMajorVersion: Int = 4

  /** The nightly tick rebuilds on the first of these months... */
  val RefreshMonths: Set[Int] = Set(1, 4, 7, 10)

  /** ...or once the archive was cut this long ago, which catches a server that was down on a refresh date. */
  val MaxAgeDays: Long = 100

  /**
   * How far past the regions the archive reaches. The minimap stays centered on the user, so at a region's edge half
   * the map shows what's beyond it: about 600 m at the farthest zoom a user can pick.
   */
  val MarginM: Double = 2000

  /**
   * Archives kept on disk: the current one and the one before, which a page loaded before the last refresh may
   * still be reading, plus any cut in the last [[KeepRecentFor]], so back-to-back rebuilds can't pull a file out
   * from under an open Explore tab.
   */
  val KeptArchives: Int             = 2
  val KeepRecentFor: FiniteDuration = 1.day

  /** A city's cut takes seconds; this only stops a hung download from holding the refresh forever. */
  val ExtractTimeout: FiniteDuration = 15.minutes

  /** The scheduler's zone, so "the first of the month" is the scheduler's first. */
  val ScheduleZone: ZoneId = ZoneId.of("America/Los_Angeles")

  private val BuildDate = DateTimeFormatter.BASIC_ISO_DATE

  /** `basemap-<build date>-<when we cut it>.pmtiles`: a new name per cut, so a cached copy is never wrong. */
  private val ArchiveName = """basemap-(\d{8})-(\d+)\.pmtiles""".r

  /** The file name for an archive cut at `now` from `build` (a date, as [[latestBuild]] returns it). */
  def archiveName(build: String, now: Instant): String = s"basemap-$build-${now.getEpochSecond}.pmtiles"

  /** Sorts archive file names newest first, dropping anything that isn't one. */
  def newestFirst(names: Seq[String]): Seq[String] =
    names
      .collect { case name @ ArchiveName(build, cutAt) => (build, cutAt.toLong, name) }
      .sortBy { case (build, cutAt, _) => (build, cutAt) }
      .reverse
      .map(_._3)

  /** Whether a file name is one of ours, so a request can't name any other file. */
  def isArchiveName(name: String): Boolean = ArchiveName.matches(name)

  /** When an archive was cut, from its file name. */
  def cutAt(name: String): Option[Instant] = name match {
    case ArchiveName(_, seconds) => seconds.toLongOption.map(Instant.ofEpochSecond)
    case _                       => None
  }

  /** The date of a build's OpenStreetMap data, from its name as [[latestBuild]] returns it (`20261015`). */
  def buildDate(build: String): Option[LocalDate] = Try(LocalDate.parse(build, BuildDate)).toOption

  /**
   * Whether the nightly tick should cut a new archive. Goes by when we cut it, not the data's date: if Protomaps
   * stopped publishing builds the style can read, the data would age past [[MaxAgeDays]] and every night would cut
   * the same old build again.
   *
   * @param current The day the current archive was cut, or None when the city has none.
   * @param today   Today, in [[ScheduleZone]].
   */
  def isDue(current: Option[LocalDate], today: LocalDate): Boolean = current match {
    case None        => true
    case Some(built) =>
      val refreshDay = today.getDayOfMonth == 1 && RefreshMonths.contains(today.getMonthValue)
      (refreshDay && built.isBefore(today)) || built.isBefore(today.minusDays(MaxAgeDays))
  }

  /**
   * The newest build in the schema version the style reads.
   *
   * @param builds The [[BuildsUrl]] listing: `[{key: "20261015.pmtiles", version: "4.15.2", ...}]`.
   * @return       Its date (`20261015`), or None.
   */
  def latestBuild(builds: JsValue): Option[String] = {
    val Key = """(\d{8})\.pmtiles""".r
    builds
      .asOpt[Seq[JsObject]]
      .getOrElse(Seq.empty)
      .flatMap { build =>
        val major = (build \ "version").asOpt[String].flatMap(_.split('.').headOption).flatMap(_.toIntOption)
        (build \ "key").asOpt[String].collect { case Key(date) if major.contains(SchemaMajorVersion) => date }
      }
      .maxOption
  }

  /** The release files' name for the processor the JVM calls `osArch`, or None when pmtiles has no Linux build. */
  def cliArch(osArch: String): Option[String] = osArch match {
    case "amd64" | "x86_64"  => Some("x86_64")
    case "aarch64" | "arm64" => Some("arm64")
    case _                   => None
  }
}

/**
 * Keeps a copy of the city's slice of the OpenStreetMap basemap for the Explore minimap to read (#5716).
 *
 * The minimap needs vector tiles, and the free hosted services make no promise to stay up. Protomaps publishes the
 * whole world as one daily file that a client can read any part of, so the `pmtiles` tool can copy out just the
 * city's area (3–64 MB) in seconds. The copy lands in the crop directory's `basemap/` folder, which a deploy leaves
 * alone, and [[controllers.BasemapController]] serves it. The tool itself is downloaded once per server into the crop
 * directory's shared parent, checked against the release's published checksum.
 */
@Singleton
class BasemapServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    ws: WSClient,
    regionTable: RegionTable,
    config: Configuration,
    environment: Environment,
    cpuEc: CpuIntensiveExecutionContext
)(using ec: ExecutionContext, mat: Materializer)
    extends BasemapService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  import BasemapService.*

  private val logger  = Logger(this.getClass)
  private val running = AtomicBoolean(false)

  private val cityDir: File    = MediaDirs.cityDir(config, environment, "cropped.image.directory")
  private val basemapDir: File = File(cityDir, "basemap")

  def isRunning: Boolean = running.get()

  def currentArchive: Option[String] = archivesNewestFirst.headOption

  def archiveFile(name: String): Option[File] =
    Option.when(isArchiveName(name))(File(basemapDir, name)).filter(_.isFile)

  def refresh(force: Boolean): Future[BasemapRefreshResult] = {
    if (!running.compareAndSet(false, true)) {
      Future.failed(IllegalStateException("A basemap refresh is already in progress."))
    } else {
      // Future.delegate so a synchronous throw while building the work still releases the guard.
      Future
        .delegate {
          val today = LocalDate.now(ScheduleZone)
          val cutOn = currentArchive.flatMap(cutAt).map(LocalDate.ofInstant(_, ScheduleZone))
          if (!force && !isDue(cutOn, today)) Future.successful(skipped)
          else {
            db.run(regionTable.regionsExtent).flatMap {
              case None =>
                logger.warn("Basemap refresh skipped: the city has no regions, so there is no area to cut.")
                Future.successful(skipped)
              case Some(extent) => build(extent.padded(MarginM))
            }
          }
        }
        .andThen { case _ => running.set(false) }
    }
  }

  private def skipped: BasemapRefreshResult = BasemapRefreshResult(skipped = true, currentArchive, None, None)

  private def archivesNewestFirst: Seq[String] =
    newestFirst(Option(basemapDir.list()).map(_.toSeq).getOrElse(Seq.empty))

  /**
   * Cuts the box out of the newest Protomaps build the style can read and makes it the current archive.
   *
   * @param bbox The regions' extent, padded by [[MarginM]].
   */
  private def build(bbox: LatLngBBox): Future[BasemapRefreshResult] = {
    for {
      build <- ws.url(BuildsUrl).withRequestTimeout(1.minute).get().map { response =>
        if (response.status != 200) throw RuntimeException(s"Protomaps build list answered ${response.status}.")
        latestBuild(response.json).getOrElse {
          throw RuntimeException(s"Protomaps lists no build in schema version $SchemaMajorVersion.")
        }
      }
      _ = buildDate(build).filter(_.isBefore(LocalDate.now(ScheduleZone).minusDays(MaxAgeDays))).foreach { date =>
        // Protomaps has likely moved to a schema version MinimapBasemapStyle.js doesn't read yet.
        logger.warn(s"The newest schema-$SchemaMajorVersion Protomaps build is from $date; the style needs updating.")
      }
      cli    <- ensureCli()
      result <- Future(blocking(extract(cli, build, bbox)))(using cpuEc)
    } yield result
  }

  /** Cuts into a temporary file and moves it into place, so a failed cut never replaces a good archive. Blocks. */
  private def extract(cli: File, build: String, bbox: LatLngBBox): BasemapRefreshResult = {
    Files.createDirectories(basemapDir.toPath)
    deleteStale(basemapDir, ExtractTimeout)
    val name   = archiveName(build, Instant.now)
    val tmp    = File(basemapDir, s".$name.part")
    val box    = s"${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}"
    val source = s"$BuildBaseUrl$build.pmtiles"
    try {
      run(Seq(cli.getAbsolutePath, "extract", source, tmp.getAbsolutePath, s"--bbox=$box"), ExtractTimeout)
      if (!tmp.isFile || tmp.length == 0) throw RuntimeException("pmtiles extract wrote no archive.")
      Files.move(tmp.toPath, File(basemapDir, name).toPath, StandardCopyOption.ATOMIC_MOVE)
    } finally {
      val _ = tmp.delete()
    }
    val keepAfter = Instant.now.minusMillis(KeepRecentFor.toMillis)
    archivesNewestFirst.drop(KeptArchives).filter(cutAt(_).forall(_.isBefore(keepAfter))).foreach { old =>
      if (!File(basemapDir, old).delete()) logger.warn(s"Could not delete the old basemap archive $old.")
    }
    val bytes = File(basemapDir, name).length
    logger.info(s"Basemap archive $name cut from Protomaps build $build over $box: $bytes bytes.")
    BasemapRefreshResult(skipped = false, Some(name), Some(build), Some(bytes))
  }

  /**
   * The pmtiles tool, downloaded and checked first if this server doesn't have this version yet.
   *
   * Every city on a server shares one copy (it is 57 MB) in the crop directory's parent; a city that can't write
   * there keeps its own. Two cities downloading at once each write a private temporary file and move it into place,
   * so neither ever runs a half-written tool.
   */
  private def ensureCli(): Future[File] = {
    val arch = cliArch(System.getProperty("os.arch")).getOrElse {
      throw RuntimeException(s"pmtiles has no Linux build for this processor (${System.getProperty("os.arch")}).")
    }
    val toolPath = s"tools/pmtiles-$CliVersion"
    val shared   = File(MediaDirs.baseDir(config, environment, "cropped.image.directory"), toolPath)
    // Trying to create the shared folder is the test of whether we may write there: on a fresh server it doesn't
    // exist yet, so asking whether it is writable would always say no.
    val writable = Try(Files.createDirectories(shared.toPath)).isSuccess && Files.isWritable(shared.toPath)
    val toolsDir = if (writable) shared else File(cityDir, toolPath)
    val cli      = File(toolsDir, "pmtiles")
    if (cli.canExecute) Future.successful(cli)
    else {
      Files.createDirectories(toolsDir.toPath)
      deleteStale(toolsDir, 1.hour)
      val stamp   = s"${ProcessHandle.current.pid}-${System.nanoTime}"
      val archive = File(toolsDir, s".download-$stamp.tar.gz")
      val unpack  = File(toolsDir, s".unpack-$stamp")
      val url     = s"https://github.com/protomaps/go-pmtiles/releases/download/v$CliVersion/" +
        s"go-pmtiles_${CliVersion}_Linux_$arch.tar.gz"
      ws.url(url)
        .withRequestTimeout(5.minutes)
        .withFollowRedirects(true)
        .stream()
        .flatMap { response =>
          if (response.status != 200) throw RuntimeException(s"Downloading pmtiles answered ${response.status}.")
          response.bodyAsSource.runWith(FileIO.toPath(archive.toPath))
        }
        .andThen { case scala.util.Failure(_) => archive.delete() }
        .map { _ =>
          blocking {
            try {
              val bytes  = Files.readAllBytes(archive.toPath)
              val digest = HexFormat.of.formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))
              if (digest != CliSha256(arch)) throw RuntimeException(s"pmtiles download failed its checksum ($digest).")
              Files.createDirectories(unpack.toPath)
              // --no-same-owner: as root (the dev container) tar would otherwise keep the release's own file owner.
              val tar = Seq("tar", "--no-same-owner", "-xzf", archive.getAbsolutePath, "-C", unpack.getAbsolutePath)
              run(tar :+ "pmtiles", 1.minute)
              val unpacked = File(unpack, "pmtiles")
              if (!unpacked.setExecutable(true)) throw RuntimeException("Could not make pmtiles executable.")
              Files.move(unpacked.toPath, cli.toPath, StandardCopyOption.ATOMIC_MOVE)
              logger.info(s"Downloaded pmtiles $CliVersion to $cli.")
              // Every city runs the same version, so older versions' folders (57 MB each) are no longer needed.
              Option(toolsDir.getParentFile.listFiles()).toSeq.flatten
                .filter(dir => dir.getName.startsWith("pmtiles-") && dir != toolsDir)
                .foreach { dir =>
                  Option(dir.listFiles()).foreach(_.foreach(_.delete()))
                  val _ = dir.delete()
                }
              cli
            } finally {
              val _ = archive.delete()
              Option(unpack.listFiles()).foreach(_.foreach(_.delete()))
              val _ = unpack.delete()
            }
          }
        }(using cpuEc)
    }
  }

  /**
   * Deletes the temporary files (names starting with a dot) a killed run left in a folder.
   *
   * @param dir       The folder to sweep.
   * @param olderThan Only files at least this old, so a run in progress in another city keeps its own.
   */
  private def deleteStale(dir: File, olderThan: FiniteDuration): Unit = {
    val cutoff = System.currentTimeMillis - olderThan.toMillis
    Option(dir.listFiles()).toSeq.flatten.filter(f => f.getName.startsWith(".") && f.lastModified < cutoff).foreach {
      stale =>
        Option(stale.listFiles()).foreach(_.foreach(_.delete()))
        if (!stale.delete()) logger.warn(s"Could not delete the leftover file $stale.")
    }
  }

  /**
   * Runs a command to completion, failing with the end of its output if it exits non-zero or outlasts the timeout.
   * The output goes to a file rather than a pipe, so a chatty command can't stall on a full pipe nobody is reading.
   *
   * @param command The program and its arguments.
   * @param timeout How long it may run before it is killed.
   */
  private def run(command: Seq[String], timeout: FiniteDuration): Unit = {
    val log = Files.createTempFile("sidewalk-basemap-", ".log")
    try {
      val process = ProcessBuilder(command*).redirectErrorStream(true).redirectOutput(log.toFile).start()
      if (!process.waitFor(timeout.toMillis, TimeUnit.MILLISECONDS)) {
        process.destroyForcibly()
        throw RuntimeException(s"${command.head} ran longer than $timeout and was stopped.")
      }
      if (process.exitValue != 0) {
        val output = Files.readString(log).trim.takeRight(2000)
        throw RuntimeException(s"${command.head} failed (exit ${process.exitValue}): $output")
      }
    } finally {
      val _ = Files.deleteIfExists(log)
    }
  }
}
