/**
 * Bounds how many streets one browsing session may auto-skip for missing imagery (#4918).
 *
 * Reporting a street as imagery-less marks it audited and drops it out of the assignment rotation, and the report is
 * followed by a reload that hands the user the next street. So any failure that repeats — a flaky provider, a maps
 * library that will not load — spends one street per reload for as long as it lasts, with nothing to stop it.
 * Production saw 44 streets, three quarters of a neighborhood's recorded coverage, consumed in 33 seconds this way.
 *
 * A run of skips is far better explained by one broken session than by a run of genuinely empty streets, so past the
 * budget we stop believing the signal and tell the user instead. The count lives in sessionStorage because the reload
 * is what makes the loop: in-memory state resets on every iteration, which is precisely why nothing caught this.
 */
class ImagerySkipGuard {
  /**
   * Consecutive auto-skips allowed before the session stops spending streets. Three tolerates the real case this
   * exists for — a short chain of dead-end alleys or driveways at the edge of a neighborhood — while turning a
   * provider outage from unbounded into a rounding error.
   */
  static MAX_CONSECUTIVE_SKIPS = 3;

  static #STORAGE_KEY = 'sidewalk.consecutiveImagerySkips';

  /**
   * sessionStorage access throws outright in some privacy modes, so every use goes through here: a guard that cannot
   * count must still not be the thing that breaks Explore.
   *
   * @returns {Storage|null} The session store, or null when it is unavailable.
   */
  static #storage() {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }

  /**
   * How many streets this session has skipped in an unbroken run.
   * @returns {number} The current count; 0 when unset, unparseable, or storage is unavailable.
   */
  static count() {
    const parsed = Number.parseInt(ImagerySkipGuard.#storage()?.getItem(ImagerySkipGuard.#STORAGE_KEY) ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  /**
   * Whether the session may spend another street on a missing-imagery report.
   * @returns {boolean} True while the run is still under the budget.
   */
  static canSkip() {
    return ImagerySkipGuard.count() < ImagerySkipGuard.MAX_CONSECUTIVE_SKIPS;
  }

  /**
   * Charges one street to the budget.
   * @returns {number} The new count, so callers can log how deep the run got.
   */
  static recordSkip() {
    const next = ImagerySkipGuard.count() + 1;
    try {
      ImagerySkipGuard.#storage()?.setItem(ImagerySkipGuard.#STORAGE_KEY, String(next));
    } catch {
      // Unwritable storage degrades the guard to counting nothing, which is no worse than not having it.
    }
    return next;
  }

  /** Restores the full budget. Called on any pano that loads, since that ends the run of failures. */
  static reset() {
    try {
      ImagerySkipGuard.#storage()?.removeItem(ImagerySkipGuard.#STORAGE_KEY);
    } catch {
      // Nothing to clear if storage is unavailable; count() already reads 0.
    }
  }
}
