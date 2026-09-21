/**
 * Tests for deleting a label from the label card (public/js/common/label-detail/LabelDetail.js, issue #3591).
 *
 * Delete sits in the title row for whoever the server says may edit, behind a confirm that tells an admin their
 * Disagree goes with it. The card stays open on a delete with Restore in the notice; Ctrl+Z presses that Restore for
 * a delete made in the same card, and only then. A deleted label locks validating and editing with its own reason.
 *
 * Built the way labelDetailTypeEdit.test.js is: the sources are eval'd into the jsdom global scope with the
 * collaborators LabelDetail reaches for as bare globals stubbed on `window` first.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub } = require('./loadGlobalScript');

const readSrc = (rel) => fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
const LABEL_DETAIL_SRC = readSrc('public/js/common/label-detail/LabelDetail.js');
const TAG_EDITOR_SRC = readSrc('public/js/common/label-detail/TagEditor.js');
const PICKER_SRC = readSrc('public/js/common/LabelTypePicker.js');

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
            <span class="label-detail__type label-detail__type--static">
              <img class="label-detail__type-icon" alt=""><span class="label-detail__type-name"></span>
            </span>
            <button type="button" class="label-detail__type label-detail__type-button" hidden aria-expanded="false">
              <img class="label-detail__type-icon" alt=""><span class="label-detail__type-name"></span>
            </button>
          </h2>
          <button type="button" class="label-detail__delete" hidden></button>
          <span class="label-detail__own-badge" role="img" hidden></span>
          <span class="label-detail__edit-status label-detail__edit-status--type" role="status"></span>
        </div>
      </header>
      <div class="label-detail__type-picker" popover hidden>
        <div class="label-detail__type-picker-chips"></div>
      </div>
      <div class="label-detail__pano-wrap">
        <div class="label-detail__pano"></div>
        <div class="label-detail__deleted-notice" role="status" hidden>
          <span class="label-detail__deleted-notice-text"></span>
          <button type="button" class="label-detail__restore" hidden></button>
        </div>
        <button type="button" class="label-detail__hide-label"></button>
        <div class="label-detail__pano-overlay" role="group">
          <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--agree" data-action="validate" data-result="Agree" aria-pressed="false"></button>
          <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--disagree" data-action="validate" data-result="Disagree" aria-pressed="false"></button>
          <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--unsure" data-action="validate" data-result="Unsure" aria-pressed="false"></button>
        </div>
        <span class="label-detail__pan-hint" hidden></span>
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

/** Label metadata in the shape `/label/id/:id` serves: the viewer's own live label unless overridden. */
function meta(overrides = {}) {
  return {
    label_id: 42, label_type: 'Obstacle', severity: 2, tags: ['pole'], can_edit: true, from_current_user: true,
    deleted: false, can_restore: false, description: '', pano_id: 'pano-1', lat: 47.61, lng: -122.33,
    camera_lat: 47.615, camera_lng: -122.335, heading: 250.5, pitch: -12, zoom: 2, canvas_x: 100, canvas_y: 200,
    street_edge_id: 7, region_id: 3, timestamp: '2026-08-01T12:00:00Z', image_capture_date: '2025-06-01',
    num_agree: 0, num_disagree: 0, num_unsure: 0, user_validation: null, ai_validation: null, comments: [],
    ...overrides,
  };
}

describe('deleting a label from the card (#3591)', () => {
  let card;
  let panoManager;
  let request;
  let onDelete;
  let confirmAnswer;
  /** The HTTP status the next DELETE or restore gets; 200 unless a test says otherwise. */
  let nextStatus;
  /** What the next DELETE or restore answers with; the labeler's own delete unless a test says otherwise. */
  let nextBody;

  const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
  const q = (sel) => card.querySelector(sel);
  const deleteButton = () => q('.label-detail__delete');
  const restoreButton = () => q('.label-detail__restore');
  const notice = () => q('.label-detail__deleted-notice');
  const noticeText = () => q('.label-detail__deleted-notice-text').textContent;
  const typeStatus = () => q('.label-detail__edit-status--type');
  const requests = () => request.mock.calls.map(([url, opts]) => `${opts.method} ${url}`);
  const pressCtrlZ = () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', ctrlKey: true, bubbles: true }));
  // jsdom's element.click() fires with `detail` 0, which the card reads as the keyboard; a pointer says 1.
  const pointerClick = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

  async function showLabel(overrides) {
    const payload = meta(overrides);
    await card.detail.showLabel(payload, 'TestSource');
    panoManager.resolvePano(true);
    await flush();
    return payload;
  }

  async function deleteLabel() {
    deleteButton().click();
    await flush();
    await flush();
  }

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    card = buildCard();
    confirmAnswer = true;
    nextStatus = 200;
    nextBody = null;
    onDelete = jest.fn();
    request = jest.fn(async (url, opts) => {
      const status = nextStatus;
      const deleted = opts.method === 'DELETE';
      const body = nextBody ?? { deleted, can_restore: deleted };
      nextStatus = 200;
      nextBody = null;
      return { ok: status < 400, status, json: async () => body };
    });

    window.i18next = { t: (key) => key };
    window.moment = () => ({ format: () => '' });
    window.logWebpageActivity = jest.fn();
    window.camelToKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    window.buildBackupImageData = () => null;
    window.util = {
      assetPath: assetPathStub,
      camelToKebab: window.camelToKebab,
      EXPLORE_CANVAS_WIDTH: 720,
      EXPLORE_CANVAS_HEIGHT: 480,
      isMobile: () => false,
      lazyIdentityFetch: request,
      misc: {
        VALID_LABEL_TYPES: ['Obstacle'],
        getRatingLevelKeys: () => ({ 1: 'low', 2: 'medium', 3: 'high' }),
        getSmileyIconPath: (sev, type, selected) => `${type}-${sev}-${selected}.svg`,
        isPositiveLabelType: () => false,
        labelTypeHasSeverity: () => true,
        getRatingScale: () => 'severity',
        getIconImagePaths: (type) => ({ iconImagePath: `/assets/${type}_small.svg` }),
        getLabelColors: (type) => `color-${type}`,
      },
      pano: { centeredPovToCanvasCoord: () => ({ x: 0, y: 0 }) },
      url: { replaceQuery: () => {} },
    };
    window.BadgeAchievements = { seedCounts: () => {}, recordValidation: () => {} };
    window.Toast = { show: jest.fn() };
    window.ConfirmDialog = { confirm: jest.fn(async () => confirmAnswer) };
    window.LabelVisibilityToggle = class { constructor() {} };
    window.PanoInfoPopover = class { constructor() {} };

    let resolvePano;
    panoManager = {
      clearLabels: jest.fn(),
      setLabel: jest.fn(),
      setLabelType: jest.fn(),
      setLabelsHidden: jest.fn(),
      setPano: jest.fn(() => new Promise((res) => { resolvePano = res; })),
      resolvePano: (shown) => resolvePano(shown),
      activeViewerName: 'Default',
      panoViewer: { currPanoData: null },
      svHolder: [document.createElement('div')],
    };
    window.PopupPanoManager = { create: async () => panoManager };
    // The tag catalog, and the label itself for the vote re-read after an admin's delete.
    window.fetch = jest.fn((url) => {
      if (String(url).includes('/label/id/')) {
        return Promise.resolve({
          ok: true, json: async () => meta({ num_disagree: 1, user_validation: 'Disagree', deleted: true }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    window.eval(`${PICKER_SRC}\n${TAG_EDITOR_SRC}\n${LABEL_DETAIL_SRC}\nwindow.LabelDetail = LabelDetail;`);
    card.detail = await window.LabelDetail.create(card, {
      admin: false, viewerType: 'Default', currUsername: 'tester', panoOverlaySource: 'test',
      voteColumnSource: 'test', onDelete,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('Delete shows for whoever may edit a live label, and Restore for whoever may undo a deleted one', async () => {
    await showLabel({ can_edit: false, from_current_user: false });
    expect(deleteButton().hidden).toBe(true);
    expect(restoreButton().hidden).toBe(true);
    expect(notice().hidden).toBe(true);

    await showLabel({ can_edit: true });
    expect(deleteButton().hidden).toBe(false);
    expect(deleteButton().getAttribute('aria-disabled')).toBe('false');
    expect(deleteButton().getAttribute('data-ps-tooltip')).toBe('labelmap:delete-label');
    expect(restoreButton().hidden).toBe(true);

    // Someone else's deleted label: seen as deleted, but not yours to bring back.
    await showLabel({ can_edit: false, from_current_user: false, deleted: true, can_restore: false });
    expect(deleteButton().hidden).toBe(true);
    expect(restoreButton().hidden).toBe(true);
    expect(notice().hidden).toBe(false);
    expect(noticeText()).toBe('labelmap:label-was-deleted');
    expect(card.classList.contains('label-detail--deleted')).toBe(true);

    await showLabel({ deleted: true, can_restore: true });
    expect(deleteButton().hidden).toBe(true);
    expect(restoreButton().hidden).toBe(false);
  });

  test('without imagery Delete stays put but inert, with the reason on hover', async () => {
    const payload = meta();
    await card.detail.showLabel(payload, 'TestSource');
    panoManager.resolvePano(false);
    await flush();

    expect(deleteButton().hidden).toBe(false);
    expect(deleteButton().getAttribute('aria-disabled')).toBe('true');
    expect(deleteButton().getAttribute('data-ps-tooltip')).toBe('labelmap:no-imagery-edit-disabled');
    await deleteLabel();
    expect(window.ConfirmDialog.confirm).not.toHaveBeenCalled();
    expect(requests()).toEqual([]);
  });

  test('a deleted label locks validating and editing, with the reason on the controls', async () => {
    await showLabel({ can_edit: true, from_current_user: false, deleted: true, can_restore: true });
    expect(q('.label-detail__pano-overlay').hidden).toBe(true);
    expect(q('.label-detail__vote--agree').disabled).toBe(true);
    expect(q('.label-detail__comment-input').disabled).toBe(true);
    expect(card.classList.contains('label-detail--editable')).toBe(false);
    expect(q('.label-detail__tags-edit').getAttribute('aria-disabled')).toBe('true');
    expect(q('.label-detail__tags-edit').getAttribute('data-ps-tooltip')).toBe('labelmap:deleted-label-disabled');
  });

  test('a delete is confirmed first, then posted with the host\'s source, and the card stays open marked deleted', async () => {
    const payload = await showLabel();
    await deleteLabel();

    expect(window.ConfirmDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: 'labelmap:delete-label-confirm', danger: true,
    }));
    expect(requests()).toEqual(['DELETE /label/42?source=TestSource']);
    expect(payload.deleted).toBe(true);
    expect(card.classList.contains('label-detail--deleted')).toBe(true);
    expect(notice().hidden).toBe(false);
    expect(noticeText()).toBe('labelmap:you-deleted-label');
    expect(deleteButton().hidden).toBe(true);
    expect(restoreButton().hidden).toBe(false);
    expect(document.activeElement).toBe(restoreButton());
    expect(typeStatus().textContent).toBe('');
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ label_id: 42, deleted: true }));
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=LabelDetail_action=DeleteLabel_labelId=42');
  });

  test('an admin deleting someone else\'s label is told their Disagree goes with it, and the card shows it', async () => {
    await showLabel({ can_edit: true, from_current_user: false });
    await deleteLabel();
    expect(window.ConfirmDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: 'labelmap:delete-label-confirm-admin',
    }));
    expect(requests()).toEqual(['DELETE /label/42?source=TestSource']);
    // The Disagree the server filed with the delete is re-read rather than guessed at.
    expect(window.fetch).toHaveBeenCalledWith('/label/id/42', expect.anything());
    expect(q('.label-detail__vote--disagree .label-detail__vote-count').textContent).toBe('1');
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ deleted: true, user_validation: 'Disagree' }));
  });

  test('cancelling the confirm deletes nothing', async () => {
    confirmAnswer = false;
    await showLabel();
    await deleteLabel();
    expect(requests()).toEqual([]);
    expect(card.classList.contains('label-detail--deleted')).toBe(false);
    expect(deleteButton().hidden).toBe(false);
  });

  test('a failed delete leaves the label live and says so', async () => {
    nextStatus = 500;
    await showLabel();
    await deleteLabel();
    expect(card.classList.contains('label-detail--deleted')).toBe(false);
    expect(deleteButton().hidden).toBe(false);
    expect(restoreButton().hidden).toBe(true);
    expect(typeStatus().classList.contains('label-detail__edit-status--error')).toBe(true);
    expect(typeStatus().getAttribute('data-ps-tooltip')).toBe('labelmap:delete-label-failed');
    expect(onDelete).not.toHaveBeenCalled();
  });

  test('Restore undoes the delete and brings Delete back', async () => {
    const payload = await showLabel();
    await deleteLabel();
    pointerClick(restoreButton());
    await flush();

    expect(requests()).toEqual(['DELETE /label/42?source=TestSource', 'POST /label/42/restore']);
    expect(payload.deleted).toBe(false);
    expect(card.classList.contains('label-detail--deleted')).toBe(false);
    expect(notice().hidden).toBe(true);
    expect(deleteButton().hidden).toBe(false);
    expect(restoreButton().hidden).toBe(true);
    expect(onDelete).toHaveBeenLastCalledWith(expect.objectContaining({ label_id: 42, deleted: false }));
    expect(window.logWebpageActivity)
      .toHaveBeenCalledWith('Click_module=LabelDetail_action=RestoreLabel_undo=true_labelId=42');
  });

  test('Ctrl+Z presses Restore after a delete made here, and only then', async () => {
    // A label that was already deleted when it opened: the chord is the page's.
    await showLabel({ deleted: true, can_restore: true });
    pressCtrlZ();
    await flush();
    expect(requests()).toEqual([]);

    await showLabel();
    await deleteLabel();
    pressCtrlZ();
    await flush();
    expect(requests()).toEqual(['DELETE /label/42?source=TestSource', 'POST /label/42/restore']);
    expect(deleteButton().hidden).toBe(false);
    expect(window.logWebpageActivity)
      .toHaveBeenCalledWith('KeyboardShortcut_module=LabelDetail_action=RestoreLabel_undo=true_labelId=42');

    // Nothing left to undo.
    pressCtrlZ();
    await flush();
    expect(requests()).toHaveLength(2);
  });

  test('Ctrl+Z right after a delete presses Restore, not a type-change Undo still on screen', async () => {
    await showLabel();
    // A type-change status with its Undo, as #submitEdit leaves it.
    const typeUndo = document.createElement('button');
    typeUndo.className = 'label-detail__edit-status-action';
    const undoClick = jest.fn();
    typeUndo.addEventListener('click', undoClick);
    typeStatus().append('changed', typeUndo);

    await deleteLabel();
    expect(typeStatus().textContent).toBe('');
    pressCtrlZ();
    await flush();
    expect(undoClick).not.toHaveBeenCalled();
    expect(requests()).toEqual(['DELETE /label/42?source=TestSource', 'POST /label/42/restore']);
  });

  test('paging away while a delete is in flight still tells the host and logs it, without touching the new card', async () => {
    let finish;
    request.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ ok: true, status: 200, json: async () => ({ deleted: true, can_restore: true }) });
    }));
    const first = await showLabel({ label_id: 42 });
    deleteButton().click();
    await flush();
    const second = await showLabel({ label_id: 43 });
    finish();
    await flush();
    await flush();

    expect(first.deleted).toBe(true);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ label_id: 42, deleted: true }));
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=LabelDetail_action=DeleteLabel_labelId=42');
    expect(second.deleted).toBe(false);
    expect(card.classList.contains('label-detail--deleted')).toBe(false);
    expect(deleteButton().hidden).toBe(false);
  });

  test('a keyboard Restore hands focus to Delete', async () => {
    await showLabel();
    await deleteLabel();
    expect(document.activeElement).toBe(restoreButton());
    pressCtrlZ();
    await flush();
    expect(document.activeElement).toBe(deleteButton());
  });

  test('a delete that finds the label already deleted by an admin offers no Restore', async () => {
    await showLabel({});
    nextBody = { deleted: true, can_restore: false };
    await deleteLabel();
    expect(card.classList.contains('label-detail--deleted')).toBe(true);
    expect(restoreButton().hidden).toBe(true);
    expect(onDelete).toHaveBeenLastCalledWith(expect.objectContaining({ deleted: true, can_restore: false }));
  });

  test('a restore from a card opened on an already-deleted label is not an undo', async () => {
    await showLabel({ deleted: true, can_restore: true });
    pointerClick(restoreButton());
    await flush();
    expect(requests()).toEqual(['POST /label/42/restore']);
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=LabelDetail_action=RestoreLabel_labelId=42');
  });
});
