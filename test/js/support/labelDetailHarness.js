/**
 * Shared setup for the label card suites (#5840): the card's full markup as views/common/labelDetail.scala.html
 * renders it, a pano manager whose imagery a test settles by hand, and a fetch that answers only the routes a suite
 * names and fails the test on any other.
 *
 * The card's collaborators that want a real viewer or page (the pano manager, the info popover, the hide toggle, the
 * share widget, stories, badges, toasts, the confirm) are stand-ins that record what the card asked of them.
 */

import { loadModules, mockModule, useUtil } from '../loader.js';

/** What the stand-ins were handed; reset by each mountCard(). */
export const collaborators = {
  /** @type {?object} The options the Hide-label toggle was built with. */
  toggle: null,
  /** @type {?unknown[]} The PanoInfoPopover constructor's arguments. */
  infoPopover: null,
  /** @type {?{trigger: HTMLElement, targets: object[]}} */
  share: null,
  /** @type {?{opts: object, labels: unknown[][]}} */
  story: null,
  toast: vi.fn(),
  confirm: vi.fn(async () => true),
  recordValidation: vi.fn(),
};

mockModule('i18next', () => ({ default: { t: (key) => key, language: 'en' } }));
mockModule('frontend/js/common/BadgeAchievements.js', () => ({
  BadgeAchievements: { seedCounts() {}, recordValidation: (...args) => collaborators.recordValidation(...args) },
}));
mockModule('frontend/js/common/LabelVisibilityToggle.js', () => ({
  LabelVisibilityToggle: class {
    constructor(opts) { collaborators.toggle = opts; }
  },
}));
mockModule('frontend/js/common/label-detail/PopupPanoManager.js', () => ({
  PopupPanoManager: { create: async () => panoManager },
}));
mockModule('frontend/js/common/label-detail/StorySection.js', () => ({
  StorySection: class {
    constructor(root, opts) { collaborators.story = { opts, labels: [] }; }
    setLabel(...args) { collaborators.story.labels.push(args); }
  },
}));
mockModule('frontend/js/common/pano-viewer/PanoInfoPopover.js', () => ({
  PanoInfoPopover: class {
    // The real one appends its (i) trigger into the host span, which the card's Details chip forwards clicks to.
    constructor(host, ...rest) {
      collaborators.infoPopover = [host, ...rest];
      host.append(document.createElement('img'));
    }
  },
}));
mockModule('frontend/js/common/share/ShareWidget.js', () => ({
  ShareWidget: class {
    constructor(trigger) { collaborators.share = { trigger, targets: [] }; }
    setTarget(target) { collaborators.share.targets.push(target); }
  },
}));
mockModule('frontend/js/common/Toast.js', () => ({ Toast: { show: (opts) => collaborators.toast(opts) } }));
mockModule('frontend/js/common/ConfirmDialog.js', () => ({
  ConfirmDialog: { confirm: (opts) => collaborators.confirm(opts) },
}));

/** @type {?object} The current card's pano manager; see fakePanoManager(). */
let panoManager = null;

/** Requests no route answered, as `METHOD url`; mountCard() fails the test on any. */
let unexpected = [];

afterEach(() => {
  useUtil();
  expect(unexpected, 'requests the suite gave no route for').toEqual([]);
});

/**
 * The card markup the Twirl view renders, less the story composer and photo lightbox the card never touches.
 * @param {object} [opts]
 * @param {boolean} [opts.admin=false] - Include the admin details block.
 * @param {boolean} [opts.withPaging=false] - Include the prev/next arrows.
 * @param {boolean} [opts.typePicker=true] - Include the type picker's popover, which a page that doesn't load the
 *   picker leaves out.
 * @returns {string}
 */
export function cardMarkup({ admin = false, withPaging = false, typePicker = true } = {}) {
  const votes = ['agree', 'disagree', 'unsure'];
  return `
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
        <button type="button" class="label-detail__delete" hidden></button>
        <span class="label-detail__own-badge" role="img" hidden></span>
        <span class="label-detail__edit-status label-detail__edit-status--type" role="status"></span>
      </div>
    </header>
    ${typePicker ? `<div class="label-type-popover" popover hidden>
      <p class="label-type-popover__hint" hidden></p>
      <div class="label-type-popover__chips"></div>
    </div>` : ''}
    <div class="label-detail__pano-wrap">
      ${withPaging ? '<button type="button" class="label-detail__paging label-detail__paging--prev"></button>' : ''}
      <div class="label-detail__pano"></div>
      <div class="label-detail__deleted-notice" role="status" hidden>
        <span class="label-detail__deleted-notice-text"></span>
        <button type="button" class="label-detail__restore" hidden></button>
      </div>
      <button type="button" class="label-detail__hide-label"></button>
      <div class="label-detail__pano-overlay" role="group">
        ${votes.map((v) => `<button type="button" class="label-detail__pano-overlay-button
          label-detail__pano-overlay-button--${v}" aria-pressed="false"></button>`).join('')}
      </div>
      ${withPaging ? '<button type="button" class="label-detail__paging label-detail__paging--next"></button>' : ''}
    </div>
    <div class="label-detail__meta-row">
      <div class="label-detail__meta-cell">
        <span><span class="label-detail__labeled-word"></span>:</span>
        <span class="label-detail__timestamp label-detail__meta-value"></span>
      </div>
      <div class="label-detail__meta-cell"><span class="label-detail__image-capture-date"></span></div>
      <span class="label-detail__meta-divider label-detail__meta-divider--address" hidden></span>
      <div class="label-detail__meta-cell label-detail__meta-cell--address" hidden>
        <a class="label-detail__address label-detail__meta-value"></a>
      </div>
      <button type="button" class="label-detail__meta-cell label-detail__meta-cell--details">
        <span class="label-detail__details-word">Details</span><span class="label-detail__info-button-host"></span>
      </button>
    </div>
    <div class="label-detail__columns">
      <section class="label-detail__col label-detail__col--validations">
        <div class="label-detail__vote-display">
          ${votes.map((v) => `
            <button type="button" class="label-detail__vote label-detail__vote--${v}" aria-pressed="false">
              <img alt="" class="label-detail__vote-icon"><span class="label-detail__vote-count">0</span>
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
        <h3 class="label-detail__col-title label-detail__comments-title" tabindex="-1">
          <span class="label-detail__comments-count" hidden></span>
        </h3>
        <div class="label-detail__comment-row">
          <label class="sr-only" for="label-detail-comment-input"></label>
          <input type="text" id="label-detail-comment-input" class="label-detail__comment-input">
          <button type="button" class="label-detail__comment-submit"></button>
          <button type="button" class="label-detail__comment-cancel" hidden></button>
        </div>
        <span class="label-detail__comment-confirmation" role="status" hidden></span>
        <div class="label-detail__validator-comments"></div>
      </section>
    </div>
    <section class="label-detail__stories" hidden></section>
    <div class="label-detail__footer">
      <a class="label-detail__explore-link" hidden></a>
      <a class="label-detail__labelmap-link" hidden></a>
      <div class="label-detail__share"><button type="button" class="label-detail__share-trigger"></button></div>
    </div>
    ${admin ? `
      <dl>
        <dd class="label-detail__admin-username"></dd>
        <dd class="label-detail__admin-task"></dd>
        <dd class="label-detail__admin-prev-validations"></dd>
      </dl>
      <div class="label-detail__flag-buttons">
        ${['low_quality', 'incomplete', 'stale'].map((f) => `
          <button type="button" class="label-detail__flag-button" data-flag="${f}"></button>`).join('')}
      </div>` : ''}`;
}

/**
 * Label metadata in the shape `/label/id/:id` serves: someone else's live Obstacle the viewer hasn't voted on.
 * @param {object} [overrides]
 * @returns {Record<string, any>}
 */
export function labelMeta(overrides = {}) {
  return {
    label_id: 42, label_type: 'Obstacle', severity: 2, tags: ['pole'], can_edit: false, from_current_user: false,
    deleted: false, can_restore: false, description: '', pano_id: 'pano-1', lat: 47.61, lng: -122.33,
    camera_lat: 47.615, camera_lng: -122.335, heading: 250.5, pitch: -12, zoom: 2, canvas_x: 100, canvas_y: 200,
    canvas_width: 720, canvas_height: 480, street_edge_id: 7, region_id: 3, audit_task_id: 900,
    timestamp: '2026-08-01T12:00:00Z', image_capture_date: '2025-06-01', num_agree: 1, num_disagree: 0,
    num_unsure: 0, user_validation: null, ai_validation: null, comments: [], ...overrides,
  };
}

/**
 * A pano manager whose setPano() waits for the test: resolvePano(shown) or rejectPano(err) settles the latest one.
 * @returns {object}
 */
function fakePanoManager() {
  let pending = null;
  const manager = {
    label: null,
    activeViewerName: 'Default',
    panoViewer: {
      currPanoData: null,
      getViewerType: () => 'gsv',
      getPanoId: () => 'pano-1',
      getPosition: () => ({ lat: 47.6, lng: -122.3 }),
      publicViewerLink: vi.fn(() => ({ url: 'https://maps.example/pano-1', i18nKey: 'common:view-in-gsv' })),
    },
    svHolder: Object.defineProperties(document.createElement('div'), {
      clientWidth: { value: 720 }, clientHeight: { value: 480 },
    }),
    clearLabels: vi.fn(),
    warmUp: vi.fn(),
    setLabel: vi.fn((label) => { manager.label = label; }),
    setLabelType: vi.fn(),
    setLabelsHidden: vi.fn(),
    getPov: () => ({ heading: 250.5, pitch: -12, zoom: 2 }),
    getOriginalPosition: () => ({ heading: 250.5, pitch: -12 }),
    setPano: vi.fn(() => new Promise((resolve, reject) => { pending = { resolve, reject }; })),
    resolvePano: (shown) => pending.resolve(shown),
    rejectPano: (err) => pending.reject(err),
  };
  return manager;
}

/**
 * A fetch reply: a body for a 200, `{status, body}` for anything else, an Error to reject, or a function of
 * (url, opts) returning one of those.
 * @typedef {any} Route
 */

/**
 * Answers a request from the routes, keyed `METHOD /path` with the query string dropped.
 * @param {Record<string, Route>} routes
 * @returns {Function} The fetch stub.
 */
function routedFetch(routes) {
  return vi.fn(async (url, opts = {}) => {
    const key = `${opts.method ?? 'GET'} ${String(url).split('?')[0]}`;
    if (!Object.hasOwn(routes, key)) {
      unexpected.push(key);
      return { ok: false, status: 599, json: async () => ({}) };
    }
    let reply = routes[key];
    if (typeof reply === 'function') reply = await reply(url, opts);
    if (reply instanceof Error) throw reply;
    const { status, body } = reply && Number.isInteger(reply.status) ? reply : { status: 200, body: reply };
    return { ok: status < 400, status, json: async () => body };
  });
}

/**
 * Mounts a fresh card and builds its LabelDetail.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.admin=false]
 * @param {boolean} [opts.withPaging=false]
 * @param {boolean} [opts.typePicker=true]
 * @param {Record<string, Route>} [opts.routes] - What each request answers; `routes` on the result may be changed
 *   later. The tag list is answered empty unless named.
 * @param {object} [opts.options] - LabelDetail constructor options on top of the defaults.
 * @returns {Promise<object>} `{card, detail, LabelDetail, panoManager, fetch, routes, q, show}`, where
 *   show(overrides, shown = true) shows a label and settles its imagery.
 */
export async function mountCard({
  admin = false, withPaging = false, typePicker = true, routes = {}, options = {},
} = {}) {
  unexpected = [];
  Object.assign(collaborators, { toggle: null, infoPopover: null, share: null, story: null });
  collaborators.toast.mockReset();
  collaborators.confirm.mockReset().mockResolvedValue(true);
  collaborators.recordValidation.mockReset();
  window.logWebpageActivity = vi.fn();

  document.body.innerHTML = `<div id="card" class="label-detail">${cardMarkup({ admin, withPaging, typePicker })}</div>`;
  const card = document.getElementById('card');
  panoManager = fakePanoManager();
  const allRoutes = { 'GET /label/tags': [], ...routes };
  const fetch = routedFetch(allRoutes);
  window.fetch = fetch;

  const { LabelDetail } = await loadModules('frontend/js/common/label-detail/LabelDetail.js');
  const detail = await LabelDetail.create(card, {
    admin, viewerType: 'Default', currUsername: 'tester', panoOverlaySource: 'Overlay', voteColumnSource: 'Column',
    ...options,
  });
  const manager = panoManager;

  /** Shows a label and, unless `shown` is null, settles its imagery. */
  async function show(overrides = {}, shown = true) {
    const meta = labelMeta(overrides);
    await detail.showLabel(meta, 'TestSource');
    if (shown !== null) {
      manager.resolvePano(shown);
      await flush();
    }
    return meta;
  }

  return {
    card, detail, LabelDetail, panoManager: manager, fetch, routes: allRoutes, show,
    q: (sel) => card.querySelector(sel),
  };
}

/** Lets pending promise callbacks and zero-delay timers run. */
export const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** @returns {string[]} The events logged so far. */
export const logged = () => window.logWebpageActivity.mock.calls.map(([event]) => event);

/** Clicks like a pointer does; jsdom's el.click() says `detail` 0, which the card reads as the keyboard. */
export const pointerClick = (el) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
