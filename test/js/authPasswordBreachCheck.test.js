/**
 * Tests for AuthModal.js's advisory breached-password check (#4492).
 *
 * The contract worth pinning is what leaves the browser and what the user is told: at most the first five hex
 * characters of the SHA-1 may appear in the request; a blocked or failing lookup must leave the user able to sign
 * up as if the check never ran; and HIBP's padding filler (suffixes with a count of 0) is not a hit.
 */

const crypto = require('node:crypto');
const { TextEncoder } = require('node:util');
const { loadGlobalScript } = require('./loadGlobalScript');

// jsdom leaves TextEncoder out of the page globals; every browser that runs this code has it.
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const BREACH_MESSAGE = 'This password has shown up in a known data breach.';
const DEBOUNCE_MS = 500;

// A password that satisfies every PasswordPolicy rule, so the checklist can't be what suppresses the lookup.
const PASSWORD = 'TestPass1';
const PASSWORD_SHA1 = crypto.createHash('sha1').update(PASSWORD).digest('hex').toUpperCase();

/** The four PasswordPolicy rules, as the Twirl template injects them. */
const RULE_REGEXES = ['.{8,}', '[A-Z]', '[a-z]', '\\d'];

/**
 * A reduction of common/authPasswordFields.scala.html, not a copy: it keeps the structure the JS walks, so a
 * selector change in either file shows up here, but it does not hold the template to its markup.
 */
const PASSWORD_GROUP = `
  <div class="au-pw-group" data-breach-url="${RANGE_URL}" data-breach-warning="${BREACH_MESSAGE}">
    <div class="au-field">
      <div class="au-input-wrap">
        <input class="au-input au-pw" id="sign-up-password" name="password" type="password"
               aria-describedby="sign-up-pw-rules">
        <button type="button" class="au-eye" data-eye="sign-up-password" data-label-show="show"
                data-label-hide="hide"></button>
      </div>
      <ul class="au-checklist" id="sign-up-pw-rules">
        ${RULE_REGEXES.map((r) => `<li data-rule-regex="${r}"><span class="au-dot"></span>rule</li>`).join('')}
      </ul>
      <div class="au-strength">
        <div class="au-slabs au-pw-slabs"><span></span><span></span><span></span><span></span></div>
        <span class="au-pw-strength-word" data-word1="Weak" data-word2="Okay" data-word3="Good"
              data-word4="Strong"></span>
      </div>
    </div>
    <div class="au-field">
      <div class="au-input-wrap">
        <input class="au-input au-pw-confirm" id="sign-up-password-confirm" name="passwordConfirm" type="password">
      </div>
      <div class="au-match au-pw-match" data-label-match="match" data-label-no-match="no match">
        <span class="au-match-text">match</span>
      </div>
    </div>
  </div>`;

/** The navbar's sign-in dialog, which sits alongside a page's own auth fields on e.g. /resetPassword. */
const AUTH_DIALOG = `
  <dialog id="sign-in-modal-container" class="au-dialog">
    <div class="au-panel" id="sign-in-modal"><form id="sign-in-form" class="au-form"></form></div>
    <div class="au-panel" id="sign-up-modal"></div>
  </dialog>`;

/**
 * Renders a password group and starts AuthModal.js against it.
 *
 * jsdom keeps one window for the whole file, so the DOMContentLoaded listener is intercepted rather than left to
 * accumulate: each test then runs exactly one freshly-loaded copy, with its own range cache.
 *
 * @param {{withDialog?: boolean}} [options] - `withDialog` also renders the navbar sign-in dialog on the page.
 */
function renderPasswordGroup({ withDialog = false } = {}) {
  let domReady;
  jest.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'DOMContentLoaded') domReady = handler;
  });
  window.PsModal = class {
    open() {}

    close() {}
  };
  document.body.innerHTML = `
    ${withDialog ? AUTH_DIALOG : ''}
    <div class="au-page"><form id="sign-up-form" class="au-form">${PASSWORD_GROUP}</form></div>`;
  loadGlobalScript('public/js/common/AuthModal.js');
  domReady();
}

/**
 * Types a password, then runs out the debounce and every promise it chains. `advanceTimersByTimeAsync` drains the
 * microtask queue as it goes, so this stays correct however many awaits the lookup grows.
 *
 * @param {string} value - The password to type.
 */
async function typePassword(value) {
  const pw = document.getElementById('sign-up-password');
  pw.value = value;
  pw.dispatchEvent(new window.Event('input'));
  await jest.advanceTimersByTimeAsync(DEBOUNCE_MS);
}

const warning = () => document.querySelector('.au-warning');
const warningShown = () => warning() !== null;
const strengthWord = () => document.querySelector('.au-pw-strength-word').textContent;

/**
 * Installs a `window.crypto` whose SHA-1 is real, so the range URL asserted on is the one a browser would build.
 * jsdom's own `crypto` is a non-writable accessor with no `subtle`, hence defineProperty.
 *
 * @param {boolean} available - False to stand in for an insecure origin with no Web Crypto.
 */
function stubWebCrypto(available) {
  const subtle = {
    digest: async (algorithm, data) => {
      expect(algorithm).toBe('SHA-1');
      return crypto.createHash('sha1').update(Buffer.from(data)).digest().buffer;
    },
  };
  Object.defineProperty(window, 'crypto', { value: available ? { subtle } : undefined, configurable: true });
}

beforeEach(() => {
  jest.useFakeTimers();
  stubWebCrypto(true);
});

afterEach(() => {
  // Restores the window.addEventListener spy however the test body exited; leaving it installed would swallow
  // every later load's DOMContentLoaded registration and misattribute the failures.
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete window.fetch;
  delete window.PsModal;
});

describe('advisory breached-password check', () => {
  test('sends only the first five hex characters of the hash, never the password', async () => {
    window.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    renderPasswordGroup();
    await typePassword(PASSWORD);

    expect(window.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = window.fetch.mock.calls[0];
    expect(url).toBe(RANGE_URL + PASSWORD_SHA1.slice(0, 5));
    expect(url).not.toContain(PASSWORD);
    expect(url).not.toContain(PASSWORD_SHA1.slice(5));
    expect(options.headers['Add-Padding']).toBe('true');
  });

  test('warns and drops the strength meter when the hash suffix comes back with a real count', async () => {
    window.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => `0000000000000000000000000000000000A:12\r\n${PASSWORD_SHA1.slice(5)}:4823\r\n`,
    });
    renderPasswordGroup();
    await typePassword(PASSWORD);

    expect(warningShown()).toBe(true);
    expect(warning().textContent).toContain(BREACH_MESSAGE);
    expect(strengthWord()).toBe('Weak');
    expect(document.querySelectorAll('.au-pw-slabs span.paved')).toHaveLength(1);
  });

  test('announces the warning by inserting it, as a live region rather than a field description', async () => {
    window.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => `${PASSWORD_SHA1.slice(5)}:9\r\n` });
    renderPasswordGroup();
    // Nothing to announce and nothing in the description before a verdict lands.
    expect(warningShown()).toBe(false);
    expect(document.getElementById('sign-up-password').getAttribute('aria-describedby'))
      .toBe('sign-up-pw-rules');

    await typePassword(PASSWORD);

    expect(warning().getAttribute('role')).toBe('status');
  });

  test('treats a padding entry for the same suffix as no hit', async () => {
    window.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => `${PASSWORD_SHA1.slice(5)}:0\r\n` });
    renderPasswordGroup();
    await typePassword(PASSWORD);

    expect(warningShown()).toBe(false);
    expect(strengthWord()).toBe('Strong');
  });

  test('stays silent when the password is not in the corpus', async () => {
    window.fetch = jest.fn()
      .mockResolvedValue({ ok: true, text: async () => 'ABCDEF0123456789ABCDEF0123456789ABC:9\r\n' });
    renderPasswordGroup();
    await typePassword(PASSWORD);

    expect(warningShown()).toBe(false);
    expect(strengthWord()).toBe('Strong');
  });

  test('fails open when the lookup rejects', async () => {
    window.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    renderPasswordGroup();
    await typePassword(PASSWORD);

    expect(warningShown()).toBe(false);
    expect(strengthWord()).toBe('Strong');
  });

  test('fails open on a non-OK response', async () => {
    window.fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => '' });
    renderPasswordGroup();
    await typePassword(PASSWORD);

    expect(warningShown()).toBe(false);
  });

  test('skips the lookup for a password that has not met the composition rules yet', async () => {
    window.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    renderPasswordGroup();
    await typePassword('short1');

    expect(window.fetch).not.toHaveBeenCalled();
  });

  test('clears the warning once the user edits the flagged password', async () => {
    window.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => `${PASSWORD_SHA1.slice(5)}:4823\r\n` });
    renderPasswordGroup();
    await typePassword(PASSWORD);
    expect(warningShown()).toBe(true);

    window.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    await typePassword(`${PASSWORD}xyz`);

    expect(warningShown()).toBe(false);
  });

  test('debounces to one lookup for a password typed straight through', async () => {
    window.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    renderPasswordGroup();
    const pw = document.getElementById('sign-up-password');
    for (let i = 1; i <= PASSWORD.length; i++) {
      pw.value = PASSWORD.slice(0, i);
      pw.dispatchEvent(new window.Event('input'));
      await jest.advanceTimersByTimeAsync(50);
    }
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(window.fetch).toHaveBeenCalledTimes(1);
  });

  test('caches the range, so returning to a checked password costs no second request', async () => {
    window.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    renderPasswordGroup();
    await typePassword(PASSWORD);
    await typePassword(`${PASSWORD}!`); // Same 5-char prefix is not guaranteed, so this may fetch again.
    const afterDetour = window.fetch.mock.calls.length;
    await typePassword(PASSWORD);

    expect(window.fetch).toHaveBeenCalledTimes(afterDetour);
  });

  test('does nothing at all without Web Crypto (an insecure origin)', async () => {
    stubWebCrypto(false);
    window.fetch = jest.fn();
    renderPasswordGroup();
    await typePassword(PASSWORD);

    expect(window.fetch).not.toHaveBeenCalled();
    expect(warningShown()).toBe(false);
  });

  test('wires the page\'s own fields even when the navbar dialog is on the page too', async () => {
    window.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => `${PASSWORD_SHA1.slice(5)}:4823\r\n` });
    renderPasswordGroup({ withDialog: true });
    await typePassword(PASSWORD);

    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(warningShown()).toBe(true);
    // The eye toggle is wired from the same pass, so it stands in for the rest of enhanceAuthForms.
    document.querySelector('.au-eye').dispatchEvent(new window.Event('click'));
    expect(document.getElementById('sign-up-password').type).toBe('text');
  });
});
