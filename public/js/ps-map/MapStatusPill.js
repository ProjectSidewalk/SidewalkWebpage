/**
 * Small non-blocking status pill for viewport label loading (#5002): "zoom in to see labels" while the zoom
 * floor is holding fetches back, and a brief "loading" note during refetches. The full-map MapLoadingOverlay
 * owns the initial load and the error state; this pill only covers the in-session states that shouldn't cover
 * the map.
 */
class MapStatusPill {
  /** @type {HTMLElement} */
  #el;
  /** @type {string} */
  #state = 'idle';
  /** @type {?number} */
  #loadingTimer = null;
  /** @type {() => boolean} */
  #suppressLoading;
  /** @type {{belowFloor: string, loading: string}} */
  #keys;

  /**
   * @param {HTMLElement} mapContainer The map's container element (position: relative); the pill is appended
   *     to it and centered along its top edge.
   * @param {object} [options]
   * @param {() => boolean} [options.suppressLoading] Returns true while the loading state should not be shown —
   *     e.g. while the initial full-map overlay is already up.
   * @param {object} [options.keys] i18next keys for the two messages, for a host whose viewport layer isn't
   *     labels — the AccessScore tool draws label *clusters*, and the pill has to say what will appear.
   * @param {string} [options.keys.belowFloor] Key for the "zoom in" message.
   * @param {string} [options.keys.loading] Key for the "loading" message.
   */
  constructor(mapContainer, { suppressLoading = () => false, keys = {} } = {}) {
    this.#suppressLoading = suppressLoading;
    this.#keys = {
      belowFloor: keys.belowFloor || 'labelmap:zoom-in-for-labels',
      loading: keys.loading || 'labelmap:loading-labels',
    };
    this.#el = document.createElement('div');
    this.#el.className = 'map-status-pill';
    this.#el.setAttribute('role', 'status');
    this.#el.setAttribute('aria-live', 'polite');
    this.#el.hidden = true;
    mapContainer.appendChild(this.#el);
  }

  /**
   * Shows the pill for the given loader state (or hides it).
   * @param {string} state One of 'idle' | 'loading' | 'belowFloor' | 'error'.
   */
  setState(state) {
    if (state === this.#state) return;
    this.#state = state;
    clearTimeout(this.#loadingTimer);
    this.#loadingTimer = null;

    if (state === 'belowFloor') {
      this.#show(i18next.t(this.#keys.belowFloor));
    } else if (state === 'loading') {
      // Delayed so a fast refetch (warm cache, small bbox) never flickers the pill in and out.
      this.#loadingTimer = setTimeout(() => {
        if (this.#state === 'loading' && !this.#suppressLoading()) {
          this.#show(i18next.t(this.#keys.loading));
        }
      }, 400);
      this.#hide();
    } else {
      // 'idle' hides it; 'error' does too — the retryable error card is MapLoadingOverlay's job.
      this.#hide();
    }
  }

  /** @param {string} text The localized message to show. */
  #show(text) {
    this.#el.textContent = text;
    this.#el.hidden = false;
  }

  /** Hides the pill. */
  #hide() {
    this.#el.hidden = true;
  }
}
