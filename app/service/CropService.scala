package service

import com.google.inject.ImplementedBy
import executors.CpuIntensiveExecutionContext
import models.label.{LabelTable, LabelTypeEnum}
import models.pano.PanoDataTable
import models.utils.MyPostgresProfile.api._
import models.utils.{ImageUtils, MyPostgresProfile}
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsObject, Json}
import play.api.{Configuration, Logger}
import service.CropGeometry.CropBox
import service.CropService._

import java.awt.Image
import java.awt.image.BufferedImage
import java.io.File
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicBoolean
import javax.imageio.ImageReader
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters._
import scala.util.Using
import scala.util.control.NonFatal

object CropService {

  /**
   * A label the crop job may cut a crop for.
   *
   * @param panoWidth  The pano's width as `pano_data` records it — the frame `panoX` is expressed in — or None.
   * @param panoHeight The pano's height as `pano_data` records it, or None.
   */
  case class CropCandidate(
      labelId: Int,
      labelType: LabelTypeEnum.Base,
      panoId: String,
      panoX: Int,
      panoY: Int,
      panoWidth: Option[Int],
      panoHeight: Option[Int]
  )

  /**
   * What one run did. The disjoint outcomes for a label are: cropped, skipped for a pano with no self-hosted image,
   * skipped on a dimension mismatch, skipped as out of frame, or errored; `shiftedVertically` and `dimsUnverified`
   * annotate crops that were written, the first with the label off-centre and the second without a recorded frame to
   * check the label's position against.
   */
  case class CropRunResult(
      panosOpened: Int,
      panosWithoutBackup: Int,
      cropsWritten: Int,
      shiftedVertically: Int,
      outOfFrame: Int,
      dimsMismatch: Int,
      dimsUnverified: Int,
      downscaledWritten: Int,
      errors: Int
  ) {

    /** One-line account of the run, for the log and the admin trigger's response. */
    def summary: String =
      s"Crop generation (rule ${CropSizingRule.Version}): opened $panosOpened panos, wrote $cropsWritten crops " +
        s"($shiftedVertically shifted to stay inside the pano, $dimsUnverified against a pano whose dimensions the " +
        s"database doesn't record) and $downscaledWritten downscaled panos; skipped $panosWithoutBackup panos " +
        s"with no self-hosted image, $dimsMismatch labels on a dimension mismatch and $outOfFrame labels outside " +
        s"the image; $errors errors."

    /** The counts as stored against the run's `background_job_run` row, shared by the nightly and manual triggers. */
    def runDetails: JsObject = Json.obj(
      "crop_rule_version"    -> CropSizingRule.Version,
      "panos_opened"         -> panosOpened,
      "panos_without_backup" -> panosWithoutBackup,
      "crops_written"        -> cropsWritten,
      "shifted_vertically"   -> shiftedVertically,
      "out_of_frame"         -> outOfFrame,
      "dims_mismatch"        -> dimsMismatch,
      "dims_unverified"      -> dimsUnverified,
      "downscaled_written"   -> downscaledWritten,
      "errors"               -> errors
    )
  }

  /** JPEG quality for downscaled panos: they exist to be looked at in a pano viewer, not to be cut from. */
  val DownscaledJpegQuality: Float = 0.85f

  /** The most source rows one downscaling strip holds at once (a 16384-wide strip this tall is ~67 MB as RGB). */
  val MaxStripRows: Int = 1024

  /**
   * Cuts a window out of the panorama behind `reader`, keeping only the window's own pixels and stitching the two
   * runs of a window that crosses the equirectangular seam.
   *
   * What a region read saves is memory, not decoding: ImageIO walks the compressed stream from the start every time
   * ([[ImageUtils.readRegion]]), so a pano costs one pass per window plus one per downscaling strip. Bounding the
   * peak raster is the whole point — cutting a second window is cheap in memory and is not free in CPU.
   *
   * @param reader    A reader from [[ImageUtils.withReader]].
   * @param box       The window, per [[CropGeometry.computeCropBox]].
   * @param panoWidth The pano's width, which decides where the seam is.
   * @return          The window, `box.width` x `box.height`, opaque RGB.
   */
  def cutWindow(reader: ImageReader, box: CropBox, panoWidth: Int): BufferedImage = {
    val out = new BufferedImage(box.width, box.height, BufferedImage.TYPE_INT_RGB)
    val g   = out.createGraphics()
    try {
      CropGeometry.segments(box, panoWidth).foreach { segment =>
        val run = ImageUtils.readRegion(reader, segment.srcX, box.top, segment.width, box.height)
        val _   = g.drawImage(run, segment.dstX, 0, null)
      }
    } finally g.dispose()
    out
  }

  /**
   * The stored form of a cut window: at most [[CropGeometry.MaxStoredWidth]] wide, never upscaled. A 3:2 window's
   * long edge is its width, so the shared longest-edge cap is exactly the width cap.
   */
  def storedCrop(window: BufferedImage): BufferedImage =
    ImageUtils.scaleToMaxEdge(window, CropGeometry.MaxStoredWidth)

  /**
   * How many source rows each downscaling strip covers, chosen so that every strip boundary lands on a whole output
   * row. With `unit = srcHeight / gcd(srcHeight, targetHeight)`, a strip of `k * unit` source rows maps to exactly
   * `k * targetHeight / gcd` output rows, so scaling strips independently is identical to scaling the whole image
   * and there are no seams. The strip is the largest multiple of `unit` under [[MaxStripRows]], or `unit` itself
   * when even one is taller (a pano whose heights share no factor is then read as a single strip).
   *
   * @return Source rows per strip.
   */
  def stripRows(srcHeight: Int, targetHeight: Int): Int = {
    val unit = srcHeight / gcd(srcHeight, targetHeight)
    if (unit >= MaxStripRows) unit else (MaxStripRows / unit) * unit
  }

  /**
   * Writes the downscaled copy of a panorama: the same image, `targetWidth` wide, as a JPEG.
   *
   * Reads the source in horizontal strips ([[stripRows]]) and area-averages each into its rows of the output, so
   * memory is bounded by the output plus one strip rather than by the native pano.
   *
   * @param reader      A reader from [[ImageUtils.withReader]].
   * @param srcWidth    The pano's width.
   * @param srcHeight   The pano's height.
   * @param targetWidth Width to write; the height follows from the pano's aspect.
   * @param file        Where to write it; parent directories are created.
   */
  def writeDownscaled(reader: ImageReader, srcWidth: Int, srcHeight: Int, targetWidth: Int, file: File): Unit = {
    val targetHeight = math.max(1, Math.rint(srcHeight.toDouble * targetWidth / srcWidth).toInt)
    val out          = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_RGB)
    val g            = out.createGraphics()
    try {
      val rows = stripRows(srcHeight, targetHeight)
      var top  = 0
      while (top < srcHeight) {
        val height    = math.min(rows, srcHeight - top)
        val strip     = ImageUtils.readRegion(reader, 0, top, srcWidth, height)
        val dstTop    = (top.toLong * targetHeight / srcHeight).toInt
        val dstBottom = ((top + height).toLong * targetHeight / srcHeight).toInt
        val scaled    = strip.getScaledInstance(targetWidth, dstBottom - dstTop, Image.SCALE_AREA_AVERAGING)
        val _         = g.drawImage(scaled, 0, dstTop, null)
        top += height
      }
    } finally g.dispose()
    val _ = file.getParentFile.mkdirs()
    ImageUtils.writeJpeg(out, file, DownscaledJpegQuality)
  }

  private def gcd(a: Int, b: Int): Int = if (b == 0) a else gcd(b, a % b)
}

/**
 * Derived imagery cut from the self-hosted panorama store: per-label crop images and per-pano downscaled copies
 * (#4865).
 *
 * Both are derived data, regenerated by a nightly reconciliation job rather than written inline with any submission:
 * generation is idempotent and order-independent, so a label can't be stranded by arriving before its pano's pixels,
 * and a change to the crop geometry is a matter of deleting the store and letting the job rebuild it.
 */
@ImplementedBy(classOf[CropServiceImpl])
trait CropService {

  /**
   * Cuts a crop for every live label that has none and whose pano has a self-hosted image, and a downscaled copy
   * for every self-hosted pano wider than the viewer can render. At most one run at a time: a second call while one
   * is in flight fails with [[IllegalStateException]].
   */
  def generateMissingCrops(): Future[CropRunResult]

  /** Whether a run is in flight. */
  def isRunning: Boolean

  /** Where a pano's downscaled copy is, or would be, stored. */
  def downscaledImageFile(panoId: String): File

  /** The pano's downscaled copy, when one has been written. */
  def existingDownscaledImage(panoId: String): Option[File]
}

@Singleton
class CropServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    panoDataService: PanoDataService,
    labelTable: LabelTable,
    panoDataTable: PanoDataTable,
    shareImageCache: ShareImageCache,
    cpuEc: CpuIntensiveExecutionContext
)(implicit ec: ExecutionContext, mat: Materializer)
    extends CropService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val logger = Logger(this.getClass)

  private val downscaledMaxWidth: Int = config.get[Int]("pano.downscaled.max-width")
  private val cropsDir: File          = new File(panoDataService.getCropDirectory)

  // Beside the crops rather than in a store of its own: same nightly job, same disposability, so one derived-imagery
  // directory covers both and a deployment has one fewer path to provision. Never inside pano.images.directory —
  // localBackupImageFile scans that store by extension, so a downscaled copy beside a native file would be picked
  // up as the native file, served as the archive and cut from at the wrong scale.
  private val downscaledDir: File = new File(cropsDir, "pano-downscaled")

  private val running = new AtomicBoolean(false)

  /** Mutable tallies for one run; `result` freezes them. */
  private class Counts {
    var panosOpened, panosWithoutBackup, cropsWritten, shiftedVertically, outOfFrame, dimsMismatch, dimsUnverified,
        downscaledWritten, errors = 0

    def result: CropRunResult = CropRunResult(
      panosOpened, panosWithoutBackup, cropsWritten, shiftedVertically, outOfFrame, dimsMismatch, dimsUnverified,
      downscaledWritten, errors
    )
  }

  def isRunning: Boolean = running.get()

  def downscaledImageFile(panoId: String): File = new File(new File(downscaledDir, panoId.take(2)), s"$panoId.jpg")

  def existingDownscaledImage(panoId: String): Option[File] = Some(downscaledImageFile(panoId)).filter(_.isFile)

  def generateMissingCrops(): Future[CropRunResult] = {
    if (!running.compareAndSet(false, true)) {
      Future.failed(new IllegalStateException("A crop generation run is already in progress."))
    } else {
      val counts = new Counts
      // Future.delegate so that a synchronous throw (an unreadable crop store, say) still releases the guard.
      Future
        .delegate {
          val existing = existingCropIds()
          for {
            candidates <- cropCandidates(existing)
            backed     <- Future(cutCrops(candidates, counts))(cpuEc)
            _          <- markHasBackup(backed)
            wide       <- db.run(panoDataTable.getWideBackupPanos(downscaledMaxWidth))
            _          <- Future(writeMissingDownscaled(wide, counts))(cpuEc)
          } yield counts.result
        }
        .andThen { case _ => running.set(false) }
    }
  }

  private val CropFileName = """crop_(\d+)\.png""".r

  /** The labels that already have a crop, by listing each type's directory once rather than stat-ing per label. */
  private def existingCropIds(): Map[LabelTypeEnum.Base, Set[Int]] = {
    LabelTypeEnum.values.iterator.map { labelType =>
      val dir = new File(cropsDir, labelType.name)
      val ids =
        if (!dir.isDirectory) Set.empty[Int]
        else
          Using.resource(Files.list(dir.toPath)) { paths =>
            paths.iterator().asScala.map(_.getFileName.toString).collect { case CropFileName(id) => id.toInt }.toSet
          }
      labelType -> ids
    }.toMap
  }

  /** Every live label without a crop, streamed from the whole label table and filtered as rows arrive. */
  private def cropCandidates(existing: Map[LabelTypeEnum.Base, Set[Int]]): Future[Seq[CropCandidate]] = {
    Source
      .fromPublisher(
        db.stream(labelTable.getCropCandidates.transactionally.withStatementParameters(fetchSize = 1000))
      )
      .map { case (labelId, labelType, panoId, panoX, panoY, width, height) =>
        CropCandidate(labelId, labelType, panoId, panoX, panoY, width, height)
      }
      .filterNot(c => existing.getOrElse(c.labelType, Set.empty).contains(c.labelId))
      .runWith(Sink.seq)
  }

  /**
   * Cuts the candidates' crops, one pano at a time so each file is opened once and never held whole in memory.
   *
   * @return The panos that turned out to be in the store, for [[markHasBackup]].
   */
  private def cutCrops(candidates: Seq[CropCandidate], counts: Counts): Seq[String] = {
    val backed = Seq.newBuilder[String]
    candidates.groupBy(_.panoId).foreach { case (panoId, labels) =>
      panoDataService.localBackupImageFile(panoId) match {
        case None       => counts.panosWithoutBackup += 1
        case Some(file) =>
          backed += panoId
          try {
            ImageUtils.withReader(file) { (reader, width, height) =>
              counts.panosOpened += 1
              // The label positions are in the frame pano_data recorded, so an image of another size would put
              // every crop in the wrong place: skip loudly rather than mis-centre.
              val recorded = labels.head
              if (recorded.panoWidth.exists(_ != width) || recorded.panoHeight.exists(_ != height)) {
                counts.dimsMismatch += labels.size
                logger.warn(
                  s"Pano $panoId: pano_data says ${recorded.panoWidth}x${recorded.panoHeight} but the stored image " +
                    s"is ${width}x$height; skipping its ${labels.size} labels rather than mis-centring their crops."
                )
              } else {
                // A row that records no dimensions gives that check nothing to fail on, so the crop is cut against
                // the stored image on the assumption the label was placed on the same frame. Usually true — the
                // scraper stores what the client saw — but nothing here confirms it, so the run says how often it
                // had to assume rather than passing the case off as verified.
                if (recorded.panoWidth.isEmpty || recorded.panoHeight.isEmpty) {
                  counts.dimsUnverified += labels.size
                  logger.warn(
                    s"Pano $panoId: pano_data records no dimensions, so nothing confirms its ${labels.size} labels " +
                      s"were placed on a ${width}x$height frame; cropping against the stored image anyway."
                  )
                }
                labels.foreach(label => cutCrop(reader, width, height, label, counts))
              }
              writeDownscaledIfWide(panoId, reader, width, height, counts)
            }
          } catch {
            case NonFatal(e) =>
              counts.errors += labels.size
              logger.warn(s"Pano $panoId: cannot read ${file.getPath}, skipping its ${labels.size} labels: $e")
          }
      }
    }
    backed.result()
  }

  private def cutCrop(reader: ImageReader, width: Int, height: Int, label: CropCandidate, counts: Counts): Unit = {
    // The poles are not adjacent, so a y outside the image would clamp to one and yield clean imagery of a place the
    // label is not in. x needs no such check: column 0 and column `width` are the same place, so any x wraps correctly.
    if (label.panoY < 0 || label.panoY >= height) {
      counts.outOfFrame += 1
      logger.warn(s"Label ${label.labelId} on pano ${label.panoId}: pano_y ${label.panoY} is outside the image.")
    } else {
      try {
        val window = CropSizingRule.windowWidth(label.panoY.toDouble, height)
        val box    = CropGeometry.computeCropBox(label.panoX.toDouble, label.panoY.toDouble, window, width, height)
        val crop   = storedCrop(cutWindow(reader, box, width))
        val target = panoDataService.cropFile(label.labelId, label.labelType.name)
        val _      = target.getParentFile.mkdirs()
        ImageUtils.writePng(crop, target)
        // A share preview built before the crop existed would otherwise be served forever (#4726).
        shareImageCache.invalidate(label.labelId)
        counts.cropsWritten += 1
        if (box.shifted) counts.shiftedVertically += 1
      } catch {
        case NonFatal(e) =>
          counts.errors += 1
          logger.warn(s"Failed to crop label ${label.labelId} on pano ${label.panoId}: $e")
      }
    }
  }

  /**
   * Whether the downscaled copy on disk is the one the current configuration asks for.
   *
   * Checked rather than assumed because a `pano.downscaled.max-width` change is otherwise invisible: the file exists, so
   * nothing recuts it, and `/backupImage` goes on serving the old width in place of the native pano — the one thing
   * lowering the cap was meant to stop. A file that won't open reads as out of date too, so a truncated copy heals
   * on the next run.
   */
  private def downscaledIsCurrent(panoId: String): Boolean = {
    val file = downscaledImageFile(panoId)
    file.isFile && {
      try ImageUtils.withReader(file)((_, width, _) => width == downscaledMaxWidth)
      catch { case NonFatal(_) => false }
    }
  }

  private def writeDownscaledIfWide(
      panoId: String,
      reader: ImageReader,
      width: Int,
      height: Int,
      counts: Counts
  ): Unit =
    if (width > downscaledMaxWidth && !downscaledIsCurrent(panoId)) {
      try {
        writeDownscaled(reader, width, height, downscaledMaxWidth, downscaledImageFile(panoId))
        counts.downscaledWritten += 1
      } catch {
        case NonFatal(e) =>
          counts.errors += 1
          logger.warn(s"Failed to write the downscaled copy of pano $panoId: $e")
      }
    }

  /** Downscaled copies for backed-up panos the crop pass had no reason to open (every label already cropped). */
  private def writeMissingDownscaled(panoIds: Seq[String], counts: Counts): Unit = {
    panoIds.filterNot(downscaledIsCurrent).foreach { panoId =>
      panoDataService.localBackupImageFile(panoId).foreach { file =>
        try {
          ImageUtils.withReader(file) { (reader, width, height) =>
            counts.panosOpened += 1
            writeDownscaledIfWide(panoId, reader, width, height, counts)
          }
        } catch {
          case NonFatal(e) =>
            counts.errors += 1
            logger.warn(s"Pano $panoId: cannot read ${file.getPath} to downscale it: $e")
        }
      }
    }
  }

  /**
   * Records what the store turned out to hold: the disk is the truth about which panos are backed up and the row is
   * a cache of it (#4865). One statement rather than a round trip per pano — the crop pass is a single thread of the
   * CPU-intensive pool, and awaiting a network hop per pano would spend that thread on latency.
   */
  private def markHasBackup(panoIds: Seq[String]): Future[Unit] = {
    db.run(panoDataTable.markHasBackup(panoIds))
      .map(_ => ())
      .recover { case NonFatal(e) =>
        logger.warn(s"Failed to update has_backup for ${panoIds.size} panos: ${e.getMessage}")
      }
  }
}
