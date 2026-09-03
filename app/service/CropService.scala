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
import play.api.{Configuration, Environment, Logger}
import service.CropGeometry.CropBox
import service.CropService._

import java.awt.Image
import java.awt.image.BufferedImage
import java.io.File
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicBoolean
import javax.imageio.ImageReader
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
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
   * skipped on a dimension mismatch, skipped as out of frame, or errored; `shiftedVertically` annotates crops that
   * were written with the label off-centre.
   */
  case class CropRunResult(
      panosOpened: Int,
      panosWithoutBackup: Int,
      cropsWritten: Int,
      shiftedVertically: Int,
      outOfFrame: Int,
      dimsMismatch: Int,
      derivativesWritten: Int,
      errors: Int
  ) {

    /** One-line account of the run, for the log and the admin trigger's response. */
    def summary: String =
      s"Crop generation (rule ${CropSizingRule.Version}): opened $panosOpened panos, wrote $cropsWritten crops " +
        s"($shiftedVertically shifted to stay inside the pano) and $derivativesWritten display derivatives; skipped " +
        s"$panosWithoutBackup panos with no self-hosted image, $dimsMismatch labels on a dimension mismatch and " +
        s"$outOfFrame labels outside the image; $errors errors."

    /** The counts as stored against the run's `background_job_run` row, shared by the nightly and manual triggers. */
    def runDetails: JsObject = Json.obj(
      "crop_rule_version"    -> CropSizingRule.Version,
      "panos_opened"         -> panosOpened,
      "panos_without_backup" -> panosWithoutBackup,
      "crops_written"        -> cropsWritten,
      "shifted_vertically"   -> shiftedVertically,
      "out_of_frame"         -> outOfFrame,
      "dims_mismatch"        -> dimsMismatch,
      "derivatives_written"  -> derivativesWritten,
      "errors"               -> errors
    )
  }

  /** JPEG quality for display derivatives: they exist to be looked at in a pano viewer, not to be cut from. */
  val DerivativeJpegQuality: Float = 0.85f

  /** The most source rows one derivative strip decodes at once (a 16384-wide strip this tall is ~50 MB). */
  val MaxStripRows: Int = 1024

  /**
   * Cuts a window out of the panorama behind `reader`, decoding only the window's own pixels and stitching the two
   * runs of a window that crosses the equirectangular seam.
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
   * How many source rows each derivative strip covers, chosen so that every strip boundary lands on a whole output
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
   * Writes the display derivative of a panorama: the same image, `targetWidth` wide, as a JPEG.
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
  def writeDerivative(reader: ImageReader, srcWidth: Int, srcHeight: Int, targetWidth: Int, file: File): Unit = {
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
    ImageUtils.writeJpeg(out, file, DerivativeJpegQuality)
  }

  private def gcd(a: Int, b: Int): Int = if (b == 0) a else gcd(b, a % b)
}

/**
 * Derived imagery cut from the self-hosted panorama store: per-label crop images and per-pano display derivatives
 * (#4865).
 *
 * Both are derived data, regenerated by a nightly reconciliation job rather than written inline with any submission:
 * generation is idempotent and order-independent, so a label can't be stranded by arriving before its pano's pixels,
 * and a change to the crop geometry is a matter of deleting the store and letting the job rebuild it.
 */
@ImplementedBy(classOf[CropServiceImpl])
trait CropService {

  /**
   * Cuts a crop for every live label that has none and whose pano has a self-hosted image, and a display derivative
   * for every self-hosted pano wider than the viewer can render. At most one run at a time: a second call while one
   * is in flight fails with [[IllegalStateException]].
   */
  def generateMissingCrops(): Future[CropRunResult]

  /** Whether a run is in flight. */
  def isRunning: Boolean

  /** Where a pano's display derivative is, or would be, stored. */
  def derivedImageFile(panoId: String): File

  /** The pano's display derivative, when one has been written. */
  def existingDerivedImage(panoId: String): Option[File]
}

@Singleton
class CropServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    environment: Environment,
    panoDataService: PanoDataService,
    labelTable: LabelTable,
    panoDataTable: PanoDataTable,
    shareImageCache: ShareImageCache,
    cpuEc: CpuIntensiveExecutionContext
)(implicit ec: ExecutionContext, mat: Materializer)
    extends CropService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val logger = Logger(this.getClass)

  // Its own root, deliberately outside pano.images.directory: localBackupImageFile scans that store by extension, so
  // a derivative placed beside the native file could be picked up as the native file.
  private val derivedDir: File        = MediaDirs.cityDir(config, environment, "pano.derived.images.directory")
  private val derivativeMaxWidth: Int = config.get[Int]("pano.derived.max-width")
  private val cropsDir: File          = new File(panoDataService.getCropDirectory)

  private val running = new AtomicBoolean(false)

  /** Mutable tallies for one run; `result` freezes them. */
  private class Counts {
    var panosOpened, panosWithoutBackup, cropsWritten, shiftedVertically, outOfFrame, dimsMismatch, derivativesWritten,
        errors = 0

    def result: CropRunResult = CropRunResult(
      panosOpened, panosWithoutBackup, cropsWritten, shiftedVertically, outOfFrame, dimsMismatch, derivativesWritten,
      errors
    )
  }

  def isRunning: Boolean = running.get()

  def derivedImageFile(panoId: String): File = new File(new File(derivedDir, panoId.take(2)), s"$panoId.jpg")

  def existingDerivedImage(panoId: String): Option[File] = Some(derivedImageFile(panoId)).filter(_.isFile)

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
            _          <- Future(cutCrops(candidates, counts))(cpuEc)
            wide       <- db.run(panoDataTable.getWideBackupPanos(derivativeMaxWidth))
            _          <- Future(writeMissingDerivatives(wide.map(_._1), counts))(cpuEc)
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

  /** Cuts the candidates' crops, one pano at a time so each file is opened once and never decoded whole. */
  private def cutCrops(candidates: Seq[CropCandidate], counts: Counts): Unit = {
    candidates.groupBy(_.panoId).foreach { case (panoId, labels) =>
      panoDataService.localBackupImageFile(panoId) match {
        case None       => counts.panosWithoutBackup += 1
        case Some(file) =>
          counts.panosOpened += 1
          // The store is the truth about which panos are backed up; keep the row's cache of it in step (#4865).
          markHasBackup(panoId)
          try {
            ImageUtils.withReader(file) { (reader, width, height) =>
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
                labels.foreach(label => cutCrop(reader, width, height, label, counts))
              }
              writeDerivativeIfWide(panoId, reader, width, height, counts)
            }
          } catch {
            case NonFatal(e) =>
              counts.errors += labels.size
              logger.warn(s"Pano $panoId: cannot read ${file.getPath}, skipping its ${labels.size} labels: $e")
          }
      }
    }
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

  private def writeDerivativeIfWide(
      panoId: String,
      reader: ImageReader,
      width: Int,
      height: Int,
      counts: Counts
  ): Unit =
    if (width > derivativeMaxWidth && !derivedImageFile(panoId).isFile) {
      try {
        writeDerivative(reader, width, height, derivativeMaxWidth, derivedImageFile(panoId))
        counts.derivativesWritten += 1
      } catch {
        case NonFatal(e) =>
          counts.errors += 1
          logger.warn(s"Failed to write the display derivative for pano $panoId: $e")
      }
    }

  /** Derivatives for backed-up panos the crop pass had no reason to open (every label already cropped). */
  private def writeMissingDerivatives(panoIds: Seq[String], counts: Counts): Unit = {
    panoIds.filterNot(derivedImageFile(_).isFile).foreach { panoId =>
      panoDataService.localBackupImageFile(panoId).foreach { file =>
        try {
          ImageUtils.withReader(file) { (reader, width, height) =>
            counts.panosOpened += 1
            writeDerivativeIfWide(panoId, reader, width, height, counts)
          }
        } catch {
          case NonFatal(e) =>
            counts.errors += 1
            logger.warn(s"Pano $panoId: cannot read ${file.getPath} for its display derivative: $e")
        }
      }
    }
  }

  private def markHasBackup(panoId: String): Unit = {
    try {
      val _ = Await.result(panoDataService.markHasBackup(panoId), 30.seconds)
    } catch {
      case NonFatal(e) => logger.warn(s"Failed to update has_backup for pano $panoId: ${e.getMessage}")
    }
  }
}
