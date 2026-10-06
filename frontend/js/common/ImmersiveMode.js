/**
 * Immersive mode (#5085 for Explore, #5560 for Validate): the pano fills the browser window and the surviving
 * controls float over it, toggled from the button under the zoom stack or the F key. The layout itself is CSS keyed
 * on a body class the tool names (svl-immersive.css on body.svl-immersive, svv-immersive.css on body.svv-immersive;
 * the site chrome on html.chromeless in main.css); this class owns the state, the button, the relayout, the one-time
 * exit hint, and the logging. Each tool hands it what differs: its tracker, its relayout, what to close before the
 * frame changes shape, the frame to log, and when the toggle is off limits.
 *
 * Fill-window within the browser window, never the Fullscreen API: browsers leave that mode on Escape unconditionally,
 * and Escape is load-bearing in both tools (Explore: close the context menu, back to Walk; Validate: close the type
 * dropdown, close the label card, leave a comment box), so an API-based mode would eject the user and reflow the
 * viewport on every routine press. Browser-native fullscreen (F11, ctrl-cmd-F) stacks on top for free because the
 * layout is viewport-driven.
 *
 * The mode outlives a page load in its tab: finishing a route or a region sends Explore through a fresh /explore, and
 * running out of missions or reloading does the same on Validate; a person who chose the immersive layout should land
 * back in it rather than in the boxed one. On Explore it also travels in the live URL as `immersive=1` (#5480), so a
 * link shared from the mode opens into it.
 *
 * A tool can also force the mode (#5580): Validate at phone width has no boxed layout to offer, so there the mode is
 * the layout rather than a choice. A forced mode hides the button, ignores the toggle, and stores nothing, so the
 * window growing back past the breakpoint returns the tab to whatever its user last chose.
 *
 * @example
 * svl.immersiveMode = new ImmersiveMode({
 *   tracker: svl.tracker, bodyClass: 'svl-immersive', relayout: () => svl.relayout?.(),
 *   isDisabled: () => svl.isOnboarding(), frame: () => svl.CANVAS_FRAME,
 * });
 */

import { Toast } from './Toast.js';
import { util } from './utilities.js';

export class ImmersiveMode {
  static CHROMELESS_CLASS = 'chromeless';

  #active = false;
  #forced = false;
  #restored = false;
  #restoredSource = null;
  #tracker;
  #relayout;
  #bodyClass;
  #isDisabled;
  #isForced;
  #beforeToggle;
  #onChange;
  #frame;
  #hintReference;
  #activeKey;
  #exitHintSeenKey;
  #holder;
  #button;
  #icon;

  /**
   * @param {object} opts
   * @param {{push: (action: string, notes?: object) => void}} opts.tracker - Logs the paired Click_/KeyboardShortcut_
   *   events.
   * @param {string} opts.bodyClass - The class the tool's immersive stylesheet keys on, set on <body>. It also names
   *   the sessionStorage keys, so the two tools remember their modes separately.
   * @param {() => void} opts.relayout - Re-lays out the tool for its new box, called on every toggle.
   * @param {() => boolean} [opts.isDisabled] - When true at construction the button is hidden and the mode is not
   *   restored; when true at a toggle, the toggle is ignored. Explore's tutorial, Expert Validate.
   * @param {() => void} [opts.beforeToggle] - Closes anything anchored against the frame that is about to change
   *   shape (a context menu, a hover card), before the relayout measures anything.
   * @param {() => {width: number, height: number}} [opts.frame] - The labeling frame after the relayout, for the
   *   toggle events' notes; omitted from them when not given.
   * @param {() => ?HTMLElement} [opts.hintReference] - The element the exit hint floats over; the viewport when not
   *   given.
   * @param {boolean} [opts.deferRestoreLog] - Leave ImmersiveMode_Restored to a later logRestored() call, for a tool
   *   whose tracker can't attribute a row yet at construction (Validate, before its mission exists).
   * @param {string} [opts.urlParam] - A query param that, set to 1, asks for the mode at load (Explore's live URL,
   *   #5480). Not given, only the tab's own stored choice restores it.
   * @param {() => void} [opts.onChange] - Told after every toggle, once the tool is laid out; the live URL's hook.
   * @param {() => boolean} [opts.forced] - When true the mode is on and not the user's to turn off: the button is
   *   hidden and toggle() does nothing. Read at construction and on each refreshForced(); isDisabled wins over it.
   */
  constructor({
    tracker, bodyClass, relayout, isDisabled, beforeToggle, frame, hintReference, deferRestoreLog, urlParam, onChange,
    forced,
  }) {
    this.#tracker = tracker;
    this.#bodyClass = bodyClass;
    this.#relayout = relayout;
    this.#isDisabled = isDisabled ?? (() => false);
    this.#isForced = forced ?? (() => false);
    this.#beforeToggle = beforeToggle ?? (() => {});
    this.#onChange = onChange ?? (() => {});
    this.#frame = frame ?? null;
    this.#hintReference = hintReference ?? (() => null);
    // sessionStorage, not localStorage: both keys are about this tab. The hint is about this window's exit key, and a
    // returning user who has forgotten it deserves to see it once more; the mode itself is a choice for this sitting,
    // and a new tab starting boxed is the layout every first-time visitor sees.
    this.#activeKey = `${bodyClass}-active`;
    this.#exitHintSeenKey = `${bodyClass}-exit-hint-seen`;
    this.#holder = document.getElementById('immersive-toggle-holder');
    this.#button = document.getElementById('immersive-toggle-button');
    this.#icon = document.getElementById('immersive-toggle-icon');
    if (!this.#holder || !this.#button || !this.#icon) return;

    // Explore's tutorial choreography assumes the boxed layout and highlights the zoom stack, so the toggle stays out
    // of its way entirely rather than sitting there disabled and needing an explanation.
    if (this.#isDisabled()) {
      this.#holder.hidden = true;
      return;
    }
    this.#button.addEventListener('click', () => this.toggle('Click'));

    // Forced is the layout, not a return to a chosen mode, so nothing is restored, stored or logged as restored.
    if (this.#isForced()) {
      this.#applyForced(true);
      return;
    }

    // A link's ask (#5480) is stored as this sitting's choice, so a later param-less /explore lands back in it. Only
    // classes and button are set here: the first relayout reads isActive(), so the pano is born at window size.
    // `source` credits the tab first, since an immersive tab's own URL always says immersive=1.
    const stored = Boolean(ImmersiveMode.#readStored(this.#activeKey));
    const askedByUrl = Boolean(urlParam) && new URLSearchParams(window.location.search).get(urlParam) === '1';
    if (stored || askedByUrl) {
      this.#active = true;
      this.#applyClasses();
      this.#renderButton();
      if (!stored) ImmersiveMode.#writeStored(this.#activeKey, '1');
      this.#restored = true;
      this.#restoredSource = stored ? 'session' : 'url';
      if (!deferRestoreLog) this.logRestored();
    }
  }

  /**
   * Logs that this page load came back into immersive mode, if it did. A no-op otherwise, so a tool that deferred the
   * event can call it unconditionally.
   */
  logRestored() {
    if (!this.#restored) return;
    this.#tracker.push('ImmersiveMode_Restored', {
      source: this.#restoredSource,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    });
  }

  /**
   * @returns {boolean} Whether the pano currently fills the window.
   */
  isActive() {
    return this.#active;
  }

  /**
   * @returns {boolean} Whether the mode is on because the tool forced it, rather than by the user's choice.
   */
  isForced() {
    return this.#forced;
  }

  /**
   * Re-reads the `forced` option, for a tool whose reason to force the mode can change while the page is open (a
   * window resized or rotated across a breakpoint). Turning forced on enters the mode; turning it off restores the
   * tab's stored choice and shows the button again. Doesn't re-lay out the tool: the caller is already answering a
   * resize, and lays out once for both.
   * @returns {boolean} Whether isActive() changed, i.e. whether the layout needs redoing.
   */
  refreshForced() {
    if (!this.#button || this.#isDisabled()) return false;
    const forced = this.#isForced();
    if (forced === this.#forced) return false;
    const wasActive = this.#active;
    this.#applyForced(forced);
    return this.#active !== wasActive;
  }

  /**
   * Switches between the boxed layout and immersive mode.
   * @param {'Click'|'KeyboardShortcut'} source - Which input path asked, so the two stay distinguishable in analysis.
   */
  toggle(source) {
    if (!this.#button || this.#isDisabled() || this.#forced) return;
    this.#beforeToggle();

    this.#active = !this.#active;
    this.#applyClasses();
    ImmersiveMode.#writeStored(this.#activeKey, this.#active ? '1' : null);
    this.#relayout();
    this.#renderButton();
    this.#onChange();

    const notes = { innerWidth: window.innerWidth, innerHeight: window.innerHeight };
    const frame = this.#frame?.();
    if (frame) Object.assign(notes, { canvasWidth: frame.width, canvasHeight: frame.height });
    this.#tracker.push(`${source}_ImmersiveMode_${this.#active ? 'Enter' : 'Exit'}`, notes);
    if (this.#active) this.#showExitHintOnce();
  }

  /**
   * Enters or leaves the forced state. Leaving it falls back to the tab's stored choice, which forcing never wrote.
   * @param {boolean} forced - The new state.
   */
  #applyForced(forced) {
    this.#forced = forced;
    this.#active = forced || Boolean(ImmersiveMode.#readStored(this.#activeKey));
    this.#holder.hidden = forced;
    this.#applyClasses();
    this.#renderButton();
  }

  /** The layout is CSS keyed on these two classes, on the body and, for the site chrome, the root. */
  #applyClasses() {
    document.body.classList.toggle(this.#bodyClass, this.#active);
    document.documentElement.classList.toggle(ImmersiveMode.CHROMELESS_CLASS, this.#active);
  }

  /**
   * Swaps the button's icon and accessible name to describe the action it now offers. The name carries the state on
   * its own; an aria-pressed beside a name that already says "exit" would read as a contradiction.
   */
  #renderButton() {
    const icon = this.#active ? 'minimize-2-white-feather.svg' : 'maximize-2-white-feather.svg';
    this.#icon.setAttribute('src', util.assetPath(`images/icons/${icon}`));
    this.#button.setAttribute('aria-label',
      i18next.t(this.#active ? 'common:immersive-exit' : 'common:immersive-enter'));
  }

  /** Tells a first-time user how to get back, once per browser session: the navbar they might reach for is gone. */
  #showExitHintOnce() {
    if (ImmersiveMode.#readStored(this.#exitHintSeenKey)) return;
    ImmersiveMode.#writeStored(this.#exitHintSeenKey, '1');
    // Anchored to the pano (which fills the window here) so it clears whatever the tool floats along the top, queues
    // behind the other pano toasts, and goes click-through while a label type is armed like they do (#5496).
    Toast.show({
      message: i18next.t('common:immersive-exit-hint'),
      reference: this.#hintReference() ?? undefined,
      dark: true,
      compact: true,
    });
  }

  /**
   * @param {string} key - A sessionStorage key.
   * @returns {?string} Its value; null when unset or when storage access throws (some privacy modes), which reads as
   *   "boxed, hint not yet seen": the harmless outcome either way.
   */
  static #readStored(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  /**
   * @param {string} key - A sessionStorage key.
   * @param {?string} value - The value to keep, or null to clear it. A storage failure is swallowed for the same
   *   reason as in #readStored.
   */
  static #writeStored(key, value) {
    try {
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch {
      // Nothing to do: the mode still applies to this page, it just won't survive a reload.
    }
  }
}
