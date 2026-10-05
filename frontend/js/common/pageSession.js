/**
 * The tool pages' start-up fetch (#5650). The page's HTML carries only session scalars; the mission or task it opens
 * on is asked for here, so a copy of the page served from a cache can never show work the user already did.
 */
import { util } from './utilities.js';

/**
 * Fetches the page's session as JSON. A failure turns the loading overlay into a failure notice, since without a
 * session there is nothing to build the tool on: a reload for a server or network failure, or a look at the address
 * when the server rejected the request (a `?routeId=abc`, say), which no reload would fix.
 * @param {string} url - The endpoint that resolves the session.
 * @param {RequestInit} [init] - Request options, for a POST that carries the page's filters.
 * @returns {Promise<any>} The parsed response.
 */
export async function loadPageSession(url, init = {}) {
  try {
    return await util.fetchJson(url, init);
  } catch (error) {
    const badLink = error.status >= 400 && error.status < 500;
    // The request can fail before the translations are in; the app manager runs the callback once they are.
    window.appManager.ready(() => {
      const overlay = document.getElementById('page-loading');
      if (!overlay) return;
      overlay.classList.add('page-loading--failed');
      overlay.querySelector('.loading-text').textContent = i18next.t('common:session-load-failed.title');
      overlay.querySelector('.loading-sub-text').textContent
        = i18next.t(badLink ? 'common:session-load-failed.bad-link' : 'common:session-load-failed.body');
      // Set after the text, so the alert is announced with the message in it.
      overlay.setAttribute('role', 'alert');
    });
    throw error;
  }
}
