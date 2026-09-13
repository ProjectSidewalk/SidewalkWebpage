package service

import play.api.{Configuration, Environment, Logger}

import java.io.File
import javax.inject.{Inject, Singleton}

/**
 * How the cached previews behind `/label/:id/image` are named. Everything that reads or sweeps the cache directory
 * goes through here, so the sweep can only ever touch files this object named — never the branded fallback or an
 * in-flight `.tmp` that `ImageUtils.writeJpeg` is still filling.
 */
object ShareImageCache {

  /**
   * Bump when previews already on disk would be built differently today: the cache has no expiry, so a wrong one is
   * otherwise served for good. 2 = #3095 (still-based previews had the marker up to 60 px off).
   */
  val Generation: Int = 2

  // Generation 1 predates the suffix, so its files are the bare `share_<id>.jpg`; `_g1` is accepted for symmetry.
  private val PreviewName = """share_(-?\d+)(?:_g(\d+))?\.jpg""".r

  /** The file name of a label's preview under `generation`. */
  def fileName(labelId: Int, generation: Int = Generation): String =
    if (generation == 1) s"share_$labelId.jpg" else s"share_${labelId}_g$generation.jpg"

  /**
   * The generation a cached preview was built under, or `None` for anything else in the directory: the fallback, a
   * temp file, a stray.
   */
  def generationOf(file: File): Option[Int] = file.getName match {
    case PreviewName(_, null) => Some(1)
    case PreviewName(_, g)    => Some(g.toInt)
    case _                    => None
  }
}

/**
 * Locates — and invalidates — the disk cache of social-preview images behind `/label/:id/image` (#456).
 *
 * `ShareController` builds each preview from the best base image it can find at the time: the label's stored crop,
 * else a fetched Street View still, else a branded placeholder. Whatever it settles on is written to disk and served
 * from there on every later request, with no expiry. That is the right trade for a crawler-facing endpoint, but it
 * means a preview built before a label's crop arrived would keep the fallback image for good.
 *
 * Crops arrive asynchronously and can lag their label by seconds (see `Label#updateLabelIdAndUploadCrop`), and Explore
 * now lets a labeler share a label the moment they place it (#4726), so `ImageController` clears the stale preview as
 * each crop lands and the next request rebuilds it from the real thing.
 *
 * Extracted from `ShareController` so both controllers name the same path once.
 */
@Singleton
class ShareImageCache @Inject() (config: Configuration, environment: Environment, configService: ConfigService) {
  private val logger = Logger(this.getClass)

  /**
   * Directory where cached share preview images live: `<share.image.directory>/<city-id>/`. Resolution goes through
   * `MediaDirs` — the one resolver every media path and the boot check share (#4925).
   */
  def dir: File = new File(MediaDirs.baseDir(config, environment, "share.image.directory"), configService.getCityId)

  /** The cached preview for a label, which may or may not exist. */
  def fileFor(labelId: Int): File = new File(dir, ShareImageCache.fileName(labelId))

  /**
   * The label's newest preview from an earlier generation, if one is still on disk. Only worth serving when the
   * current one cannot be built: a crop-less label whose pano has expired since has no other imagery left, and a
   * marker a little off beats the branded logo.
   */
  def legacyFileFor(labelId: Int): Option[File] = legacyFiles(labelId).filter(_.exists()).lastOption

  /** Drops every earlier-generation preview for a label; called once its current-generation replacement exists. */
  def dropLegacy(labelId: Int): Unit = legacyFiles(labelId).foreach(delete)

  /**
   * Drops the cached preview for a label so the next request rebuilds it. A no-op when nothing is cached, which is
   * the common case — most labels are never shared, so most crops have no preview to invalidate.
   */
  def invalidate(labelId: Int): Unit = {
    delete(fileFor(labelId))
    dropLegacy(labelId)
  }

  private def legacyFiles(labelId: Int): Seq[File] =
    (1 until ShareImageCache.Generation).map(g => new File(dir, ShareImageCache.fileName(labelId, g)))

  private def delete(file: File): Unit =
    if (file.exists() && !file.delete()) logger.warn(s"Could not delete cached share image: ${file.getPath}")
}
