/**
 * Tells the next page life whether this one ended without a `pagehide` (#5561).
 *
 * iOS takes memory back from a tab by killing its WebContent process and reloading the page when the user next
 * looks at it. No event fires on the way out, so from inside the page a kill is indistinguishable from the user
 * reloading — except that `sessionStorage` survives it, being per-tab and written through as it goes. A marker set
 * while a mission is live and cleared on `pagehide` therefore reads, on the next load, as "the last life ended
 * without saying goodbye". Everything a validator can do on purpose (reload, navigate away, close the tab) fires
 * `pagehide` first and clears it.
 *
 * Every storage access is wrapped: Safari throws on `sessionStorage` in some private-browsing configurations, and a
 * page that can't record the marker should still validate.
 *
 * Usage, from Main.js once the mission exists:
 *
 *     const marker = new MissionLiveMarker(window.sessionStorage);
 *     const unexpected = marker.takeUnexpectedUnload();   // {missionId, ageSec, navType} or null
 *     if (unexpected) svv.tracker.push('Validate_UnexpectedUnload', unexpected);
 *     marker.markLive(missionId);
 */
class MissionLiveMarker {
  static KEY = 'svv:mission-live';

  /** @type {Storage} */
  #storage;

  /**
   * @param {Storage} storage - Where the marker lives; `window.sessionStorage` in production.
   */
  constructor(storage) {
    this.#storage = storage;
  }

  /**
   * Reads, and removes, a marker a previous page life left behind.
   *
   * @returns {?{missionId: ?number, ageSec: number, navType: string}} What that life recorded — the mission it was
   *      on, how long ago it marked itself live, and how the browser says this page arrived (`reload`, `navigate`,
   *      `back_forward`; `unknown` where the Navigation Timing entry is missing) — or null when the last life ended
   *      with a pagehide, or never wrote a marker at all.
   */
  takeUnexpectedUnload() {
    let raw;
    try {
      raw = this.#storage.getItem(MissionLiveMarker.KEY);
      this.#storage.removeItem(MissionLiveMarker.KEY);
    } catch {
      return null;
    }
    if (!raw) return null;

    let marker;
    try {
      marker = JSON.parse(raw);
    } catch {
      return null;
    }
    const [navigation] = performance.getEntriesByType?.('navigation') ?? [];
    const navType = /** @type {PerformanceNavigationTiming|undefined} */ (navigation)?.type ?? 'unknown';
    return {
      missionId: marker.missionId ?? null,
      ageSec: Math.max(0, Math.round((Date.now() - (marker.since ?? Date.now())) / 1000)),
      navType,
    };
  }

  /**
   * Marks this page life as mid-mission, and arranges for the mark to be cleared on an orderly exit.
   * @param {number} missionId - The mission in progress, so the next life can name what was cut short.
   */
  markLive(missionId) {
    try {
      this.#storage.setItem(MissionLiveMarker.KEY, JSON.stringify({ missionId, since: Date.now() }));
    } catch {
      return; // Nothing recorded, so there is nothing to clear either.
    }
    window.addEventListener('pagehide', () => this.clear());
  }

  /** Withdraws the marker: this page is ending the way pages are supposed to. */
  clear() {
    try {
      this.#storage.removeItem(MissionLiveMarker.KEY);
    } catch {
      // Storage went away underneath us; there is no marker left to mislead the next life.
    }
  }
}
