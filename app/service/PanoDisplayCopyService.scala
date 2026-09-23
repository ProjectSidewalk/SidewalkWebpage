package service

import com.google.inject.ImplementedBy
import models.utils.ImageUtils
import play.api.Logger

import java.io.File
import java.util.concurrent.{
  ArrayBlockingQueue,
  ConcurrentHashMap,
  RejectedExecutionException,
  ThreadPoolExecutor,
  TimeUnit
}
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

object PanoDisplayCopyService {

  /**
   * The widths a copy may be cut to, ascending — [[snapToAllowed]] relies on the order. A viewer asks for twice its
   * `MAX_TEXTURE_SIZE`, so in practice this is 8192 (a 4096 device) and, for hardware old enough to be hypothetical,
   * 4096 and 2048.
   *
   * An allowlist because the HMAC on `/backupImage` covers the path, not the query: without one, anything holding a
   * signed URL could mint an unbounded set of widths and fill the store with copies nothing will ever ask for again.
   *
   * 16384 is deliberately absent. Nothing GSV produces is wider, so it could only ever cut a copy of a source wider
   * than itself — and on that day the output raster would be 16384 x 8192 x 3 = 384 MiB, not the ~105 MB the
   * concurrency cap below is sized against. Restoring it means budgeting the cap in bytes rather than in cuts.
   */
  val AllowedWidths: Seq[Int] = Seq(2048, 4096, 8192)

  /** Display copies are looked at in a pano viewer, never cut from; crops always come from the native file. */
  val JpegQuality: Float = 0.85f

  /**
   * How many copies may be cut at once, process-wide.
   *
   * One costs ~105 MB of heap, so without a cap a burst would put several of those into a 1.5 GB heap at the same
   * moment — the shape of #5239, arrived at from the other direction. Two is chosen against measured demand: the
   * busiest city serves tens of these a quarter, so contention is theoretical.
   */
  val MaxConcurrent: Int = 2

  /**
   * How many cuts may wait behind those threads before the rest are refused and served the native file instead.
   *
   * Refusing beats queueing without bound: the device asking for a copy is one that failed to texture the native
   * file, and it has its own ladder of smaller widths to walk. A fast refusal sends it down that ladder; a long
   * wait just delays the same outcome while holding a request open.
   */
  val QueueDepth: Int = 4

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
    panoDataService: PanoDataService
)(implicit ec: ExecutionContext)
    extends PanoDisplayCopyService {

  import PanoDisplayCopyService._

  private val logger = Logger(this.getClass)

  // Under the crop store, which is derived, disposable and the one media directory the app writes. Its own directory
  // rather than the crop job's retired `pano-downscaled/`, so that one stays unambiguously deletable on prod.
  private val displayDir = new File(panoDataService.getCropDirectory, "pano-display")

  /**
   * Cuts run here, not on `cpu-intensive`, and the bound is the pool rather than a semaphore a thread waits on.
   *
   * The earlier design submitted to `cpu-intensive` and then blocked on a permit. That pool has `parallelism-max = 4`
   * and is also `pekko.stream.materializer.dispatcher`, so two waiting cuts could park half the threads that serve
   * every streamed API response, the crop job and the access-score pass — for the length of the wait, doing nothing.
   * A dedicated pool puts the queueing in the queue, where waiting costs no thread at all.
   */
  private val cutPool = new ThreadPoolExecutor(
    MaxConcurrent,
    MaxConcurrent,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue[Runnable](QueueDepth),
    (r: Runnable) => { val t = new Thread(r, "pano-display-copy"); t.setDaemon(true); t },
    new ThreadPoolExecutor.AbortPolicy
  )
  private val cutEc: ExecutionContext = ExecutionContext.fromExecutor(cutPool, logger.error("Display-copy cut", _))

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
      val result = inFlight.computeIfAbsent(key, _ => submitCut(panoId, native, cached, maxWidth))
      // Two-arg remove: a completed entry can be handed to a second caller before this runs, and a one-arg remove
      // would then evict whatever third call had since inserted, cutting the same copy twice.
      result.andThen { case _ => inFlight.remove(key, result) }
    }
  }

  /**
   * Hands the cut to [[cutPool]], answering None rather than failing when there is no room for it.
   *
   * The queue is bounded and the policy is abort, so `execute` throws here instead of growing without limit. That
   * throw is synchronous, and it has to be caught here rather than recovered downstream: it would otherwise escape
   * `computeIfAbsent` and reach the controller as an exception instead of an answer.
   */
  private def submitCut(panoId: String, native: File, target: File, maxWidth: Int): Future[Option[File]] = {
    try Future(cut(panoId, native, target, maxWidth))(cutEc)
    catch {
      case _: RejectedExecutionException =>
        logger.warn(s"No room to cut a ${maxWidth}px display copy of pano $panoId; serving the native file.")
        Future.successful(None)
    }
  }

  /**
   * Cuts the copy, or answers None if anything about it fails — an unreadable pano, a full disk, a raster the heap
   * cannot hold. None is a complete answer here rather than an error: the route falls back to the native file,
   * which is what it served before this route existed.
   */
  private def cut(panoId: String, native: File, target: File, maxWidth: Int): Option[File] = {
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
      // Caught by name because it is Fatal, so NonFatal misses it and the failed Future would reach the route as a
      // 500 -- withholding the native file exactly when a shortage of memory is what went wrong.
      case e: OutOfMemoryError =>
        logger.error(s"Out of memory cutting a ${maxWidth}px copy of pano $panoId; serving the native file.", e)
        None
    }
  }
}
