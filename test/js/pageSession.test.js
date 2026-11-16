/**
 * Tests for the tool pages' start-up session fetch (frontend/js/common/pageSession.js). Explore and Validate have
 * nothing to show without a session, so what matters is what the loading screen turns into when the fetch fails: a
 * notice that says to reload for a server or network failure, or to check the address for a link the server
 * rejected, announced to screen readers either way (#5840).
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { textOf } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => `t(${key})` } }));

let fetchJson;
let loadPageSession;
let readyCallbacks;

beforeEach(async () => {
  // The loading overlay of apps/explore.scala.html, cut down.
  document.body.innerHTML = `
    <div id="page-loading">
      <p class="loading-text">Loading...</p>
      <p class="loading-sub-text">Thanks for helping!</p>
    </div>`;
  fetchJson = vi.fn();
  useUtil({ fetchJson });
  // The translations are not in yet; each test says when they arrive.
  readyCallbacks = [];
  window.appManager = { ready: (callback) => readyCallbacks.push(callback) };
  ({ loadPageSession } = await loadModules('frontend/js/common/pageSession.js'));
});

const overlay = () => document.getElementById('page-loading');
/** Runs what was waiting on the translations. */
const translationsLoaded = () => readyCallbacks.forEach((callback) => callback());

/**
 * @param {number} [status] - The HTTP status the request failed with; none for a network failure.
 * @returns {Error} What `util.fetchJson` throws for it.
 */
const failure = (status) => Object.assign(new Error('request failed'), status === undefined ? {} : { status });

describe('loadPageSession', () => {
  it('answers with the session and leaves the loading screen as it was', async () => {
    const init = { method: 'POST', body: '{}' };
    fetchJson.mockResolvedValue({ mission: { mission_id: 4 } });

    await expect(loadPageSession('/validate/session', init)).resolves.toEqual({ mission: { mission_id: 4 } });

    expect(fetchJson).toHaveBeenCalledWith('/validate/session', init);
    expect(readyCallbacks).toHaveLength(0);
    expect(overlay().hasAttribute('role')).toBe(false);
  });

  it('asks with no options for a plain GET', async () => {
    fetchJson.mockResolvedValue({});

    await loadPageSession('/explore/session?regionId=3');

    expect(fetchJson).toHaveBeenCalledWith('/explore/session?regionId=3', {});
  });

  it.each([
    ['a server error', 500],
    ['a network failure', undefined],
  ])('turns the loading screen into a notice to reload after %s', async (_what, status) => {
    const error = failure(status);
    fetchJson.mockRejectedValue(error);

    await expect(loadPageSession('/explore/session')).rejects.toBe(error);
    // Nothing changes until the translations it needs are in.
    expect(overlay().classList.contains('page-loading--failed')).toBe(false);
    translationsLoaded();

    expect(overlay().classList.contains('page-loading--failed')).toBe(true);
    expect(textOf(overlay().querySelector('.loading-text'))).toBe('t(common:session-load-failed.title)');
    expect(textOf(overlay().querySelector('.loading-sub-text'))).toBe('t(common:session-load-failed.body)');
    expect(overlay().getAttribute('role')).toBe('alert');
  });

  it.each([400, 404])('says to check the address when the server rejected the link (%i)', async (status) => {
    fetchJson.mockRejectedValue(failure(status));

    await expect(loadPageSession('/explore/session?routeId=abc')).rejects.toThrow();
    translationsLoaded();

    expect(textOf(overlay().querySelector('.loading-sub-text'))).toBe('t(common:session-load-failed.bad-link)');
  });
});
