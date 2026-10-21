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
 * @param skipped True when nothing was built (archive fresh enough, or no regions yet).
 * @param archive The archive the minimap reads afterwards, if any.
 * @param build   The Protomaps build date it was cut from, when this run built one.
 * @param bytes   The new archive's size, when this run built one.
 */
case class BasemapRefreshResult(skipped: Boolean, archive: Option[String], build: Option[String], bytes: Option[Long]) {

  /** @return The run's `details` for its `background_job_run` row. */
  def runDetails: JsObject = Json.obj("skipped" -> skipped, "archive" -> archive, "build" -> build, "bytes" -> bytes)
}

/** Builds and finds the city's minimap basemap archive (#5716). */
@ImplementedBy(classOf[BasemapServiceImpl])
trait BasemapService {

  /**
   * Cuts the city out of the newest Protomaps world build. One run at a time; a second call fails.
   *
   * @param force True to build regardless of the archive's age; false builds only when [[BasemapService.isDue]].
   * @return      What the run did.
   */
  def refresh(force: Boolean): Future[BasemapRefreshResult]

  /** Whether a refresh is in flight. */
  def isRunning: Boolean

  /** The newest archive's file name (also its URL), or None before the first build. */
  def currentArchive: Option[String]

  /**
   * @param name An archive file name, possibly an older one a page loaded before the last refresh.
   * @return     That archive, or None when it isn't one on disk.
   */
  def archiveFile(name: String): Option[File]
}

object BasemapService {

  /** The pmtiles tool the app downloads itself, with GitHub's published checksum for each release file. */
  val CliVersion: String             = "1.31.2"
  val CliSha256: Map[String, String] = Map(
    "x86_64" -> "3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f",
    "arm64"  -> "f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1"
  )

  /** Protomaps' list of world builds; old ones get deleted, so each run looks up the newest. */
  val BuildsUrl: String = "https://build-metadata.protomaps.dev/builds.json"

  val BuildBaseUrl: String = "https://build.protomaps.com/"

  /** The schema version MinimapBasemapStyle.js reads; a new major version renames layers, so we stay on this one. */
  val SchemaMajorVersion: Int = 4

  /** Rebuild once the 1st of one of these months has passed since the last cut. */
  val RefreshMonths: Set[Int] = Set(1, 4, 7, 10)

  /** If our schema's newest build is older than this, Protomaps has moved on and the style needs updating. */
  val StaleBuildDays: Long = 100

  /** How far past the regions the archive reaches; at a region's edge the minimap shows ~600 m beyond it. */
  val MarginM: Double = 2000

  /** Archives kept: the newest two, plus any cut in the last day, since an open Explore tab may still read them. */
  val KeptArchives: Int             = 2
  val KeepRecentFor: FiniteDuration = 1.day

  /** A cut takes seconds; this only stops a hung download. */
  val ExtractTimeout: FiniteDuration = 15.minutes

  /** The scheduler's time zone, so "the 1st" means the same day to both. */
  val ScheduleZone: ZoneId = ZoneId.of("America/Los_Angeles")

  private val BuildDate = DateTimeFormatter.BASIC_ISO_DATE

  /** `basemap-<build date>-<cut time>.pmtiles`: a new name per cut, so a cached copy is never stale. */
  private val ArchiveName = """basemap-(\d{8})-(\d+)\.pmtiles""".r

  def archiveName(build: String, now: Instant): String = s"basemap-$build-${now.getEpochSecond}.pmtiles"

  /** Archive file names, newest cut first, dropping anything else. */
  def newestFirst(names: Seq[String]): Seq[String] =
    names
      .flatMap(name => cutAt(name).map(_ -> name))
      .sortBy(_._1)
      .reverse
      .map(_._2)

  /** Whether a name is an archive's, so a request can't reach any other file. */
  def isArchiveName(name: String): Boolean = ArchiveName.matches(name)

  def cutAt(name: String): Option[Instant] = name match {
    case ArchiveName(_, seconds) => seconds.toLongOption.map(Instant.ofEpochSecond)
    case _                       => None
  }

  def buildDate(build: String): Option[LocalDate] = Try(LocalDate.parse(build, BuildDate)).toOption

  /**
   * Due when nothing has been cut since the latest refresh date, so a missed or failed refresh retries nightly.
   *
   * @param current The day the current archive was cut, or None.
   * @param today   Today, in [[ScheduleZone]].
   * @return        Whether to cut a new archive.
   */
  def isDue(current: Option[LocalDate], today: LocalDate): Boolean = {
    val month       = RefreshMonths.filter(_ <= today.getMonthValue).maxOption
    val lastRefresh =
      month.fold(LocalDate.of(today.getYear - 1, RefreshMonths.max, 1))(LocalDate.of(today.getYear, _, 1))
    current.forall(_.isBefore(lastRefresh))
  }

  /**
   * @param builds The [[BuildsUrl]] listing: `[{key: "20261015.pmtiles", version: "4.15.2", ...}]`.
   * @return       The newest build's date in our schema version (`20261015`), or None.
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

  /** The release files' name for this processor, or None if pmtiles has no Linux build for it. */
  def cliArch(osArch: String): Option[String] = osArch match {
    case "amd64" | "x86_64"  => Some("x86_64")
    case "aarch64" | "arm64" => Some("arm64")
    case _                   => None
  }
}

/**
 * Keeps the city's own copy of the minimap's map tiles (#5716): the `pmtiles` tool copies the city's area (3–64 MB)
 * out of Protomaps' daily world file into the crop directory's `basemap/` folder, which deploys leave alone.
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
      // Future.delegate so a synchronous throw still releases the guard.
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
   * @param bbox The regions' extent, padded by [[MarginM]].
   * @return     The run's result, after cutting the box out of the newest readable build.
   */
  private def build(bbox: LatLngBBox): Future[BasemapRefreshResult] = {
    for {
      build <- ws.url(BuildsUrl).withRequestTimeout(1.minute).get().map { response =>
        if (response.status != 200) throw RuntimeException(s"Protomaps build list answered ${response.status}.")
        latestBuild(response.json).getOrElse {
          throw RuntimeException(s"Protomaps lists no build in schema version $SchemaMajorVersion.")
        }
      }
      _ = buildDate(build).filter(_.isBefore(LocalDate.now(ScheduleZone).minusDays(StaleBuildDays))).foreach { date =>
        logger.warn(s"The newest schema-$SchemaMajorVersion Protomaps build is from $date; the style needs updating.")
      }
      cli    <- ensureCli()
      result <- Future(blocking(extract(cli, build, bbox)))(using cpuEc)
    } yield result
  }

  /** Cuts into a temp file and then moves it into place, so a failed cut never replaces a good archive. */
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
   * Downloads the pmtiles tool if needed. Cities share one 57 MB copy; a city that can't write there keeps its own.
   *
   * @return The tool's executable.
   */
  private def ensureCli(): Future[File] = {
    val arch = cliArch(System.getProperty("os.arch")).getOrElse {
      throw RuntimeException(s"pmtiles has no Linux build for this processor (${System.getProperty("os.arch")}).")
    }
    val toolPath = s"tools/pmtiles-$CliVersion"
    val shared   = File(MediaDirs.baseDir(config, environment, "cropped.image.directory"), toolPath)
    // Create first: on a fresh server the folder doesn't exist, so "is it writable?" would always say no.
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
              // Without --no-same-owner, tar run as root (the dev container) keeps the release's file owner.
              val tar = Seq("tar", "--no-same-owner", "-xzf", archive.getAbsolutePath, "-C", unpack.getAbsolutePath)
              run(tar :+ "pmtiles", 1.minute)
              val unpacked = File(unpack, "pmtiles")
              if (!unpacked.setExecutable(true)) throw RuntimeException("Could not make pmtiles executable.")
              Files.move(unpacked.toPath, cli.toPath, StandardCopyOption.ATOMIC_MOVE)
              logger.info(s"Downloaded pmtiles $CliVersion to $cli.")
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
   * Deletes temp files (dot-named) that a killed run left behind.
   *
   * @param dir       The folder to sweep.
   * @param olderThan Minimum age, so another city's run in progress keeps its files.
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
   * Runs a command, failing with its output on an error or timeout; output goes to a file so it can't stall a pipe.
   *
   * @param command The program and its arguments.
   * @param timeout How long before it is killed.
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
