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
import play.api.Logger
import service.CropGeometry.CropBox
import service.CropService._

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
   *
   * The `sidecar*` counts are the run's other job: not what it wrote, but what the scraper did. `sidecarsMissing` is
   * the number a viewer would fail on today, and `sidecarWidthUnknown` the panos whose recorded width can't say
   * whether they need one.
   */
  case class CropRunResult(
      panosOpened: Int,
      panosWithoutBackup: Int,
      cropsWritten: Int,
      shiftedVertically: Int,
      outOfFrame: Int,
      dimsMismatch: Int,
      dimsUnverified: Int,
      sidecarsPresent: Int,
      sidecarsMissing: Int,
      sidecarWidthUnknown: Int,
      sidecarMaxWidth: Int,
      errors: Int
  ) {

    /** One-line account of the run, for the log and the admin trigger's response. */
    def summary: String =
      s"Crop generation (rule ${CropSizingRule.Version}): opened $panosOpened panos, wrote $cropsWritten crops " +
        s"($shiftedVertically shifted to stay inside the pano, $dimsUnverified against a pano whose dimensions the " +
        s"database doesn't record); skipped $panosWithoutBackup panos with no self-hosted image, $dimsMismatch labels " +
        s"on a dimension mismatch and $outOfFrame labels outside the image; found $sidecarsPresent of " +
        s"${sidecarsPresent + sidecarsMissing} wide panos with a ${sidecarMaxWidth}px display sidecar " +
        s"($sidecarWidthUnknown of unrecorded width); $errors errors."

    /** The counts as stored against the run's `background_job_run` row, shared by the nightly and manual triggers. */
    def runDetails: JsObject = Json.obj(
      "crop_rule_version"     -> CropSizingRule.Version,
      "panos_opened"          -> panosOpened,
      "panos_without_backup"  -> panosWithoutBackup,
      "crops_written"         -> cropsWritten,
      "shifted_vertically"    -> shiftedVertically,
      "out_of_frame"          -> outOfFrame,
      "dims_mismatch"         -> dimsMismatch,
      "dims_unverified"       -> dimsUnverified,
      "sidecars_present"      -> sidecarsPresent,
      "sidecars_missing"      -> sidecarsMissing,
      "sidecar_width_unknown" -> sidecarWidthUnknown,
      "sidecar_max_width"     -> sidecarMaxWidth,
      "errors"                -> errors
    )
  }

  /**
   * Cuts a window out of the panorama behind `reader`, keeping only the window's own pixels and stitching the two
   * runs of a window that crosses the equirectangular seam.
   *
   * What a region read saves is memory, not decoding: ImageIO walks the compressed stream from the start every time
   * ([[ImageUtils.readRegion]]), so a pano costs one pass per window. Bounding the peak raster is the whole point —
   * cutting a second window is cheap in memory and is not free in CPU.
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
}

/**
 * Per-label crop images cut from the self-hosted panorama store (#4865).
 *
 * Derived data, regenerated by a nightly reconciliation job rather than written inline with any submission:
 * generation is idempotent and order-independent, so a label can't be stranded by arriving before its pano's pixels,
 * and a change to the crop geometry is a matter of deleting the store and letting the job rebuild it. The job cuts
 * label-sized windows only — never a whole-pano derivative, which a 1.5 GB web-app heap cannot afford (#5239); the
 * downscaled display copy of a wide pano is the scraper's to write, beside the native file. The run does count those
 * copies, because nothing else would: see [[CropService.generateMissingCrops]].
 */
@ImplementedBy(classOf[CropServiceImpl])
trait CropService {

  /**
   * Cuts a crop for every live label that has none and whose pano has a self-hosted image, then counts how many wide
   * panos have the display sidecar the scraper owes them. At most one run at a time: a second call while one is in
   * flight fails with [[IllegalStateException]].
   */
  def generateMissingCrops(): Future[CropRunResult]

  /** Whether a run is in flight. */
  def isRunning: Boolean
}

@Singleton
class CropServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    panoDataService: PanoDataService,
    labelTable: LabelTable,
    panoDataTable: PanoDataTable,
    shareImageCache: ShareImageCache,
    cpuEc: CpuIntensiveExecutionContext
)(implicit ec: ExecutionContext, mat: Materializer)
    extends CropService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val logger = Logger(this.getClass)

  private val cropsDir: File = new File(panoDataService.getCropDirectory)

  private val running = new AtomicBoolean(false)

  /** Mutable tallies for one run; `result` freezes them. */
  private class Counts {
    var panosOpened, panosWithoutBackup, cropsWritten, shiftedVertically, outOfFrame, dimsMismatch, dimsUnverified,
        sidecarsPresent, sidecarsMissing, sidecarWidthUnknown, errors = 0

    def result: CropRunResult = CropRunResult(
      panosOpened, panosWithoutBackup, cropsWritten, shiftedVertically, outOfFrame, dimsMismatch, dimsUnverified,
      sidecarsPresent, sidecarsMissing, sidecarWidthUnknown, panoDataService.downscaledMaxWidth, errors
    )
  }

  def isRunning: Boolean = running.get()

  def generateMissingCrops(): Future[CropRunResult] = {
    if (!running.compareAndSet(false, true)) {
      Future.failed(new IllegalStateException("A crop generation run is already in progress."))
    } else {
      val counts = new Counts
      // Future.delegate so that a synchronous throw (an unreadable crop store, say) still releases the guard.
      Future
        .delegate {
          for {
            existing   <- Future(existingCropIds())(cpuEc)
            candidates <- cropCandidates(existing)
            backed     <- Future(cutCrops(candidates, counts))(cpuEc)
            _          <- markHasBackup(backed)
            _          <- countSidecars(counts)
          } yield counts.result
        }
        .andThen { case _ => running.set(false) }
    }
  }

  /**
   * Counts how many wide panos have the downscaled display sidecar the scraper writes beside them (#5239).
   *
   * The app stopped cutting that copy because doing so OOM-killed prod JVMs, and nothing else watches it: the
   * scraper's write is deliberately never fatal, so a mount going read-only, a city whose backfill never ran, or a
   * `pano.downscaled.max-width` changed on one side of the two repos that hold it would all be invisible until a
   * user opened an expired wide pano and got a texture their browser can't map. A missing sidecar is exactly that
   * failure, counted the night it appears instead of whenever someone happens to look.
   *
   * Deliberately cheap enough to belong in a job that has to stay inside a 1.5 GB heap: one `stat` per pano, no
   * decode, no native file opened, and the ids are streamed rather than collected, so peak memory is a row.
   */
  private def countSidecars(counts: Counts): Future[Unit] = {
    val maxWidth = panoDataService.downscaledMaxWidth
    Source
      .fromPublisher(
        db.stream(panoDataTable.getWideBackupPanos(maxWidth).transactionally.withStatementParameters(fetchSize = 1000))
      )
      // On cpuEc because a stat is blocking, and the materializer's dispatcher is the one serving requests.
      .mapAsync(1) { case (panoId, width) =>
        Future {
          if (width.isEmpty) counts.sidecarWidthUnknown += 1
          else if (panoDataService.downscaledImageFile(panoId).isFile) counts.sidecarsPresent += 1
          else counts.sidecarsMissing += 1
        }(cpuEc)
      }
      .runWith(Sink.ignore)
      .map { _ =>
        if (counts.sidecarsMissing > 0) {
          logger.warn(
            s"${counts.sidecarsMissing} of ${counts.sidecarsPresent + counts.sidecarsMissing} wide panos have no " +
              s"${maxWidth}px display sidecar; /backupImage is serving those at native width, which a pano viewer " +
              s"may not be able to render. The scraper writes them as <panoId>.w$maxWidth.jpg — check that its own " +
              s"width cap still matches pano.downscaled.max-width, and that its backfill has run for this city."
          )
        }
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
