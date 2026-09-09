package service

import com.google.inject.ImplementedBy
import executors.CpuIntensiveExecutionContext
import models.utils.ImageUtils
import play.api.Logger

import java.io.File
import java.util.concurrent.{ConcurrentHashMap, Semaphore, TimeUnit}
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

object PanoDisplayCopyService {

  /**
   * The widths a copy may be cut to. A viewer asks for twice its `MAX_TEXTURE_SIZE`, so in practice this is 8192
   * (a 4096 device) and, for hardware old enough to be hypothetical, 4096 and 2048.
   *
   * An allowlist because the HMAC on `/backupImage` covers the path, not the query: without one, anything holding a
   * signed URL could mint an unbounded set of widths and fill the store with copies nothing will ever ask for again.
   */
  val AllowedWidths: Seq[Int] = Seq(2048, 4096, 8192, 16384)

  /** Display copies are looked at in a pano viewer, never cut from; crops always come from the native file. */
  val JpegQuality: Float = 0.85f

  /**
   * How many copies may be cut at once, process-wide.
   *
   * One costs ~105 MB of heap, and `cpu-intensive` is a fork-join pool sized to the host's cores, so without a cap a
   * burst would put a core's worth of 105 MB allocations into a 1.5 GB heap at the same moment — the shape of #5239,
   * arrived at from the other direction. Two is chosen against measured demand: the busiest city serves tens of these
   * a quarter, so contention is theoretical and a queue is cheaper than a second OOM.
   */
  val MaxConcurrent: Int = 2

  /** How long a request waits for one of those slots before giving up and letting the caller serve the native file. */
  val AcquireTimeoutSeconds: Int = 30

  /**
   * The allowed width at or below what the viewer asked for, so a device is never handed something larger than it
   * said it could take. A request under the smallest allowed width gets that width — a device that can't render
   * 2048 can't be helped by this route anyway, and refusing outright would leave it with the native file, which is
   * strictly worse.
   */
  def snapToAllowed(requested: Int): Int =
    AllowedWidths.filter(_ <= requested).lastOption.getOrElse(AllowedWidths.head)
}

/** A downscaled copy of a stored panorama, cut when a viewer asks for one and kept for the next viewer (#5256). */
@ImplementedBy(classOf[PanoDisplayCopyServiceImpl])
trait PanoDisplayCopyService {

  /**
   * A copy of `native` no wider than `maxWidth`, cutting one if it isn't already cached.
   *
   * @return The copy, or None when it couldn't be produced — the caller serves the native file, which is what a
   *         viewer that never asked for a copy gets anyway.
   */
  def displayCopy(panoId: String, native: File, maxWidth: Int): Future[Option[File]]

  /** Where a copy is, or would be, cached. */
  def displayCopyFile(panoId: String, maxWidth: Int): File
}

@Singleton
class PanoDisplayCopyServiceImpl @Inject() (
    panoDataService: PanoDataService,
    cpuEc: CpuIntensiveExecutionContext
)(implicit ec: ExecutionContext)
    extends PanoDisplayCopyService {

  import PanoDisplayCopyService._

  private val logger = Logger(this.getClass)

  // Under the crop store, which is derived, disposable and the one media directory the app writes. Its own directory
  // rather than the crop job's retired `pano-downscaled/`, so that one stays unambiguously deletable on prod.
  private val displayDir = new File(panoDataService.getCropDirectory, "pano-display")

  private val slots = new Semaphore(MaxConcurrent)

  // Single-flight: a burst on one pano cuts one copy, not one per request. Entries are removed on completion, so
  // this holds only what is in flight.
  private val inFlight = new ConcurrentHashMap[String, Future[Option[File]]]()

  def displayCopyFile(panoId: String, maxWidth: Int): File =
    new File(new File(displayDir, panoId.take(2)), s"$panoId.w$maxWidth.jpg")

  def displayCopy(panoId: String, native: File, maxWidth: Int): Future[Option[File]] = {
    val cached = displayCopyFile(panoId, maxWidth)
    if (cached.isFile) Future.successful(Some(cached))
    else {
      val key    = s"$panoId@$maxWidth"
      val result = inFlight.computeIfAbsent(key, _ => Future(cut(panoId, native, cached, maxWidth))(cpuEc))
      result.andThen { case _ => inFlight.remove(key) }
    }
  }

  /**
   * Cuts the copy, or answers None if anything about it fails — a missing slot, an unreadable pano, a full disk.
   * None is a complete answer here rather than an error: the route falls back to the native file, which is what it
   * served before this route existed.
   */
  private def cut(panoId: String, native: File, target: File, maxWidth: Int): Option[File] = {
    if (!slots.tryAcquire(AcquireTimeoutSeconds.toLong, TimeUnit.SECONDS)) {
      logger.warn(s"Timed out waiting to cut a ${maxWidth}px display copy of pano $panoId; serving the native file.")
      None
    } else {
      try {
        ImageUtils.withReader(native) { (reader, width, height) =>
          val period = ImageUtils.subsamplePeriod(width, height, maxWidth)
          if (period == 1) None // Already inside the viewer's budget; the native file is the right answer.
          else {
            val _ = target.getParentFile.mkdirs()
            ImageUtils.writeJpeg(ImageUtils.readSubsampled(reader, period), target, JpegQuality)
            logger.info(s"Cut a ${width / period}px display copy of pano $panoId for a ${maxWidth}px viewer.")
            Some(target)
          }
        }
      } catch {
        case NonFatal(e) =>
          logger.warn(s"Could not cut a ${maxWidth}px display copy of pano $panoId: $e")
          None
      } finally slots.release()
    }
  }
}
