/**
 * Tests for the dashboard's "Recent mistakes" cards beyond their image (frontend/js/user-dashboard/MistakeGallery.js,
 * #5840): which mistakes are shown, the empty state, and the response controls. The image and its credit have their
 * own suites, dashboardMistakeCardImage.test.js and dashboardMistakeCardAttribution.test.js.
 *
 * A mapper answers each mistake with a vote (agree, or "it was correct") and an optional note, from the card or from
 * the label popup the card opens. The two copies of the controls share one state, so an answer given in one place
 * has to show in the other. The admin's view of a dashboard shows the same controls but must not let them post.
 */

import { loadModules, mockModule } from './loader.js';
import { fakePanoOverlays } from './fakes.js';
import { flush, routeFetch, sentRequests } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key, opts) => (opts ? `${key}|${JSON.stringify(opts)}` : key) } }));
fakePanoOverlays();

const { MistakeGallery } = await loadModules('frontend/js/user-dashboard/MistakeGallery.js');

const MISTAKES_URL = '/userapi/mistakes';
const VOTE_URL = '/userapi/mistakeVote';
const NOTE_URL = '/userapi/mistakeNote';

/**
 * One record shaped like an entry from GET /userapi/mistakes.
 * @param {object} [overrides] - Fields to add or replace.
 * @returns {object} The record.
 */
function mistake(overrides = {}) {
  return {
    label_id: 501, pano_id: 'abc123', heading: 12, pitch: -5, zoom: 1, canvas_x: 180, canvas_y: 360,
    label_type: 'Obstacle', time_validated: '2026-07-01T12:00:00Z', validator_comment: null,
    crop_url: '/cropImage/Obstacle/501?exp=1&sig=x', image_url: null, pano_source: 'gsv', ...overrides,
  };
}

/**
 * Renders the section the way dashboard.js does, against stubbed endpoints.
 * @param {object} [answers] - What each endpoint answers (any `routeFetch` answer): `mistakes`, `vote`, `note`.
 * @param {object} [opts] - MistakeGallery options to add or replace.
 * @returns {Promise<import('vitest').Mock>} The fetch stub.
 */
async function renderGallery(answers = {}, opts = {}) {
  document.body.innerHTML = `
    <div class="ud-mistake-cards" id="ud-mistakes"></div>
    <a class="ud-see-all" id="ud-mistakes-seeall" href="#" hidden>See all</a>
    <dialog id="label-modal" class="label-detail"></dialog>`;
  const stub = routeFetch({
    [MISTAKES_URL]: answers.mistakes ?? { Obstacle: [mistake()] },
    [`POST ${VOTE_URL}`]: answers.vote ?? {},
    [`POST ${NOTE_URL}`]: answers.note ?? {},
  });
  await new MistakeGallery(document.getElementById('ud-mistakes'), {
    userId: 'ada', limit: 6, seeAllEl: document.getElementById('ud-mistakes-seeall'), ...opts,
  }).render();
  return stub;
}

/** @returns {Array<HTMLElement>} The rendered cards, in order. */
const cards = () => Array.from(document.querySelectorAll('.ud-card'));
/** @returns {HTMLElement} The see-all link. */
const seeAll = () => document.getElementById('ud-mistakes-seeall');

/**
 * @param {import('vitest').Mock} stub - The fetch stub.
 * @param {string} url - An endpoint.
 * @returns {Array<object>} The bodies posted to it, in order.
 */
const posted = (stub, url) => sentRequests(stub).filter((r) => r.url === url).map((r) => r.body);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('which mistakes are shown', () => {
  test('mixes every label type into one list, newest first, and asks for only as many as it shows', async () => {
    const stub = await renderGallery({ mistakes: {
      Obstacle: [mistake({ label_id: 1, time_validated: '2026-07-01T00:00:00Z' })],
      CurbRamp: [mistake({ label_id: 2, label_type: 'CurbRamp', time_validated: '2026-07-03T00:00:00Z' }),
        mistake({ label_id: 3, label_type: 'CurbRamp', time_validated: '2026-06-01T00:00:00Z' })],
    } }, { limit: 2 });

    expect(cards().map((c) => c.querySelector('[data-ud-vote]').dataset.udVote)).toEqual(['2', '1']);
    expect(stub.mock.calls[0][0]).toBe('/userapi/mistakes?userId=ada&n=2');
    expect(seeAll().hidden).toBe(false);
  });

  test('cheers a mapper with no mistakes, and hides "see all"', async () => {
    await renderGallery({ mistakes: { Obstacle: [], CurbRamp: null } });

    expect(cards()).toHaveLength(0);
    expect(document.querySelector('#ud-mistakes .ud-nudge').textContent).toBe('dashboard:mistake-cards.empty');
    expect(seeAll().hidden).toBe(true);
  });

  test('reads an empty answer as no mistakes', async () => {
    await renderGallery({ mistakes: () => null });

    expect(document.querySelector('#ud-mistakes .ud-nudge')).not.toBeNull();
  });

  test('renders with or without a "see all" link on the page', async () => {
    await renderGallery({}, { seeAllEl: null });
    expect(cards()).toHaveLength(1);

    await renderGallery({ mistakes: {} }, { seeAllEl: null });
    expect(document.querySelector('#ud-mistakes .ud-nudge')).not.toBeNull();
  });

  test('leaves the section as it was, and logs, when the request fails', async () => {
    await renderGallery({ mistakes: { status: 500 } });

    expect(document.getElementById('ud-mistakes').children).toHaveLength(0);
    expect(seeAll().hidden).toBe(true);
    expect(console.error).toHaveBeenCalledWith('Failed to load recent mistakes', expect.any(Error));
  });
});

describe('a card', () => {
  test('quotes the validator, or says they left no comment', async () => {
    await renderGallery({ mistakes: { Obstacle: [mistake({ label_id: 1, validator_comment: 'Just a shadow.' }),
      mistake({ label_id: 2, time_validated: '2026-06-01T00:00:00Z' })] } });

    const [quoted, silent] = cards().map((c) => c.querySelector('.ud-card-note'));
    expect(quoted.textContent).toBe('dashboard:mistake-cards.validator-quote|{"c":"Just a shadow."}');
    expect(quoted.classList.contains('ud-card-note-muted')).toBe(false);
    expect(silent.textContent).toBe('dashboard:validator-no-comment');
    expect(silent.classList.contains('ud-card-note-muted')).toBe(true);
  });

  test('still renders, without a marker, for a label type the page has no icon for', async () => {
    await renderGallery({ mistakes: { Mystery: [mistake({ label_type: 'Mystery' })] } });

    expect(cards()).toHaveLength(1);
    expect(document.querySelector('.ud-card-label-marker')).toBeNull();
    expect(document.querySelector('.ud-card-photo')).not.toBeNull();

    document.querySelector('.ud-card-photo').dispatchEvent(new Event('error'));
    expect(document.querySelector('.ud-card-photo')).toBeNull();
  });

  test('offers no popup button when the page has no label popup', async () => {
    await renderGallery();

    expect(document.querySelector('.ud-card-open')).toBeNull();
  });
});

describe('voting on a mistake', () => {
  /**
   * @param {string} which - 'agree' or 'disagree'.
   * @param {ParentNode} [scope] - Where to find the vote chip; the first card by default.
   */
  const vote = (which, scope = document) => scope.querySelector(`.ud-chip-${which}`).click();

  test('agreeing posts the vote and shows it, with a way to change it', async () => {
    const stub = await renderGallery();

    vote('agree');
    await flush();

    expect(posted(stub, VOTE_URL)).toEqual([{ label_id: 501, agrees: true }]);
    const section = document.querySelector('[data-ud-vote]');
    expect(section.classList.contains('ud-card-vote--done')).toBe(true);
    expect(section.querySelector('.ud-card-voted-msg').textContent).toBe('dashboard:mistake-cards.voted-agree');
  });

  test('contesting posts the opposite vote and says so', async () => {
    const stub = await renderGallery();

    vote('disagree');
    await flush();

    expect(posted(stub, VOTE_URL)).toEqual([{ label_id: 501, agrees: false }]);
    expect(document.querySelector('.ud-card-voted-msg').textContent).toBe('dashboard:mistake-cards.voted-contest');
  });

  test('changing a response brings back both choices without posting anything', async () => {
    const stub = await renderGallery();
    vote('agree');
    await flush();

    document.querySelector('.ud-card-change').click();

    expect(document.querySelector('.ud-chip-agree')).not.toBeNull();
    expect(document.querySelector('.ud-chip-disagree')).not.toBeNull();
    expect(posted(stub, VOTE_URL)).toHaveLength(1);
  });

  test('locks the choices while the vote is out, and frees them again if it fails', async () => {
    await renderGallery({ vote: { status: 500 } });

    vote('agree');
    expect(document.querySelector('.ud-chip-agree').disabled).toBe(true);
    await flush();

    expect(document.querySelector('.ud-chip-agree').disabled).toBe(false);
    expect(document.querySelector('.ud-card-voted-msg')).toBeNull();
    expect(console.error).toHaveBeenCalledWith('Failed to record vote', expect.any(Error));
  });
});

describe('leaving a note', () => {
  /** @returns {HTMLElement} The first note section on the page. */
  const noteSection = () => document.querySelector('[data-ud-note]');

  test('the note box opens and closes from its link, and takes focus when it opens', async () => {
    await renderGallery();
    const link = noteSection().querySelector('.ud-card-note-link');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });

    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(noteSection().querySelector('.ud-card-note-wrap').hidden).toBe(false);
    expect(document.activeElement).toBe(noteSection().querySelector('textarea'));

    link.click();
    expect(noteSection().querySelector('.ud-card-note-wrap').hidden).toBe(true);
  });

  test('saves the trimmed note and shows it, with the link now offering to edit it', async () => {
    const stub = await renderGallery();
    noteSection().querySelector('textarea').value = '  It was a real pole.  ';

    noteSection().querySelector('.ud-card-note-submit').click();
    await flush();

    expect(posted(stub, NOTE_URL)).toEqual([{ label_id: 501, comment: 'It was a real pole.' }]);
    expect(noteSection().querySelector('.ud-card-your-note').textContent)
      .toBe('dashboard:mistake-cards.your-note|{"note":"It was a real pole."}');
    expect(noteSection().querySelector('.ud-card-note-link').textContent).toBe('dashboard:mistake-cards.edit-note');
    expect(noteSection().querySelector('textarea').value).toBe('It was a real pole.');
  });

  test('keeps the typed note, and frees the box again, when the save fails', async () => {
    await renderGallery({ note: { status: 500 } });
    noteSection().querySelector('textarea').value = 'It was a real pole.';

    noteSection().querySelector('.ud-card-note-submit').click();
    expect(noteSection().querySelector('textarea').hasAttribute('disabled')).toBe(true);
    await flush();

    expect(noteSection().querySelector('textarea').hasAttribute('disabled')).toBe(false);
    expect(noteSection().querySelector('textarea').value).toBe('It was a real pole.');
    expect(noteSection().querySelector('.ud-card-your-note')).toBeNull();
    expect(console.error).toHaveBeenCalledWith('Failed to save note', expect.any(Error));
  });
});

describe('the admin\'s read-only view', () => {
  test('shows the controls but lets none of them act', async () => {
    const stub = await renderGallery({}, { readOnly: true });
    const link = document.querySelector('.ud-card-note-link');

    expect(document.querySelector('.ud-chip-agree').disabled).toBe(true);
    expect(document.querySelector('.ud-chip-disagree').disabled).toBe(true);
    expect(link.getAttribute('aria-disabled')).toBe('true');
    expect(link.getAttribute('tabindex')).toBe('-1');

    link.click();
    expect(document.querySelector('.ud-card-note-wrap').hidden).toBe(true);
    expect(posted(stub, VOTE_URL)).toEqual([]);
  });
});

describe('answering from the label popup', () => {
  let labelPopup;

  /** @returns {HTMLDialogElement} The shared label popup dialog. */
  const dialog = () => document.getElementById('label-modal');
  /** @returns {?HTMLElement} The response panel inside the popup, if any. */
  const panel = () => dialog().querySelector('.ud-mistake-response');

  beforeEach(() => {
    // The real popup opens its dialog as part of showing a label.
    labelPopup = { showLabel: vi.fn(async () => { dialog().setAttribute('open', ''); }) };
  });

  test('opens the label in the popup and puts the same vote and note controls inside it', async () => {
    await renderGallery({}, { labelPopup });

    document.querySelector('.ud-card-open').click();
    await flush();

    expect(labelPopup.showLabel).toHaveBeenCalledWith(501, 'UserDashboard');
    expect(panel().querySelector('.ud-mistake-response-heading').textContent)
      .toBe('dashboard:mistake-cards.popup-heading');
    expect(panel().querySelector('[data-ud-vote="501"]')).not.toBeNull();
    expect(panel().querySelector('[data-ud-note="501"]')).not.toBeNull();
  });

  test('a vote cast in the popup shows on the card too', async () => {
    await renderGallery({}, { labelPopup });
    document.querySelector('.ud-card-open').click();
    await flush();

    panel().querySelector('.ud-chip-disagree').click();
    await flush();

    const card = document.querySelector('.ud-card');
    expect(card.querySelector('.ud-card-voted-msg').textContent).toBe('dashboard:mistake-cards.voted-contest');
    expect(panel().querySelector('.ud-card-voted-msg').textContent).toBe('dashboard:mistake-cards.voted-contest');
  });

  test('swaps in a fresh panel for each card opened, rather than stacking them', async () => {
    await renderGallery({ mistakes: { Obstacle: [mistake({ label_id: 1 }),
      mistake({ label_id: 2, time_validated: '2026-06-01T00:00:00Z' })] } }, { labelPopup });
    const [first, second] = document.querySelectorAll('.ud-card-open');

    first.click();
    await flush();
    second.click();
    await flush();

    expect(dialog().querySelectorAll('.ud-mistake-response')).toHaveLength(1);
    expect(panel().querySelector('[data-ud-vote]').dataset.udVote).toBe('2');
  });

  test('takes its panel down when the popup closes, so another label never posts this card\'s answer', async () => {
    await renderGallery({}, { labelPopup });
    document.querySelector('.ud-card-open').click();
    await flush();

    dialog().dispatchEvent(new Event('close'));

    expect(panel()).toBeNull();
  });

  test('adds no panel when the popup did not end up open', async () => {
    labelPopup.showLabel = vi.fn(async () => {});
    await renderGallery({}, { labelPopup });

    document.querySelector('.ud-card-open').click();
    await flush();

    expect(panel()).toBeNull();
  });

  test('logs, and leaves the card working, when the popup fails to open', async () => {
    labelPopup.showLabel = vi.fn(async () => { throw new Error('pano failed'); });
    await renderGallery({}, { labelPopup });

    document.querySelector('.ud-card-open').click();
    await flush();

    expect(panel()).toBeNull();
    expect(console.error).toHaveBeenCalledWith('Failed to open the label popup', expect.any(Error));
    expect(document.querySelector('.ud-card .ud-chip-agree').disabled).toBe(false);
  });
});
