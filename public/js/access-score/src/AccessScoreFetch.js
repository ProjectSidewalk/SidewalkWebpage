/**
 * The AccessScore tool's JSON fetch, with the retry a cold server asks for (#5418).
 *
 * The whole-city score endpoints are cached per JVM, and a request that finds the cache empty gets a `503` with a
 * `Retry-After` once the computation has outlasted the request budget — the server keeps computing, so the client
 * that comes back when told finds the value. The same shape covers a `502`/`503`/`504` from the reverse proxy in front
 * of a slow or restarting backend. Nothing else is retried: a `4xx` means the request itself is wrong, and a network
 * failure is the page's error card, not a wait.
 */
class AccessScoreFetch {
  /** The statuses that mean "not yet" rather than "no": the server's own deadline and the proxy's. */
  static #RETRYABLE_STATUSES = new Set([502, 503, 504]);

  /** Delays between attempts when the server names none, in seconds; the last one repeats until the cap. */
  static #BACKOFF_SECONDS = [5, 10, 20, 30];

  /**
   * How long, on the wall clock since the first attempt, the page keeps waiting before it gives up and shows the
   * error card. Wall clock rather than the sum of the waits: each attempt against a still-cold server itself blocks
   * for up to the server's own deadline (45 s) before the next `503`, and that time is waiting too.
   */
  static #MAX_TOTAL_WAIT_SECONDS = 300;

  /**
   * Fetches JSON, waiting out a server that is still computing the answer.
   *
   * @param {string} url - The URL to fetch.
   * @param {object} [options]
   * @param {(attempt: number) => void} [options.onAttempt] - Called with the 1-based attempt number right before each
   *     request goes out, so the page can show that one is in flight; a retry can block for tens of seconds
   *     server-side with no timer running on this side.
   * @param {(attempt: number, delaySeconds: number) => void} [options.onWait] - Called before each wait with the
   *     1-based number of the attempt that just failed and the seconds until the next one, so the page can say so.
   * @param {(response: Response) => boolean} [options.isRetryable] - Overrides which failed responses are worth
   *     another attempt; defaults to `502`, `503` and `504`.
   * @param {number} [options.maxTotalWaitSeconds] - Cap on the wall-clock time since the first attempt; defaults to
   *     five minutes.
   * @returns {Promise<any>} The parsed JSON of the first successful response.
   * @throws {Error} The last failure, once a response is not retryable or the next wait would end past the cap.
   */
  static async fetchJsonWithRetry(url, { onAttempt, onWait, isRetryable, maxTotalWaitSeconds } = {}) {
    const retryable = isRetryable ?? ((response) => AccessScoreFetch.#RETRYABLE_STATUSES.has(response.status));
    const cap = maxTotalWaitSeconds ?? AccessScoreFetch.#MAX_TOTAL_WAIT_SECONDS;
    const startedAt = AccessScoreFetch.#now();
    for (let attempt = 1; ; attempt += 1) {
      onAttempt?.(attempt);
      const response = await fetch(url);
      if (response.ok) return response.json();
      const error = new Error(`${url}: HTTP ${response.status}`);
      if (!retryable(response)) throw error;
      const delaySeconds = AccessScoreFetch.#delaySeconds(response, attempt);
      // Giving up is a decision about the total, not the count: a server naming long waits, or one that holds each
      // request for a long time before refusing it, runs the cap down faster.
      const elapsedSeconds = (AccessScoreFetch.#now() - startedAt) / 1000;
      if (elapsedSeconds + delaySeconds > cap) throw error;
      onWait?.(attempt, delaySeconds);
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }
  }

  /**
   * How long to wait before the next attempt: what the server said if it gave a delay in seconds, else the backoff.
   * An HTTP-date `Retry-After` is legal but not something this server sends, so it falls through to the backoff
   * rather than being parsed against a clock the page cannot trust. A `0` is read as one second: it would otherwise
   * hammer the server without ever running the cap down.
   *
   * @param {Response} response - The failed response.
   * @param {number} attempt - The 1-based number of the attempt that just failed.
   * @returns {number} Seconds to wait.
   */
  static #delaySeconds(response, attempt) {
    const header = response.headers?.get?.('Retry-After');
    if (header !== undefined && header !== null && /^\d+$/.test(header.trim())) {
      return Math.max(1, Number.parseInt(header, 10));
    }
    const backoff = AccessScoreFetch.#BACKOFF_SECONDS;
    return backoff[Math.min(attempt, backoff.length) - 1];
  }

  /**
   * The wall clock in milliseconds. `performance.now()` is monotonic, so a system-clock correction mid-wait cannot
   * end the cap early or stretch it; `Date.now()` covers an environment without it.
   *
   * @returns {number} Milliseconds; only differences are meaningful.
   */
  static #now() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }
}
