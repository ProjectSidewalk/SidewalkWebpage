/**
 * The status over the pano that says a label's imagery is still loading (#5581).
 *
 * On its own, a slow load reads as a hang: desktop shows only the dimmed tool and a wait cursor, and mobile shows
 * nothing at all, for up to 12 s per label. This appears only for loads that outlast DELAY_MS, so the quick loads most
 * labels get never flicker it, and a screen reader hears about the slow ones only.
 *
 * The element with the id is the live region and is always rendered; the visible box inside it is what gets hidden.
 * Revealing content inside a live region that is already in the accessibility tree is announced reliably, where
 * unhiding the region itself is not.
 */
class PanoLoadingStatus {
  /**
   * How long a load runs before the status appears, in ms. Long enough that GSV's typical few-hundred-ms swap and a
   * warm Mapillary cache never show it; short enough that a validator watching a slow load hears why in time.
   * @type {number}
   */
  static DELAY_MS = 2000;

  /** The i18n key begin() shows; reused from the label popup's own loading overlay. */
  static LOADING_KEY = 'common:loading-imagery';

  /** @type {?HTMLElement} The box shown over the pano; null when the page has no status markup. */
  #box = null;

  /** @type {?HTMLElement} The text inside the box. */
  #text = null;

  /** @type {?ReturnType<typeof setTimeout>} The pending DELAY_MS timer, while a load is younger than that. */
  #timer = null;

  /**
   * @param {?HTMLElement} holder - The `#svv-pano-loading` live region. Tolerates null so a page without the markup
   *     degrades to no status rather than a broken load path.
   */
  constructor(holder) {
    this.#box = holder?.querySelector('.svv-pano-loading__box') ?? null;
    this.#text = holder?.querySelector('.svv-pano-loading__text') ?? null;
  }

  /**
   * Marks the start of a load. The status shows only if end() hasn't been called within DELAY_MS.
   * @returns {void}
   */
  begin() {
    this.end();
    if (!this.#box) return;
    // Staged while hidden, so it isn't announced now; the reveal is the announcement.
    this.#setText(PanoLoadingStatus.LOADING_KEY);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#box.hidden = false;
    }, PanoLoadingStatus.DELAY_MS);
  }

  /**
   * Shows a message now, whatever the delay. Used when a load has already taken long enough to be given up on, so
   * the validator has been waiting past DELAY_MS already.
   * @param {string} key - The i18n key of the message, e.g. 'validate:pano-loading.skipping'.
   * @returns {void}
   */
  setMessage(key) {
    if (!this.#box) return;
    this.#clearTimer();
    this.#setText(key);
    this.#box.hidden = false;
  }

  /**
   * Marks the end of a load, however it ended: hides the status and cancels a pending one.
   * @returns {void}
   */
  end() {
    this.#clearTimer();
    if (this.#box) this.#box.hidden = true;
  }

  /**
   * Whether the status is on screen.
   * @returns {boolean}
   */
  isShowing() {
    return Boolean(this.#box && !this.#box.hidden);
  }

  /** Cancels a pending reveal. */
  #clearTimer() {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * Puts a message in the box. The key is written to data-i18n too, so a later re-translation of the page keeps it.
   * @param {string} key - The i18n key of the message.
   */
  #setText(key) {
    this.#text.dataset.i18n = key;
    this.#text.textContent = i18next.t(key);
  }
}
