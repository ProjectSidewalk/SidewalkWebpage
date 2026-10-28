/**
 * Tests for changing a label's type from the label detail card (frontend/js/common/label-detail/LabelDetail.js,
 * issue #3671).
 *
 * The title is the type: a plain span for most viewers, and for the labeler and admins a button that opens a picker
 * of types. A pick saves at once, like a rating or a tag, but with two differences these pin down. The card draws
 * nothing ahead of the response, since the server decides what the rating and tags become under the new type; and
 * the confirmation carries an Undo that re-posts the previous state, which the server folds with the change. The
 * save also names the type the card showed, and a 409 means the label moved on under it, so the card redraws from
 * the reply instead of rolling back.
 *
 * jsdom has no popover API, so the picker takes the inline fallback path, which is what the assertions read. The
 * pano manager, the toast and the card's flourishes (badges, stories, the info popover, the hide toggle) are
 * stand-ins: the real ones want a viewer and page markup, and none is what a type change exercises.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { mockLabelDetailCollaborators } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key, opts) => (opts?.labelType ? `${key}:${opts.labelType}` : key) } }));

/** The pano manager the card is handed; rebuilt per test so a test can settle its setPano() when it likes. */
let panoManager;
const toast = { show: vi.fn() };

mockLabelDetailCollaborators(() => panoManager);
mockModule('frontend/js/common/Toast.js', () => ({ Toast: toast }));

/**
 * The card markup as views/common/labelDetail.scala.html renders it, reduced to what #cacheElements() looks up.
 * @returns {HTMLElement} The card root, mounted in the document.
 */
function buildCard() {
  document.body.innerHTML = `
    <div id="card" class="label-detail">
      <header class="label-detail__header">
        <div class="label-detail__title-wrap">
          <h2 class="label-detail__title">
            <span class="label-type-trigger label-type-trigger--static">
              <img class="label-type-trigger__icon" alt=""><span class="label-type-trigger__name"></span>
            </span>
            <button type="button" class="label-type-trigger label-type-trigger__button" hidden aria-expanded="false">
              <img class="label-type-trigger__icon" alt=""><span class="label-type-trigger__name"></span>
            </button>
          </h2>
          <span class="label-detail__own-badge" role="img" hidden></span>
          <span class="label-detail__edit-status label-detail__edit-status--type" role="status"></span>
        </div>
      </header>
      <div class="label-type-popover" popover hidden>
        <p class="label-type-popover__hint" hidden></p>
        <div class="label-type-popover__chips"></div>
      </div>
      <div class="label-detail__pano-wrap">
        <div class="label-detail__pano"></div>
        <button type="button" class="label-detail__hide-label"></button>
        <div class="label-detail__pano-overlay" role="group">
          <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--agree" data-action="validate" data-result="Agree" aria-pressed="false"></button>
          <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--disagree" data-action="validate" data-result="Disagree" aria-pressed="false"></button>
          <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--unsure" data-action="validate" data-result="Unsure" aria-pressed="false"></button>
        </div>
      </div>
      <div class="label-detail__meta-row">
        <div class="label-detail__meta-cell"><span><span class="label-detail__labeled-word"></span>:</span><span class="label-detail__timestamp label-detail__meta-value"></span></div>
        <div class="label-detail__meta-cell"><span class="label-detail__image-capture-date label-detail__meta-value"></span></div>
        <span class="label-detail__meta-divider label-detail__meta-divider--address" hidden></span>
        <div class="label-detail__meta-cell label-detail__meta-cell--address" hidden><a class="label-detail__address label-detail__meta-value"></a></div>
        <button type="button" class="label-detail__meta-cell label-detail__meta-cell--details"><span class="label-detail__info-button-host"></span></button>
      </div>
      <div class="label-detail__columns">
        <section class="label-detail__col label-detail__col--validations">
          <div class="label-detail__vote-display">
            ${['agree', 'disagree', 'unsure'].map((v) => `
              <button type="button" class="label-detail__vote label-detail__vote--${v}" aria-pressed="false">
                <span class="label-detail__vote-top"><img alt="" class="label-detail__vote-icon"><span class="label-detail__vote-count">0</span></span>
              </button>`).join('')}
          </div>
        </section>
        <section class="label-detail__col label-detail__col--severity">
          <div class="label-detail__col-header">
            <h3 class="label-detail__col-title label-detail__severity-title"></h3>
            <span class="label-detail__edit-status" role="status"></span>
          </div>
          <div class="label-detail__severity-faces" role="group">
            ${[1, 2, 3].map((n) => `
              <button type="button" class="severity-button" data-severity="${n}" aria-pressed="false">
                <img alt="" class="severity-button__icon"><span class="severity-button__label"></span>
              </button>`).join('')}
          </div>
        </section>
        <section class="label-detail__col label-detail__col--tags">
          <div class="label-detail__col-header">
            <h3 class="label-detail__col-title label-detail__tags-title"></h3>
            <button type="button" class="label-detail__tags-edit" hidden aria-expanded="false"></button>
            <span class="label-detail__edit-status" role="status"></span>
          </div>
          <div class="label-detail__tags"></div>
        </section>
      </div>
      <div class="label-detail__desc-comments">
        <section class="label-detail__description-section"><div class="label-detail__description"></div></section>
        <section class="label-detail__comments-section">
          <h3 class="label-detail__col-title label-detail__comments-title"><span class="label-detail__comments-count" hidden></span></h3>
          <div class="label-detail__comment-row">
            <label class="sr-only" for="c">Why?</label>
            <input type="text" id="c" class="label-detail__comment-input">
            <button type="button" class="label-detail__comment-submit" data-action="submit-comment"></button>
            <span class="label-detail__comment-confirmation" role="status" hidden></span>
          </div>
          <div class="label-detail__validator-comments"></div>
        </section>
      </div>
      <section class="label-detail__stories" hidden></section>
      <span class="label-detail__story-status sr-only" role="status"></span>
      <div class="label-detail__footer"><a class="label-detail__explore-link" hidden></a><a class="label-detail__labelmap-link" hidden></a></div>
    </div>`;
  return document.getElementById('card');
}

/** Label metadata in the shape `/label/id/:id` serves. */
function meta(overrides = {}) {
  return {
    label_id: 42, label_type: 'Obstacle', severity: 2, tags: ['pole'], can_edit: true, from_current_user: false,
    description: '', pano_id: 'pano-1', lat: 47.61, lng: -122.33, camera_lat: 47.615, camera_lng: -122.335,
    heading: 250.5, pitch: -12, zoom: 2, canvas_x: 100, canvas_y: 200, street_edge_id: 7, region_id: 3,
    timestamp: '2026-08-01T12:00:00Z', image_capture_date: '2025-06-01', num_agree: 0, num_disagree: 0,
    num_unsure: 0, user_validation: null, ai_validation: null, comments: [], ...overrides,
  };
}

describe('changing a label\'s type from the card (#3671)', () => {
  let card;
  let saveRequest;
  let onEdit;
  /** What /label/edit answers next: a status and a body, or the default echo of the request. */
  let nextReply = null;

  const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
  const q = (sel) => card.querySelector(sel);
  const typeButton = () => q('.label-type-trigger__button');
  const picker = () => q('.label-type-popover');
  const chip = (type) => q(`.label-type-popover__chips [data-label-type="${type}"]`);
  const typeStatus = () => q('.label-detail__edit-status--type');
  const savedEdits = () => saveRequest.mock.calls.filter(([url]) => url === '/label/edit')
    .map(([, opts]) => JSON.parse(opts.body));

  async function showLabel(overrides) {
    const payload = meta(overrides);
    await card.detail.showLabel(payload, 'TestSource');
    panoManager.resolvePano(true);
    await flush();
    return payload;
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    card = buildCard();
    nextReply = null;
    onEdit = vi.fn();
    saveRequest = vi.fn(async (url, opts) => {
      const body = JSON.parse(opts.body);
      const reply = nextReply ?? {
        status: 200,
        body: { label_type: body.new_label_type ?? body.label_type, severity: body.severity, tags: body.tags },
      };
      nextReply = null;
      return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
    });

    window.logWebpageActivity = vi.fn();
    useUtil({ lazyIdentityFetch: saveRequest });

    let resolvePano;
    panoManager = {
      clearLabels: vi.fn(),
      setLabel: vi.fn(),
      setLabelType: vi.fn(),
      setLabelsHidden: vi.fn(),
      setPano: vi.fn(() => new Promise((res) => { resolvePano = res; })),
      resolvePano: (shown) => resolvePano(shown),
      activeViewerName: 'Default',
      panoViewer: { currPanoData: null },
      svHolder: document.createElement('div'),
    };
    // The tag catalog for the tag editor, and the label itself for the vote-count refresh after a type change.
    window.fetch = vi.fn((url) => {
      if (String(url).includes('/label/id/')) {
        return Promise.resolve({ ok: true, json: async () => meta({ num_agree: 1, num_disagree: 0, num_unsure: 0 }) });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    const { LabelDetail } = await loadModules('frontend/js/common/label-detail/LabelDetail.js');
    card.detail = await LabelDetail.create(card, {
      admin: false, viewerType: 'Default', currUsername: 'tester', panoOverlaySource: 'test',
      voteColumnSource: 'test', onEdit,
    });
  });

  test('the title is a plain span for a viewer who may not edit, and a button for one who may', async () => {
    await showLabel({ can_edit: false });
    expect(typeButton().hidden).toBe(true);
    expect(q('.label-type-trigger--static').hidden).toBe(false);
    expect(q('.label-type-trigger--static .label-type-trigger__name').textContent).toBe('common:obstacle');

    await showLabel({ can_edit: true });
    expect(typeButton().hidden).toBe(false);
    expect(q('.label-type-trigger--static').hidden).toBe(true);
    expect(typeButton().getAttribute('aria-label')).toBe('common:obstacle: common:label-type-picker.change-type');
    expect(typeButton().querySelector('.label-type-trigger__icon').getAttribute('src')).toContain('Obstacle_small');
  });

  test('the button opens the picker with the label\'s own type marked current, and logs the open', async () => {
    await showLabel();

    typeButton().click();

    expect(picker().hidden).toBe(false);
    expect(typeButton().getAttribute('aria-expanded')).toBe('true');
    expect(chip('Obstacle').getAttribute('aria-disabled')).toBe('true');
    expect(window.logWebpageActivity).toHaveBeenCalledWith(expect.stringContaining('EditLabelTypeOpen'));
  });

  test('a pick posts the type shown and the type picked, then draws the reply', async () => {
    await showLabel({ severity: 2, tags: ['pole'] });
    typeButton().click();

    chip('Signal').click();
    await flush();

    expect(picker().hidden).toBe(true);
    expect(savedEdits()).toEqual([expect.objectContaining({
      label_id: 42, label_type: 'Obstacle', new_label_type: 'Signal', severity: null, tags: ['pole'],
    })]);
    // The reply is the truth: Signal is unrated, so the rating column goes away with it.
    expect(q('.label-type-trigger__button .label-type-trigger__name').textContent).toBe('common:signal');
    expect(panoManager.setLabelType).toHaveBeenCalledWith('Signal');
    expect(q('.label-detail__col--severity').hidden).toBe(true);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ label_type: 'Signal' }));
    expect(window.logWebpageActivity).toHaveBeenCalledWith(
      expect.stringContaining('EditLabelType_old=Obstacle_new=Signal'),
    );
  });

  test('the confirmation offers an Undo that re-posts the previous state, without offering another', async () => {
    await showLabel({ severity: 2, tags: ['pole'] });
    typeButton().click();
    chip('SurfaceProblem').click();
    await flush();

    expect(typeStatus().textContent).toContain('labelmap:edit-type-changed:common:surface-problem');
    const undo = typeStatus().querySelector('.label-detail__edit-status-action');
    expect(undo.textContent).toBe('labelmap:edit-undo');

    undo.click();
    await flush();

    expect(savedEdits()[1]).toEqual(expect.objectContaining({
      label_type: 'SurfaceProblem', new_label_type: 'Obstacle', severity: 2, tags: ['pole'],
    }));
    expect(q('.label-type-trigger__button .label-type-trigger__name').textContent).toBe('common:obstacle');
    expect(typeStatus().textContent).toBe('labelmap:edit-saved');
    expect(typeStatus().querySelector('.label-detail__edit-status-action')).toBeNull();
    expect(window.logWebpageActivity).toHaveBeenCalledWith(
      expect.stringContaining('EditLabelType_old=SurfaceProblem_new=Obstacle_undo=true'),
    );
  });

  test('Ctrl+Z presses the Undo while it is offered, and logs it as a shortcut', async () => {
    await showLabel({ severity: 2, tags: ['pole'] });
    typeButton().click();
    chip('SurfaceProblem').click();
    await flush();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', ctrlKey: true, bubbles: true }));
    await flush();

    expect(savedEdits()[1]).toEqual(expect.objectContaining({ new_label_type: 'Obstacle' }));
    expect(window.logWebpageActivity).toHaveBeenCalledWith(
      expect.stringMatching(/^KeyboardShortcut_module=LabelDetail_action=EditLabelType_old=SurfaceProblem_new=Obstacle_undo=true/),
    );

    // With nothing left to undo, the chord is the page's again.
    window.logWebpageActivity.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', ctrlKey: true, bubbles: true }));
    await flush();
    expect(savedEdits()).toHaveLength(2);
  });

  test('a type change re-reads the vote counts, since votes on the old type stop counting', async () => {
    await showLabel({ num_agree: 3 });
    expect(q('.label-detail__vote--agree .label-detail__vote-count').textContent).toBe('3');
    typeButton().click();

    chip('SurfaceProblem').click();
    await flush();
    await flush();

    expect(window.fetch).toHaveBeenCalledWith('/label/id/42', expect.anything());
    expect(q('.label-detail__vote--agree .label-detail__vote-count').textContent).toBe('1');
  });

  test('a type change clears the user\'s vote from the pano when it was cast on the old type (#5853)', async () => {
    await showLabel({ num_disagree: 1, user_validation: 'Disagree' });
    const wrap = q('.label-detail__pano-wrap');
    const overlayDisagree = q('.label-detail__pano-overlay-button--disagree');
    expect(wrap.classList.contains('is-disagree')).toBe(true);
    expect(overlayDisagree.classList.contains('is-selected')).toBe(true);
    typeButton().click();

    chip('SurfaceProblem').click();
    await flush();
    await flush();

    expect(wrap.classList.contains('is-disagree')).toBe(false);
    expect(overlayDisagree.classList.contains('is-selected')).toBe(false);
    expect(overlayDisagree.getAttribute('aria-pressed')).toBe('false');
    expect(q('.label-detail__vote--disagree').getAttribute('aria-pressed')).toBe('false');
    // Gallery's small card is redrawn from what the host is handed, so it must carry the new type's votes.
    expect(onEdit).toHaveBeenLastCalledWith(expect.objectContaining({
      label_type: 'SurfaceProblem', user_validation: null, num_agree: 1, num_disagree: 0,
    }));
  });

  test('a 409 redraws the card from the reply and says the label was changed elsewhere', async () => {
    await showLabel({ severity: 2, tags: ['pole'] });
    typeButton().click();
    nextReply = { status: 409, body: { label_type: 'CurbRamp', severity: 1, tags: [] } };

    chip('Signal').click();
    await flush();

    expect(q('.label-type-trigger__button .label-type-trigger__name').textContent).toBe('common:curb-ramp');
    expect(q('.label-detail__severity-faces [data-severity="1"]').getAttribute('aria-pressed')).toBe('true');
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({
      message: 'labelmap:edit-conflict', dark: true, compact: true,
    }));
    expect(typeStatus().textContent).toBe('');
    // The label really is on a different type now, so the host and the vote counts have to hear about it.
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ label_id: 42, label_type: 'CurbRamp' }));
    expect(window.fetch).toHaveBeenCalledWith('/label/id/42', expect.anything());
  });

  test('the rating goes with the type only when both read it the same way', async () => {
    // Obstacle and Surface Problem both rate how much the thing gets in the way, so the 2 still means what it did.
    await showLabel({ severity: 2, tags: [] });
    typeButton().click();
    chip('SurfaceProblem').click();
    await flush();
    expect(savedEdits().at(-1)).toEqual(expect.objectContaining({ new_label_type: 'SurfaceProblem', severity: 2 }));

    // A curb ramp is rated on how well it does its job instead, so the old number would be a different claim.
    await showLabel({ severity: 2, tags: [] });
    typeButton().click();
    chip('CurbRamp').click();
    await flush();
    expect(savedEdits().at(-1)).toEqual(expect.objectContaining({ new_label_type: 'CurbRamp', severity: null }));
  });

  test('a rating edit also names the type shown, so the server can spot a card that fell behind', async () => {
    await showLabel({ severity: 2 });

    q('.label-detail__severity-faces [data-severity="3"]').click();
    await flush();

    expect(savedEdits()).toEqual([expect.objectContaining({ label_type: 'Obstacle', new_label_type: null, severity: 3 })]);
  });

  test('the vote shortcuts stay quiet while focus is inside the picker', async () => {
    await showLabel();
    typeButton().click();
    chip('Signal').focus();
    const agree = q('[data-result="Agree"]');
    const clicks = vi.fn();
    agree.addEventListener('click', clicks);

    chip('Signal').dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }));

    expect(clicks).not.toHaveBeenCalled();
  });
});
