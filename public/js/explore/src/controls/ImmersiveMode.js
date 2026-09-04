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
 */
class ImmersiveMode {
  static BODY_CLASS = 'svl-immersive';
  static CHROMELESS_CLASS = 'chromeless';
  // sessionStorage, not localStorage: the hint is about this window's exit key, and a returning user who has forgotten
  // it deserves to see it once more.
  static #EXIT_HINT_SEEN_KEY = 'svl-immersive-exit-hint-seen';

  #active = false;
  #tracker;
  #relayout;
  #holder;
  #button;
  #icon;

  /**
   * @param {Tracker} tracker - Logs the paired Click_/KeyboardShortcut_ events.
   * @param {function(): void} relayout - Re-lays out the tool for its new box (svl.relayout), called on every toggle.
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
    document.body.classList.toggle(ImmersiveMode.BODY_CLASS, this.#active);
    document.documentElement.classList.toggle(ImmersiveMode.CHROMELESS_CLASS, this.#active);
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
    try {
      if (window.sessionStorage.getItem(ImmersiveMode.#EXIT_HINT_SEEN_KEY)) return;
      window.sessionStorage.setItem(ImmersiveMode.#EXIT_HINT_SEEN_KEY, '1');
    } catch {
      // Storage access throws in some privacy modes; showing the hint again is the harmless outcome.
    }
    Toast.show({ message: i18next.t('controls.immersive-exit-hint'), dark: true, compact: true });
  }
}
