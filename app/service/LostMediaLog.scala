package service

import play.api.Logger

import java.util.Collections
import javax.inject.Singleton

/**
 * Announces media whose bytes have gone missing, once per item.
 *
 * A media row with no file on disk answers every request with a plain 404, indistinguishable from an id that never
 * existed — which is why a destroyed story photo went unnoticed for six days (#4925). The response has to stay a bare
 * 404 (telling a prober which ids exist would be worse), so the log is the only place the loss can be stated.
 *
 * Deduplicated because the interesting event is the loss, not the traffic: one popular page re-requesting a lost file
 * would otherwise write thousands of identical lines and bury it. The tracking set is bounded — a lost mount can make
 * every pano in a city report at once — so eviction eventually lets a still-lost item announce itself again, which is
 * the right way for this to fail.
 */
@Singleton
class LostMediaLog {
  private val logger = Logger(this.getClass)

  // Comfortably above the number of distinct items any single incident produces, and small enough that the worst case
  // (a whole city's panos reporting at once) costs a few hundred KB rather than growing with the pano table.
  private val maxTrackedItems = 2000

  // Access-ordered LRU: the eldest *least recently reported* key is evicted once the map is full. Only ever touched
  // through `put` below, inside the synchronized wrapper — access order mutates on read, so unsynchronized reads
  // would corrupt it.
  private val reported: java.util.Map[String, java.lang.Boolean] = Collections.synchronizedMap(
    new java.util.LinkedHashMap[String, java.lang.Boolean](256, 0.75f, true) {
      override def removeEldestEntry(eldest: java.util.Map.Entry[String, java.lang.Boolean]): Boolean =
        size() > maxTrackedItems
    }
  )

  /**
   * Logs a media item whose bytes are missing from disk, unless it has already been reported recently.
   *
   * Every caller goes through here so the lines share one shape and a loss inventory can be grepped out of the logs
   * whole. Severity follows the same tiering as `PersistentMediaDirCheck`: content no rebuild can recreate is an
   * error, derived content that can be regenerated is a warning.
   *
   * @param kind          What was lost, named after its table or endpoint (`story_media`, `pano`, `crop`).
   * @param id            Identifies the item within its kind; included verbatim in the message.
   * @param path          Where the bytes should have been, for whoever goes looking.
   * @param irreplaceable Whether losing this destroys content (error) rather than costing a rebuild (warning).
   */
  def reportMissing(kind: String, id: String, path: String, irreplaceable: Boolean): Unit = {
    if (reported.put(s"$kind:$id", java.lang.Boolean.TRUE) == null) {
      val message = s"$kind $id has no file on disk at $path"
      if (irreplaceable) logger.error(message) else logger.warn(message)
    }
  }
}
