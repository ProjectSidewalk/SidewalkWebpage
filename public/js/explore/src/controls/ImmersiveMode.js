/**
 * Immersive mode (#5085): the pano fills the browser window and the surviving controls float over it, toggled from the
 * button under the zoom stack or the F key. The layout itself is CSS (svl-immersive.css, keyed on body.svl-immersive;
 * the site chrome on html.chromeless in main.css); this class owns the state, the button, the relayout, the one-time
 * exit hint, and the logging.
 *
 * Fill-window within the browser window, never the Fullscreen API: browsers leave that mode on Escape unconditionally,
 * and Escape is load-bearing in Explore (close the context menu, back to Walk), so an API-based mode would eject the
 * user and reflow the viewport on every routine press. Browser-native fullscreen (F11, ctrl-cmd-F) stacks on top for
 * free because the layout is viewport-driven.
 *
 * The mode outlives a page load in its tab: finishing a route or a region sends the mission-complete modal through a
 * fresh /explore, and a labeler who chose the immersive layout should land back in it rather than in the boxed one.
 */
class ImmersiveMode {
  static BODY_CLASS = 'svl-immersive';
  static CHROMELESS_CLASS = 'chromeless';
  // sessionStorage, not localStorage: both keys are about this tab. The hint is about this window's exit key, and a
  // returning user who has forgotten it deserves to see it once more; the mode itself is a choice for this sitting,
  // and a new tab starting boxed is the layout every first-time visitor sees.
  static #EXIT_HINT_SEEN_KEY = 'svl-immersive-exit-hint-seen';
  static #ACTIVE_KEY = 'svl-immersive-active';

  #active = false;
  #tracker;
  #relayout;
  #holder;
  #button;
  #icon;

  /**
   * @param {Tracker} tracker - Logs the paired Click_/KeyboardShortcut_ events.
   * @param {() => void} relayout - Re-lays out the tool for its new box (svl.relayout), called on every toggle.
   */
  constructor(tracker, relayout) {
    this.#tracker = tracker;
    this.#relayout = relayout;
    this.#holder = document.getElementById('immersive-toggle-holder');
    this.#button = document.getElementById('immersive-toggle-button');
    this.#icon = document.getElementById('immersive-toggle-icon');
    if (!this.#holder || !this.#button || !this.#icon) return;

    // The tutorial's choreography assumes the boxed layout and highlights the zoom stack, so the toggle stays out of
    // its way entirely rather than sitting there disabled and needing an explanation.
    if (svl.isOnboarding()) {
      this.#holder.hidden = true;
      return;
    }
    this.#button.addEventListener('click', () => this.toggle('Click'));

    // Re-enter the mode this tab was in before the page load. Only the classes and the button are set here: the tool
    // has not been laid out yet, and the first relayout reads isActive(), so the pano is born at window size.
    if (ImmersiveMode.#readStored(ImmersiveMode.#ACTIVE_KEY)) {
      this.#active = true;
      this.#applyClasses();
      this.#renderButton();
      this.#tracker.push('ImmersiveMode_Restored', { innerWidth: window.innerWidth, innerHeight: window.innerHeight });
    }
  }

  /**
   * @returns {boolean} Whether the pano currently fills the window.
   */
  isActive() {
    return this.#active;
  }

  /**
   * Switches between the boxed layout and immersive mode.
   * @param {'Click'|'KeyboardShortcut'} source - Which input path asked, so the two stay distinguishable in analysis.
   */
  toggle(source) {
    if (svl.isOnboarding()) return;
    // The hover card and context menu are anchored against the frame that is about to change shape.
    if (svl.contextMenu.isOpen()) svl.contextMenu.hide();
    svl.canvas.showLabelHoverInfo(undefined);

    this.#active = !this.#active;
    this.#applyClasses();
    ImmersiveMode.#writeStored(ImmersiveMode.#ACTIVE_KEY, this.#active ? '1' : null);
    this.#relayout();
    this.#renderButton();

    this.#tracker.push(`${source}_ImmersiveMode_${this.#active ? 'Enter' : 'Exit'}`, {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      canvasWidth: svl.CANVAS_FRAME.width,
      canvasHeight: svl.CANVAS_FRAME.height,
    });
    if (this.#active) this.#showExitHintOnce();
  }

  /** The layout is CSS keyed on these two classes, on the body and, for the site chrome, the root. */
  #applyClasses() {
    document.body.classList.toggle(ImmersiveMode.BODY_CLASS, this.#active);
    document.documentElement.classList.toggle(ImmersiveMode.CHROMELESS_CLASS, this.#active);
  }

  /** Swaps the button's icon and accessible state to describe the action it now offers. */
  #renderButton() {
    const icon = this.#active ? 'minimize-2-white-feather.svg' : 'maximize-2-white-feather.svg';
    this.#icon.setAttribute('src', util.assetPath(`images/icons/${icon}`));
    this.#button.setAttribute('aria-pressed', String(this.#active));
    this.#button.setAttribute('aria-label',
      i18next.t(this.#active ? 'controls.immersive-exit' : 'controls.immersive-enter'));
  }

  /** Tells a first-time user how to get back, once per browser session: the navbar they might reach for is gone. */
  #showExitHintOnce() {
    if (ImmersiveMode.#readStored(ImmersiveMode.#EXIT_HINT_SEEN_KEY)) return;
    ImmersiveMode.#writeStored(ImmersiveMode.#EXIT_HINT_SEEN_KEY, '1');
    Toast.show({ message: i18next.t('controls.immersive-exit-hint'), dark: true, compact: true });
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
