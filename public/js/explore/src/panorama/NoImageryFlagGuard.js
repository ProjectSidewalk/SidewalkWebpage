/**
 * Bounds how many streets one browsing session may automatically flag as having no imagery (#4918).
 *
 * Flagging a street records it as imagery-less, which marks it audited and drops it out of the assignment rotation,
 * and Explore then moves straight on to the next street. So any failure that repeats — a flaky provider, a maps
 * library that will not load — flags one street per attempt for as long as it lasts, with nothing to stop it.
 * Production saw 44 streets, three quarters of a neighborhood's recorded coverage, consumed in 33 seconds this way.
 *
 * An unbroken run of flags is far better explained by one broken session than by a run of genuinely empty streets, so
 * past the limit we stop believing the signal and tell the user instead. Nothing here is user-initiated: this counts
 * an automatic action, not a labeler choosing to move on.
 *
 * The count lives in sessionStorage because one of the two flagging paths reloads the page, which is precisely why
 * in-memory state never caught this.
 */
class NoImageryFlagGuard {
  /**
   * Streets that may be flagged in an unbroken run before the session stops writing anything down. Three tolerates
   * the real case this exists for — a short chain of dead-end alleys or driveways at the edge of a neighborhood —
   * while turning a provider outage from unbounded into a rounding error.
   */
  static MAX_CONSECUTIVE_FLAGS = 3;

  /**
   * Streets the session will move past before it stops trying. Past [[MAX_CONSECUTIVE_FLAGS]] the moves are silent —
   * the labeler keeps getting new streets, but nothing more is written down — so a patchy area doesn't strand
   * someone doing perfectly ordinary work.
   *
   * There is a ceiling rather than none because a silent move leaves the street marked incomplete, so
   * `TaskContainer.nextTask` can hand it straight back: only the immediately-preceding street is excluded, which
   * makes an A→B→A cycle possible. Each hop also re-sweeps a whole street against the imagery provider. So the run
   * ends here and the labeler is told, rather than looping.
   */
  static MAX_CONSECUTIVE_STREETS_GIVEN_UP = 6;

  static #STORAGE_KEY = 'sidewalk.consecutiveNoImageryFlags';

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
   * How many streets this session has given up on in an unbroken run — i.e. with no panorama loading in between.
   * Counts every street left behind for missing imagery, whether or not it was flagged.
   * @returns {number} The current count; 0 when unset, unparseable, or storage is unavailable.
   */
  static count() {
    const parsed = Number.parseInt(NoImageryFlagGuard.#storage()?.getItem(NoImageryFlagGuard.#STORAGE_KEY) ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  /**
   * Whether what this session is seeing is still trustworthy enough to write down.
   * @returns {boolean} True while the run is under [[MAX_CONSECUTIVE_FLAGS]].
   */
  static canFlag() {
    return NoImageryFlagGuard.count() < NoImageryFlagGuard.MAX_CONSECUTIVE_FLAGS;
  }

  /**
   * Whether the session should keep handing the labeler new streets. Stays true past [[canFlag]], so that hitting the
   * flag limit stops the writing without also stripping the labeler of anywhere to go.
   * @returns {boolean} True while the run is under [[MAX_CONSECUTIVE_STREETS_GIVEN_UP]].
   */
  static canAdvance() {
    return NoImageryFlagGuard.count() < NoImageryFlagGuard.MAX_CONSECUTIVE_STREETS_GIVEN_UP;
  }

  /**
   * Counts one street given up on against both limits.
   * @returns {number} The new count, so callers can log how deep the run got.
   */
  static recordStreetGivenUp() {
    const next = NoImageryFlagGuard.count() + 1;
    try {
      NoImageryFlagGuard.#storage()?.setItem(NoImageryFlagGuard.#STORAGE_KEY, String(next));
    } catch {
      // Unwritable storage degrades the guard to counting nothing, which is no worse than not having it.
    }
    return next;
  }

  /** Ends the run, restoring the full allowance. Called on any panorama that loads. */
  static reset() {
    try {
      NoImageryFlagGuard.#storage()?.removeItem(NoImageryFlagGuard.#STORAGE_KEY);
    } catch {
      // Nothing to clear if storage is unavailable; count() already reads 0.
    }
  }
}
