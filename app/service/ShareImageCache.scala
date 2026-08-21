package service

import play.api.{Configuration, Environment, Logger}

import java.io.File
import javax.inject.{Inject, Singleton}

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
  def fileFor(labelId: Int): File = new File(dir, s"share_$labelId.jpg")

  /**
   * Drops the cached preview for a label so the next request rebuilds it. A no-op when nothing is cached, which is
   * the common case — most labels are never shared, so most crops have no preview to invalidate.
   */
  def invalidate(labelId: Int): Unit = {
    val file = fileFor(labelId)
    if (file.exists() && !file.delete()) {
      logger.warn(s"Could not invalidate cached share image: ${file.getPath}")
    }
  }
}
