/**
 * Small non-blocking status pill for viewport label loading (#5002): "zoom in to see labels" when the zoom floor
 * is holding fetches back, and a brief "loading" note during refetches. The full-map MapLoadingOverlay owns the
 * initial load and the error state; this pill only covers the in-session states that shouldn't cover the map.
 *
 * The zoom hint is a hint, not a status: it shows for a few seconds when the map arrives below the floor and
 * fades, and shows again only after the map has been above the floor and dropped back below it. A pill that
 * sits over the map for the whole visit stops being read and takes the spot that later hints want.
 *
 * The hint follows the site's toast convention (`common/Toast.js`, #5415): a close button for a reader who is done
 * with it, and a fade that waits while it is hovered or focused, for one still reading it. It stays a pill rather
 * than a Toast because Toast is fixed-positioned on <body> and one-shot, while this is a stateful element that lives
 * inside the map and centers itself on the map's visible part (`--map-inset-left`). The brief loading note gets no
 * close button: it is a status that clears itself, not a hint.
 */
export class MapStatusPill {
  /** How long the zoom hint stays before fading. */
  static HINT_DURATION_MS = 6000;
  /** The fade's length; matches `--transition-medium` in main.css, which the stylesheet animates it with. */
  static FADE_MS = 300;

  /** @type {HTMLElement} */
  #el;
  /** @type {HTMLElement} */
  #mapContainer;
  /** @type {HTMLSpanElement} */
  #text;
  /** @type {HTMLButtonElement} */
  #close;
  /** @type {boolean} */
  #hovered = false;
  /** @type {boolean} */
  #focused = false;
  /** @type {string} */
  #state = 'idle';
  /** @type {?number} */
  #loadingTimer = null;
  /** @type {?number} */
  #hintTimer = null;
  /** @type {?number} */
  #fadeTimer = null;
  /** @type {() => boolean} */
  #suppressLoading;
  /** @type {{belowFloor: string, loading: string}} */
  #keys;

  /**
   * @param {HTMLElement} mapContainer - The map's container element (position: relative); the pill is appended
   *     to it and centered along its top edge.
   * @param {object} [options]
   * @param {() => boolean} [options.suppressLoading] - Returns true while the loading state should not be shown —
   *     e.g. while the initial full-map overlay is already up.
   * @param {object} [options.keys] - i18next keys for the two messages, for a host whose viewport layer isn't
   *     labels — the AccessScore tool draws label *clusters*, and the pill has to say what will appear.
   * @param {string} [options.keys.belowFloor] - Key for the "zoom in" message.
   * @param {string} [options.keys.loading] - Key for the "loading" message.
   */
  constructor(mapContainer, { suppressLoading = () => false, keys = {} } = {}) {
    this.#suppressLoading = suppressLoading;
    this.#keys = {
      belowFloor: keys.belowFloor || 'labelmap:zoom-in-for-labels',
      loading: keys.loading || 'labelmap:loading-labels',
    };
    this.#mapContainer = mapContainer;
    this.#el = document.createElement('div');
    this.#el.className = 'map-status-pill';
    this.#el.setAttribute('role', 'status');
    this.#el.setAttribute('aria-live', 'polite');
    this.#el.hidden = true;

    this.#text = document.createElement('span');
    this.#text.className = 'map-status-pill__text';
    this.#close = document.createElement('button');
    this.#close.type = 'button';
    this.#close.className = 'map-status-pill__close';
    this.#close.setAttribute('aria-label', i18next.t('common:close'));
    // The mask goes on a child span: on the button itself it would clip away the button's focus ring.
    const closeIcon = document.createElement('span');
    closeIcon.className = 'map-status-pill__close-icon ps-mask-icon';
    closeIcon.setAttribute('aria-hidden', 'true');
    this.#close.appendChild(closeIcon);
    this.#close.addEventListener('click', () => this.#dismiss());
    this.#el.append(this.#text, this.#close);

    this.#el.addEventListener('mouseenter', () => {
      this.#hovered = true;
      this.#applyPause();
    });
    this.#el.addEventListener('mouseleave', () => {
      this.#hovered = false;
      this.#applyPause();
    });
    this.#el.addEventListener('focusin', () => {
      this.#focused = true;
      this.#applyPause();
    });
    this.#el.addEventListener('focusout', () => {
      this.#focused = false;
      this.#applyPause();
    });
    mapContainer.appendChild(this.#el);
  }

  /**
   * Shows the pill for the given loader state (or hides it).
   * @param {string} state - One of 'idle' | 'loading' | 'belowFloor' | 'error'.
   */
  setState(state) {
    if (state === this.#state) return;
    this.#state = state;
    clearTimeout(this.#loadingTimer);
    this.#loadingTimer = null;
    clearTimeout(this.#hintTimer);
    this.#hintTimer = null;

    if (state === 'belowFloor') {
      this.#show(i18next.t(this.#keys.belowFloor), { closable: true });
      this.#startHintTimer();
    } else if (state === 'loading') {
      // Delayed so a fast refetch (warm cache, small bbox) never flickers the pill in and out.
      this.#loadingTimer = setTimeout(() => {
        if (this.#state === 'loading' && !this.#suppressLoading()) {
          this.#show(i18next.t(this.#keys.loading), { closable: false });
        }
      }, 400);
      this.#hide();
    } else {
      // 'idle' hides it; 'error' does too — the retryable error card is MapLoadingOverlay's job.
      this.#hide();
    }
  }

  /**
   * @param {string} text - The localized message to show.
   * @param {object} options
   * @param {boolean} options.closable - Whether the close button is offered.
   */
  #show(text, { closable }) {
    clearTimeout(this.#fadeTimer);
    this.#fadeTimer = null;
    this.#el.classList.remove('map-status-pill--leaving');
    this.#text.textContent = text;
    this.#close.hidden = !closable;
    this.#el.hidden = false;
  }

  /** Hides the pill at once. */
  #hide() {
    clearTimeout(this.#fadeTimer);
    this.#fadeTimer = null;
    const hadFocus = this.#el.contains(document.activeElement);
    this.#el.classList.remove('map-status-pill--leaving');
    this.#el.hidden = true;
    // mouseleave/focusout don't reliably fire on an element that goes display:none, so they're reset here.
    this.#hovered = false;
    this.#focused = false;
    // A close button hidden while it held focus would drop keyboard focus to <body>, the top of the page; the map
    // is where the reader was, so focus goes back to its canvas (Mapbox makes it focusable). This runs after
    // `hidden` is set, so the focusout it causes can't restart the hint's countdown.
    if (hadFocus) this.#mapContainer.querySelector('canvas[tabindex]')?.focus();
  }

  /**
   * The close button: hides the hint at once, without the fade, since the reader asked for it gone. The state stays
   * 'belowFloor', so setState's same-state guard keeps it hidden until the map crosses the floor again.
   */
  #dismiss() {
    clearTimeout(this.#hintTimer);
    this.#hintTimer = null;
    this.#hide();
    window.logWebpageActivity?.('Click_module=MapStatusPill_Dismiss');
  }

  /** Starts (or restarts) the zoom hint's countdown to its fade. */
  #startHintTimer() {
    clearTimeout(this.#hintTimer);
    this.#hintTimer = setTimeout(() => {
      this.#hintTimer = null;
      this.#fadeOut();
    }, MapStatusPill.HINT_DURATION_MS);
  }

  /**
   * Holds the zoom hint's fade while it is hovered or focused, and restarts the full countdown once it is neither, as
   * Toast does, so a reader who paused on it gets the whole duration back rather than a sliver. Focus matters most:
   * the role="status" announcement gives no cue that the hint is on a clock (WCAG 2.2.1). A hint already fading is
   * left to finish.
   */
  #applyPause() {
    if (this.#state !== 'belowFloor' || this.#el.hidden || this.#el.classList.contains('map-status-pill--leaving')) {
      return;
    }
    if (this.#hovered || this.#focused) {
      clearTimeout(this.#hintTimer);
      this.#hintTimer = null;
    } else if (this.#hintTimer === null) {
      this.#startHintTimer();
    }
  }

  /** Fades the pill out, then hides it; `hidden` itself can't animate. */
  #fadeOut() {
    if (this.#el.hidden) return;
    this.#el.classList.add('map-status-pill--leaving');
    this.#fadeTimer = setTimeout(() => this.#hide(), MapStatusPill.FADE_MS);
  }
}
