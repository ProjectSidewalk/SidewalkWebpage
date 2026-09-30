/**
 * Holds panorama image bytes fetched ahead of the viewer asking for them (#5562).
 *
 * The Pannellum fallback loads a self-hosted equirect from a URL, and until it does the validator waits: on a phone
 * over cellular that is seconds of dead time between a tap and the next pano, on every label whose provider imagery
 * has expired. Validate knows which labels are coming, so it can have the next ones' images downloading while the
 * current one is being judged. This is where they wait.
 *
 * Bytes, not pixels: an entry is a `Blob` of the compressed file behind an object URL, a few megabytes each, never a
 * decoded bitmap, which at 8192 wide is 128 MB and on a phone the very thing #5561 was about. Decoding still happens
 * at load time; what the cache removes is the network.
 *
 * Entries are keyed by the exact network URL the viewer would otherwise request, so the two agree without either
 * knowing how the other builds it: `prefetchBackups` derives it from the pano's metadata the same way the viewer
 * does, and the viewer asks `resolve()` with the URL it was about to fetch. Pannellum takes a `blob:` URL where it
 * takes any other (its loader XHRs the URL to a Blob either way), so no change to the vendored viewer is needed.
 *
 * Usage:
 *
 *     const cache = new PanoImageCache();
 *     cache.prefetchBackups([nextLabel.backupImage]);           // fire and forget
 *     ...
 *     const url = cache.resolve(networkUrl) ?? networkUrl;      // in the viewer, at load time
 *     cache.release(networkUrl);                                // once the load has settled
 */
class PanoImageCache {
  /**
   * How many panos to hold at once. The one on screen is released as it loads, so this only ever holds the ones
   * coming up; the cap is a guard against a caller prefetching further ahead than a validator will get.
   */
  static MAX_ENTRIES = 3;

  /** How long to wait before retrying a refused download when the server names no `Retry-After`, in seconds. */
  static RETRY_AFTER_DEFAULT_SEC = 5;

  /** The longest a refused download waits before its one retry, in seconds, whatever the server asks for. */
  static RETRY_AFTER_MAX_SEC = 10;

  /** @type {Map<string, string>} Network URL to object URL, in insertion order, so the oldest is first. */
  #entries = new Map();

  /** @type {Map<string, Promise<boolean>>} Network URL to the download in flight for it. */
  #inFlight = new Map();

  /**
   * @type {Set<string>} Downloads released while still in flight. The viewer releases a URL once its own load has
   * settled, so a prefetch of it that finishes afterwards would hold bytes for a pano already shown, in a slot a
   * coming pano should have; it is dropped on arrival instead.
   */
  #abandoned = new Set();

  /**
   * Whether this connection wants imagery fetched that the user hasn't asked to see yet.
   *
   * A prefetch is only a waste when the validator quits before reaching the label, so on an ordinary connection it
   * is worth it. Data Saver is the user saying otherwise; browsers that don't expose it get the default.
   *
   * @returns {boolean} False under Data Saver.
   */
  static prefetchAllowed() {
    return navigator.connection?.saveData !== true;
  }

  /**
   * Downloads a pano into the cache, unless it is already there or on its way.
   *
   * Never throws: a failed prefetch only means the load pays full price when it comes, which is what would have
   * happened anyway, so there is nothing for a caller to do about it.
   *
   * @param {string} url - The network URL the viewer would request.
   * @returns {Promise<boolean>} True once the bytes are held; false when the download failed or was skipped.
   */
  prefetch(url) {
    if (!url) return Promise.resolve(false);
    this.#abandoned.delete(url); // Asking again is interest again, whatever a release said in between.
    if (this.#entries.has(url)) return Promise.resolve(true);
    if (this.#inFlight.has(url)) return this.#inFlight.get(url);
    if (!PanoImageCache.prefetchAllowed()) return Promise.resolve(false);

    const download = (async () => {
      try {
        const response = await this.#fetchWithOneRetry(url);
        if (!response.ok) return false;
        const blob = await response.blob();
        if (this.#abandoned.has(url)) return false;
        this.#store(url, URL.createObjectURL(blob));
        return true;
      } catch {
        return false;
      } finally {
        this.#inFlight.delete(url);
        this.#abandoned.delete(url);
      }
    })();
    this.#inFlight.set(url, download);
    return download;
  }

  /**
   * Fetches a pano, and once more after a refusal the server says to come back from.
   *
   * `/backupImage` answers 503 with `Retry-After` when its cut pool has no room for the copy (#5561). A prefetch
   * runs in the background with nothing waiting on it, so it can afford to wait that out where a foreground load
   * cannot; one retry keeps a persistently full pool from turning into a polling loop.
   *
   * @param {string} url - The network URL.
   * @returns {Promise<Response>} The last response.
   */
  async #fetchWithOneRetry(url) {
    const response = await fetch(url);
    if (response.status !== 503) return response;
    const retryAfterSec = Number(response.headers?.get?.('Retry-After')) || PanoImageCache.RETRY_AFTER_DEFAULT_SEC;
    const waitMs = Math.min(retryAfterSec, PanoImageCache.RETRY_AFTER_MAX_SEC) * 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return fetch(url);
  }

  /**
   * Prefetches the backup panos for the given labels' metadata, at the width this device would load them at.
   *
   * One at a time, in order: the nearest label's pano is the one most likely to be needed first, and a phone's
   * bandwidth split between two downloads finishes neither sooner. The server cuts these copies on demand from a
   * bounded pool, which serial requests also spare (#5561).
   *
   * @param {Array<Record<string, any>>} backupImages - `backupImage` metadata objects, as `buildBackupImageData`
   *     builds them and `PannellumViewer` loads them.
   * @returns {Promise<void>} Settles once every download has, for callers that want to wait; none need to.
   */
  async prefetchBackups(backupImages) {
    for (const backupImage of backupImages) {
      await this.prefetch(panoramaUrlFor(backupImage));
    }
  }

  /**
   * Whether the bytes for a URL are held right now (not merely on their way).
   * @param {string} url - The network URL.
   * @returns {boolean}
   */
  has(url) {
    return this.#entries.has(url);
  }

  /**
   * The local stand-in for a network URL, if its bytes are held.
   * @param {string} url - The network URL the viewer is about to request.
   * @returns {string|undefined} A `blob:` URL to load instead, or undefined to load from the network.
   */
  resolve(url) {
    return this.#entries.get(url);
  }

  /**
   * Like resolve(), but gives a download still in flight for the URL a chance to finish first.
   *
   * A validator who reaches a label before its prefetch has landed would otherwise start a second download of the
   * same bytes beside the first, and on cellular two half-speed downloads finish later than the one already under
   * way. The wait is bounded so a stalled prefetch can't hold the viewer indefinitely.
   *
   * @param {string} url - The network URL the viewer is about to request.
   * @param {number} timeoutMs - How long to wait for a download in flight.
   * @returns {Promise<string|undefined>} A `blob:` URL to load instead, or undefined to load from the network.
   */
  async settle(url, timeoutMs) {
    this.#abandoned.delete(url); // The viewer wants these bytes after all; a download in flight must keep them.
    const download = this.#inFlight.get(url);
    if (download) {
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      await Promise.race([download, timeout]);
      clearTimeout(timer);
    }
    return this.resolve(url);
  }

  /**
   * Drops a held pano and frees its bytes, or marks one still downloading to be dropped on arrival. Safe to call for
   * a URL that was never held.
   * @param {string} url - The network URL.
   */
  release(url) {
    if (this.#inFlight.has(url)) this.#abandoned.add(url);
    const objectUrl = this.#entries.get(url);
    if (objectUrl === undefined) return;
    URL.revokeObjectURL(objectUrl);
    this.#entries.delete(url);
  }

  /** Drops everything held. */
  clear() {
    for (const url of [...this.#entries.keys()]) this.release(url);
  }

  /**
   * Records a download, evicting the oldest entries past the cap.
   * @param {string} url - The network URL.
   * @param {string} objectUrl - The object URL holding its bytes.
   */
  #store(url, objectUrl) {
    this.#entries.set(url, objectUrl);
    while (this.#entries.size > PanoImageCache.MAX_ENTRIES) {
      this.release(this.#entries.keys().next().value);
    }
  }
}
