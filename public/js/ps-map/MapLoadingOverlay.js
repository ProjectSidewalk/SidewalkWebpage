/**
 * Load-state overlay for the label maps: an indeterminate spinner with a live elapsed-time counter while the
 * label feed streams in, and a retryable error card when it fails.
 *
 * The map itself is ready in about a second, but the feed can be tens of megabytes (Seattle is ~87 MB), during
 * which the sidebar sits greyed with no cue that work is happening. Elapsed time rather than a progress bar:
 * the response is gzipped, so Content-Length is the compressed size, and the label count isn't known until the
 * payload has fully parsed — neither yields an honest percentage.
 *
 * The error state is driven by the caller's `catch`, not by anything observed here. The feed is a chunked 200,
 * so a stream that dies mid-flight arrives as a truncated body under a success status and only surfaces when
 * the JSON parse throws (#3932).
 *
 * Markup comes from the shared `common.mapLoadingOverlay` Twirl partial, so /labelMap and /admin/label-map
 * present the same thing.
 */
class MapLoadingOverlay {
  #root;
  #loadingCard;
  #errorCard;
  #elapsedEl;
  #retryButton;
  #timer = null;

  /**
   * @param {object} [options]
   * @param {Function} [options.onRetry] - Invoked when retry is pressed. Defaults to reloading the page, which
   *     is the honest retry: the feed is fetched once while the map is built, so there is nothing to re-request
   *     without reconstructing the map.
   */
  constructor({ onRetry } = {}) {
    this.#root = document.getElementById('labelmap-loading');
    if (!this.#root) return; // Page didn't include the partial; every method below then no-ops.
    this.#loadingCard = document.getElementById('labelmap-loading-card');
    this.#errorCard = document.getElementById('labelmap-error-card');
    this.#elapsedEl = document.getElementById('labelmap-loading-elapsed');
    this.#retryButton = document.getElementById('labelmap-retry');
    this.#retryButton.addEventListener('click', () => (onRetry ? onRetry() : window.location.reload()));
  }

  /** Shows the spinner card and starts the elapsed-time counter. */
  show() {
    if (!this.#root) return;
    const start = performance.now();
    const renderElapsed = () => {
      const seconds = ((performance.now() - start) / 1000).toFixed(1);
      this.#elapsedEl.textContent = i18next.t('labelmap:loading-elapsed', { seconds });
    };
    renderElapsed();
    this.#loadingCard.hidden = false;
    this.#errorCard.hidden = true;
    this.#root.setAttribute('aria-busy', 'true');
    this.#root.hidden = false;
    this.#stopTimer(); // Guard against a second show() leaving the first interval running.
    this.#timer = setInterval(renderElapsed, 100);
  }

  /** Hides the overlay entirely. Call once the map's data has rendered. */
  hide() {
    if (!this.#root) return;
    this.#stopTimer();
    this.#root.hidden = true;
  }

  /**
   * Swaps the spinner for the error card, keeping the overlay up so the failure is visible rather than leaving
   * a silently empty map. Focus moves to retry so keyboard users land on the only available action.
   */
  showError() {
    if (!this.#root) return;
    this.#stopTimer();
    this.#loadingCard.hidden = true;
    this.#errorCard.hidden = false;
    this.#root.setAttribute('aria-busy', 'false');
    this.#root.hidden = false;
    this.#retryButton.focus();
  }

  #stopTimer() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}
