/**
 * Tests for the composer's daily-cap message: when the server says how long the wait is, the message names it as a
 * duration ("You can publish another in 3 hours") rather than the old "try again tomorrow" — which was never true,
 * since the cap is a rolling 24-hour window and "tomorrow" depends on a timezone the server doesn't know.
 *
 * The formatter is a private static, so it's exercised through the public error path: a stubbed fetch returns the
 * 429 body the controller produces, and the rendered error text is asserted.
 */

import { loadModules, mockModule } from './loader.js';
import { flush, routeFetch } from './support/routeFetch.js';
import { composerMarkup, fakeDraftStore, installDialogs } from './support/storyHarness.js';

const i18next = { t: (key) => key };
mockModule('i18next', () => ({ default: i18next }));

/** The two real English strings, so the assertions read as the user would see them. */
const STRINGS = {
  'labelmap:story.error.rate-limited':
        'You’ve published as many stories as we allow in a day. Please try again later.',
  'labelmap:story.error.rate-limited-retry':
        'You’ve published as many stories as we allow in a day. You can publish another {{when}}.',
  'labelmap:story.error.rate-limited-ip':
        'Too many stories have been submitted from your network recently. Please try again later.',
  'labelmap:story.error.rate-limited-ip-retry':
        'Too many stories have been submitted from your network recently. You can try again {{when}}.',
  'labelmap:story.error.generic': 'Something went wrong.',
};

const errorText = () => document.querySelector('.story-composer__error').textContent;

let StoryComposer;

/** Runs a submission that the server refuses with `body` at HTTP 429. */
async function submitAndFail(body) {
  document.body.innerHTML = composerMarkup();
  const composer = new StoryComposer(document.querySelector('.story-composer'), {});
  routeFetch({ 'POST /userapi/stories': { status: 429, body } });
  await composer.open(7, 5000);
  document.querySelector('.story-composer__text').value = 'The curb here is impassable in my chair.';
  document.querySelector('.story-composer__submit').click();
  await flush();
}

beforeEach(async () => {
  ({ StoryComposer } = await loadModules('frontend/js/common/label-detail/StoryComposer.js'));
  // #postForm posts through util.lazyIdentityFetch (#4442), which passes a non-auth failure like this suite's 429
  // through unchanged; the mint/retry path has its own suite (lazyIdentityFetch.test.js).
  Object.assign(i18next, {
    language: 'en',
    exists: (key) => key in STRINGS,
    t: (key, opts) => (STRINGS[key] || key).replace('{{when}}', (opts && opts.when) || ''),
  });
  window.logWebpageActivity = vi.fn();
  installDialogs();
  fakeDraftStore(); // open() looks for a draft stashed before a sign-in.
});

describe('the daily-cap message', () => {
  const RATE_LIMITED = { error: 'story.error.rate-limited', message: 'fallback' };

  test('names the wait in hours when the server says how long it is', async () => {
    await submitAndFail({ ...RATE_LIMITED, retry_after_seconds: 3 * 3600 });
    expect(errorText()).toBe(
      'You’ve published as many stories as we allow in a day. You can publish another in 3 hours.');
  });

  test('switches to minutes for a short wait, rounding up', async () => {
    // 20.5 minutes: "in 21 minutes" is a promise we can keep; "in 20" would refuse them again.
    await submitAndFail({ ...RATE_LIMITED, retry_after_seconds: 1230 });
    expect(errorText()).toContain('in 21 minutes');
  });

  test('an 80-minute wait stays in minutes rather than rounding to "1 hour"', async () => {
    await submitAndFail({ ...RATE_LIMITED, retry_after_seconds: 80 * 60 });
    expect(errorText()).toContain('in 80 minutes');
  });

  test('hours round up too — a 2h05m wait must not read "in 2 hours"', async () => {
    // Rounding to nearest would promise a moment 5 minutes before the slot opens; ceiling never does.
    await submitAndFail({ ...RATE_LIMITED, retry_after_seconds: 2 * 3600 + 300 });
    expect(errorText()).toContain('in 3 hours');
  });

  test('falls back to the untimed message when the server sends no wait', async () => {
    await submitAndFail(RATE_LIMITED);
    expect(errorText()).toBe('You’ve published as many stories as we allow in a day. Please try again later.');
  });

  test('a nonsense wait is ignored rather than rendered', async () => {
    await submitAndFail({ ...RATE_LIMITED, retry_after_seconds: 'soon' });
    expect(errorText()).toBe('You’ve published as many stories as we allow in a day. Please try again later.');
  });

  test('the phrase is formatted in the reader\'s language', async () => {
    i18next.language = 'es';
    await submitAndFail({ ...RATE_LIMITED, retry_after_seconds: 3 * 3600 });
    expect(errorText()).toContain('dentro de 3 horas');
  });
});

describe('the network (IP) burst message', () => {
  // The IP layer can trip for someone who published nothing themselves (a shared NAT), so its copy blames the
  // network rather than the person — a distinct key from the per-user daily cap's.
  const IP_LIMITED = { error: 'story.error.rate-limited-ip', message: 'fallback' };

  test('names the wait when the server says how long is left in the window', async () => {
    await submitAndFail({ ...IP_LIMITED, retry_after_seconds: 2 * 3600 });
    expect(errorText()).toBe(
      'Too many stories have been submitted from your network recently. You can try again in 2 hours.');
  });

  test('falls back to the untimed network message when the server sends no wait', async () => {
    await submitAndFail(IP_LIMITED);
    expect(errorText()).toBe(
      'Too many stories have been submitted from your network recently. Please try again later.');
  });
});
