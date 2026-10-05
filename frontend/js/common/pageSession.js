/**
 * The tool pages' start-up fetch (#5650). The page's HTML carries only session scalars; the mission or task it opens
 * on is asked for here, so a copy of the page served from a cache can never show work the user already did.
 */

/**
 * Fetches the page's session as JSON. A failure leaves the loading overlay up with a message that says to reload,
 * since without a session there is nothing to build the tool on.
 * @param {string} url - The endpoint that resolves the session.
 * @param {RequestInit} [init] - Request options, for a POST that carries the page's filters.
 * @returns {Promise<any>} The parsed response.
 */
export async function loadPageSession(url, init = {}) {
  try {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`Session request failed with HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    // The request can fail before the translations are in; the app manager runs the callback once they are.
    window.appManager.ready(() => {
      const note = document.querySelector('#page-loading .loading-sub-text');
      if (note) note.textContent = i18next.t('common:session-load-failed');
    });
    throw error;
  }
}
