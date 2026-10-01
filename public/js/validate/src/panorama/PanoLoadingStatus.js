/**
 * The status over the pano that says a label's imagery is still loading (#5581).
 *
 * On its own, a slow load reads as a hang: desktop shows only the dimmed tool and a wait cursor, and mobile shows
 * nothing at all, for up to 12 s per label. The visible box and the screen-reader announcement follow different
 * clocks. The box appears at once when the pano area is blank for the load (a viewer that paints mid-load has its
 * canvas held unpainted, so the validator is already looking at an empty grey box that needs a caption), and only
 * after DELAY_MS when the outgoing pano stays up, so the quick loads most labels get never flicker it. The
 * announcement always waits for DELAY_MS: a screen reader hearing "Loading imagery" on every one-second label change
 * would be noise, and a load past DELAY_MS is the one worth telling about. That is also the moment onShown reports,
 * so the logged count means "slow enough to notice" on every viewer.
 *
 * The element with the id is the live region and is always rendered. The box inside it is aria-hidden and is what
 * gets shown and hidden with `.ps-hidden`; the announcement is a visually hidden span in the region whose text is set
 * when a load turns slow. Changing text inside a live region already in the accessibility tree is announced
 * reliably, where unhiding the region itself is not. The region must not sit inside an `aria-busy="true"` element
 * while it speaks, since assistive tech may hold a busy subtree's changes until it clears, by which time the load is
 * over (LabelContainer.#setUiBusy leaves the attribute off the region that contains it).
 */
class PanoLoadingStatus {
  /**
   * How long a load runs before it counts as slow: the announcement, the onShown report and (when the outgoing pano
   * stays up) the box all wait this long. Long enough that GSV's typical few-hundred-ms swap and a warm Mapillary
   * cache never cross it; short enough that a validator watching a slow load hears why in time.
   * @type {number}
   */
  static DELAY_MS = 2000;

  /**
   * The i18n key begin() shows; reused from the label popup's own loading overlay.
   * @type {string}
   */
  static LOADING_KEY = 'common:loading-imagery';

  /** @type {?HTMLElement} The box shown over the pano; null when the page has no status markup. */
  #box = null;

  /** @type {?HTMLElement} The text inside the box. */
  #text = null;

  /** @type {?HTMLElement} The visually hidden span the screen reader hears; null when the markup lacks it. */
  #announce = null;

  /** @type {?ReturnType<typeof setTimeout>} The pending DELAY_MS timer, while a load is younger than that. */
  #timer = null;

  /** @type {?(() => void)} What begin() was asked to call if this load turns slow. */
  #onShown = null;

  /**
   * @param {?HTMLElement} holder - The `#svv-pano-loading` live region. Tolerates null, or markup missing the box or
   *     its text, so a page without it degrades to no status rather than a broken load path.
   */
  constructor(holder) {
    const box = holder?.querySelector('.svv-pano-loading__box') ?? null;
    const text = holder?.querySelector('.svv-pano-loading__text') ?? null;
    if (box && text) {
      this.#box = box;
      this.#text = text;
      this.#announce = holder.querySelector('.svv-pano-loading__announce');
    }
  }

  /**
   * Marks the start of a load.
   * @param {() => void} [onShown] - Called once if the load turns slow before end(), whether by the delay running
   *     out or by setMessage(). Validate logs it, which is how prod counts loads slow enough to be seen that still
   *     succeed (#5581).
   * @param {{immediate?: boolean}} [options] - `immediate` when the pano area is blank for this load, so the box
   *     appears now to caption it. The announcement still waits for the delay.
   * @returns {void}
   */
  begin(onShown, { immediate = false } = {}) {
    this.end();
    if (!this.#box) return;
    this.#onShown = onShown ?? null;
    this.#setText(PanoLoadingStatus.LOADING_KEY);
    if (immediate) this.#showBox();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#markSlow();
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
    this.#markSlow();
  }

  /**
   * Marks the end of a load, however it ended: hides the status and cancels a pending one. The announcement is
   * emptied so the next slow load's text is a change the live region reports.
   * @returns {void}
   */
  end() {
    this.#clearTimer();
    this.#onShown = null;
    this.#box?.classList.add('ps-hidden');
    if (this.#announce) this.#announce.textContent = '';
  }

  /**
   * Whether the box is on screen.
   * @returns {boolean}
   */
  isShowing() {
    return Boolean(this.#box && !this.#box.classList.contains('ps-hidden'));
  }

  /**
   * The load has run long enough to be worth telling about: the box is up, the screen reader hears the current
   * message, and the first time in a load onShown is reported.
   * @returns {void}
   */
  #markSlow() {
    this.#showBox();
    if (this.#announce) this.#announce.textContent = this.#text.textContent;
    const onShown = this.#onShown;
    this.#onShown = null;
    onShown?.();
  }

  /**
   * Brings the box into view, silently: the box is aria-hidden, so this is the visual half only.
   * @returns {void}
   */
  #showBox() {
    this.#box.classList.remove('ps-hidden');
  }

  /**
   * Cancels a pending slow mark.
   * @returns {void}
   */
  #clearTimer() {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * Puts a message in the box. The key is written to data-i18n too, so a later re-translation of the page keeps it.
   * The announcement is left alone here; only #markSlow copies the text across.
   * @param {string} key - The i18n key of the message.
   * @returns {void}
   */
  #setText(key) {
    this.#text.dataset.i18n = key;
    this.#text.textContent = i18next.t(key);
  }
}
