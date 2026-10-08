/**
 * Tests for the label card's open event (frontend/js/common/label-detail/LabelDetail.js, #5139).
 *
 * Every public showLabel() call logs `LabelDetail_Show_labelId=<id>_source=<source>`, the one signal of how often
 * the card is opened, from which host. What is pinned here is what counts as an open: the meta path and the id path
 * alike, logged before the fetch (so an open whose label 404s still counts), and paging or reopening the same label
 * counts again — while the redraw the card does after a vote or comment the server refused with a 409 (the label's
 * type changed under it) is not an open and must not add a row. That redraw still has to run through a LabelPopup
 * host's showLabel wrapper, whose onMetadata is how LabelMap learns the new type, so it is checked through one.
 *
 * Fixture and stub strategy follow labelDetailKeyboard.test.js: LabelDetail is a top-level `class` written for
 * Grunt concatenation, so its source is eval'd into the jsdom global with an epilogue exposing it, TagEditor rides
 * along because LabelDetail closes over that binding, and the collaborators it reaches for as bare globals are
 * stubbed on `window` first.
 */

const { assetPathStub, installDateHelpers, loadModules } = require('./loadGlobalScript');

/**
 * Builds the card markup as views/common/labelDetail.scala.html renders it, reduced to the elements
 * #cacheElements() dereferences (several of them unguarded) plus the controls these tests drive.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.paging=true] - Render the prev/next arrows, which the template emits only for a host that
 *     asked for them (`withPaging`).
 * @param {boolean} [opts.asDialog=false] - Mount the card in a <dialog>, the way LabelPopup's hosts do, rather
 *     than in the <div> the Gallery and the share page use.
 * @returns {HTMLElement} The card root, mounted in the document.
 */
function buildCard({ paging = true, asDialog = false } = {}) {
    const tag = asDialog ? 'dialog' : 'div';
    const arrows = paging
        ? `<button type="button" class="label-detail__paging label-detail__paging--prev" aria-label="Previous label"></button>
           <button type="button" class="label-detail__paging label-detail__paging--next" aria-label="Next label"></button>`
        : '';
    document.body.innerHTML = `
      <button type="button" id="outside">Somewhere else on the page</button>
      <${tag} id="card" class="label-detail">
        <header class="label-detail__header">
          <h2 class="label-detail__title"></h2>
          <span class="label-detail__own-badge" role="img" hidden></span>
        </header>

        <div class="label-detail__pano-wrap">
          ${arrows}
          <div class="label-detail__pano"></div>
          <button type="button" class="label-detail__hide-label"></button>
          <div class="label-detail__pano-overlay" role="group">
            <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--agree" data-action="validate" data-result="Agree" aria-pressed="false">Agree</button>
            <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--disagree" data-action="validate" data-result="Disagree" aria-pressed="false">Disagree</button>
            <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--unsure" data-action="validate" data-result="Unsure" aria-pressed="false">Unsure</button>
          </div>
          <span class="label-detail__pan-hint" hidden></span>
        </div>

        <div class="label-detail__meta-row">
          <div class="label-detail__meta-cell">
            <span><span class="label-detail__labeled-word">Labeled</span>:</span>
            <span class="label-detail__timestamp label-detail__meta-value"></span>
          </div>
          <div class="label-detail__meta-cell">
            <span class="label-detail__image-capture-date label-detail__meta-value"></span>
          </div>
          <span class="label-detail__meta-divider label-detail__meta-divider--address" aria-hidden="true" hidden></span>
          <div class="label-detail__meta-cell label-detail__meta-cell--address" hidden>
            <a class="label-detail__address label-detail__meta-value"></a>
          </div>
          <button type="button" class="label-detail__meta-cell label-detail__meta-cell--details">
            <span class="label-detail__info-button-host"></span>
          </button>
        </div>

        <div class="label-detail__columns">
          <section class="label-detail__col label-detail__col--validations">
            <div class="label-detail__vote-display">
              <button type="button" class="label-detail__vote label-detail__vote--agree" aria-pressed="false">
                <span class="label-detail__vote-top">
                  <img alt="" class="label-detail__vote-icon">
                  <span class="label-detail__vote-count">0</span>
                </span>
              </button>
              <button type="button" class="label-detail__vote label-detail__vote--disagree" aria-pressed="false">
                <span class="label-detail__vote-top">
                  <img alt="" class="label-detail__vote-icon">
                  <span class="label-detail__vote-count">0</span>
                </span>
              </button>
              <button type="button" class="label-detail__vote label-detail__vote--unsure" aria-pressed="false">
                <span class="label-detail__vote-top">
                  <img alt="" class="label-detail__vote-icon">
                  <span class="label-detail__vote-count">0</span>
                </span>
              </button>
            </div>
          </section>

          <section class="label-detail__col label-detail__col--severity">
            <div class="label-detail__col-header">
              <h3 class="label-detail__col-title label-detail__severity-title">Severity</h3>
              <span class="label-detail__edit-status" role="status" aria-live="polite"></span>
            </div>
            <div class="label-detail__severity-faces" role="group" aria-label="Severity">
              <button type="button" class="severity-button severity-button--static" data-severity="1" aria-disabled="true" aria-pressed="false" tabindex="-1">
                <img alt="" class="severity-button__icon">
                <span class="severity-button__label">Low</span>
              </button>
              <button type="button" class="severity-button severity-button--static" data-severity="2" aria-disabled="true" aria-pressed="false" tabindex="-1">
                <img alt="" class="severity-button__icon">
                <span class="severity-button__label">Medium</span>
              </button>
              <button type="button" class="severity-button severity-button--static" data-severity="3" aria-disabled="true" aria-pressed="false" tabindex="-1">
                <img alt="" class="severity-button__icon">
                <span class="severity-button__label">High</span>
              </button>
            </div>
          </section>

          <section class="label-detail__col label-detail__col--tags">
            <div class="label-detail__col-header">
              <h3 class="label-detail__col-title label-detail__tags-title">Tags</h3>
              <button type="button" class="label-detail__tags-edit" hidden aria-expanded="false">Edit</button>
              <span class="label-detail__edit-status" role="status" aria-live="polite"></span>
            </div>
            <div class="label-detail__tags"></div>
          </section>
        </div>

        <div class="label-detail__desc-comments">
          <section class="label-detail__description-section">
            <div class="label-detail__description"></div>
          </section>
          <section class="label-detail__comments-section">
            <h3 class="label-detail__col-title label-detail__comments-title" tabindex="-1">
              <span class="label-detail__comments-count" hidden></span>
            </h3>
            <div class="label-detail__comment-row">
              <label class="sr-only" for="label-detail-comment-input">Why?</label>
              <input type="text" id="label-detail-comment-input" class="label-detail__comment-input">
              <button type="button" class="label-detail__comment-submit" data-action="submit-comment">Comment</button>
              <button type="button" class="label-detail__comment-cancel" data-action="cancel-comment-edit" hidden>Cancel</button>
            </div>
            <span class="label-detail__comment-confirmation" role="status" aria-live="polite" hidden></span>
            <div class="label-detail__validator-comments"></div>
          </section>
        </div>

        <section class="label-detail__stories" hidden></section>
        <span class="label-detail__story-status sr-only" role="status" aria-live="polite"></span>

        <!-- The story composer and the photo lightbox are rendered inside the card, so a dialog that takes
             the keyboard from it is a sibling of everything above rather than a stranger elsewhere on the page. -->
        <dialog class="story-composer"><button type="button" id="composer-field">Post</button></dialog>

        <div class="label-detail__footer">
          <a class="label-detail__explore-link" hidden></a>
          <a class="label-detail__labelmap-link" hidden></a>
        </div>
      </${tag}>`;
    return document.getElementById('card');
}

/** A deferred promise, so a test decides when this label's imagery resolves. */
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/**
 * Label metadata in the shape `/label/id/:id` serves.
 *
 * @param {Object} [overrides] - Fields to change.
 * @returns {Object}
 */
function meta(overrides = {}) {
    return {
        label_id: 42,
        label_type: 'Obstacle',
        severity: 2,
        tags: [],
        can_edit: false,
        from_current_user: false,
        description: '',
        pano_id: 'pano-1',
        lat: 47.61,
        lng: -122.33,
        camera_lat: 47.615,
        camera_lng: -122.335,
        heading: 250.5,
        pitch: -12,
        zoom: 2,
        canvas_x: 100,
        canvas_y: 200,
        street_edge_id: 7,
        region_id: 3,
        timestamp: '2026-08-01T12:00:00Z',
        image_capture_date: '2025-06-01',
        num_agree: 0,
        num_disagree: 0,
        num_unsure: 0,
        user_validation: null,
        ai_validation: null,
        comments: [],
        ...overrides,
    };
}

describe('the label card\'s open event (#5139)', () => {
    let card;
    let panoManager;
    let setPano;
    /** Every POST the card makes: validations and comments go through util.lazyIdentityFetch, not window.fetch. */
    let post;

    /** Drains the microtask queue that the card's promise chains spread work across. */
    const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

    const q = (sel) => card.querySelector(sel);

    /** The open events logged so far, oldest first. */
    const showEvents = () => window.logWebpageActivity.mock.calls
        .map(([activity]) => activity)
        .filter((activity) => activity.startsWith('LabelDetail_Show_'));

    /** Answers `/label/id/:id` with that label's metadata. */
    const labelFetch = (url) => {
        const id = Number(String(url).split('/').pop());
        return Promise.resolve({ ok: true, status: 200, json: async () => meta({ label_id: id }) });
    };

    /** Shows a label from a meta object and settles its imagery, which is what unlocks the card's controls. */
    async function showMeta(overrides) {
        const payload = meta(overrides);
        await card.detail.showLabel(payload, 'TestSource');
        setPano.resolve(true);
        await setPano.promise;
        await flush();
        return payload;
    }

    beforeEach(async () => {
        jest.resetModules();
        post = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));

        window.i18next = { t: (key) => key };
        window.logWebpageActivity = jest.fn();
        window.alert = jest.fn();
        window.buildBackupImageData = () => null;
        window.camelToKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        window.util = {
            assetPath: assetPathStub,
            EXPLORE_CANVAS_WIDTH: 720,
            EXPLORE_CANVAS_HEIGHT: 480,
            isMobile: () => false,
            lazyIdentityFetch: post,
            misc: {
                labelTypeName: (type) => window.i18next.t(`common:${window.camelToKebab(type)}`),
                getRatingLevelKeys: () => ({ 1: 'low', 2: 'medium', 3: 'high' }),
                getSmileyIconPath: (sev, type, selected) => `${type}-${sev}-${selected}.svg`,
                isPositiveLabelType: () => false,
                labelTypeHasSeverity: () => true,
            },
            pano: { centeredPovToCanvasCoord: () => ({ x: 0, y: 0 }), renderedHFov: () => 90 },
            url: { replaceQuery: () => {} },
        };
        installDateHelpers();
        window.BadgeAchievements = { seedCounts: () => {}, recordValidation: () => {} };
        window.Toast = { show: jest.fn() };
        window.LabelVisibilityToggle = class { constructor() {} };
        window.PanoInfoPopover = class { constructor() {} };

        // Every label's imagery resolves at once unless a test swaps the deferred out first.
        setPano = deferred();
        panoManager = {
            clearLabels: jest.fn(),
            setLabel: jest.fn(),
            setLabelsHidden: jest.fn(),
            setPano: jest.fn(() => setPano.promise),
            warmUp: jest.fn(),
            activeViewerName: 'Default',
            panoViewer: {
                currPanoData: null,
                getPanoId: () => 'pano-1',
                getPosition: () => ({ lat: 47.61, lng: -122.33 }),
                getViewerType: () => 'gsv',
            },
            getPov: () => ({ heading: 250.5, pitch: -12, zoom: 2 }),
            getOriginalPosition: () => ({ heading: 250.5, pitch: -12 }),
            // Measured when a vote is submitted; jsdom lays nothing out.
            svHolder: Object.defineProperties(document.createElement('div'), {
                clientWidth: { value: 720 }, clientHeight: { value: 480 },
            }),
            label: { labelId: 42, label_type: 'Obstacle' },
        };
        window.PopupPanoManager = { create: async () => panoManager };
        // The stories disclosure is not what these tests exercise, and its real section wants the composer's markup.
        window.StorySection = class { setLabel() {} };

        window.fetch = jest.fn(labelFetch);

        Object.assign(window, loadModules('frontend/js/common/label-detail/TagEditor.js', 'frontend/js/common/label-detail/LabelDetail.js'));

        card = buildCard();
        card.detail = await window.LabelDetail.create(card, {
            admin: false,
            viewerType: 'Default',
            currUsername: 'tester',
            panoOverlaySource: 'test',
        });
    });

    test('a label shown from a meta object logs one open, and nothing else is logged', async () => {
        // The Gallery's expanded view hands the card the data it already holds, so no fetch is involved.
        await showMeta();

        expect(window.logWebpageActivity.mock.calls).toEqual([['LabelDetail_Show_labelId=42_source=TestSource']]);
        expect(window.fetch).not.toHaveBeenCalledWith('/label/id/42', expect.anything());
    });

    test('a label shown by id logs its open before the fetch resolves', async () => {
        let resolveFetch;
        window.fetch.mockImplementationOnce(() => new Promise((res) => { resolveFetch = res; }));

        const shown = card.detail.showLabel(7, 'LabelMap');

        expect(showEvents()).toEqual(['LabelDetail_Show_labelId=7_source=LabelMap']);
        resolveFetch({ ok: true, status: 200, json: async () => meta({ label_id: 7 }) });
        await shown;
        expect(showEvents()).toHaveLength(1);
    });

    test('paging from one label to the next logs an open for each, in order', async () => {
        await card.detail.showLabel(1, 'LabelMap');
        await card.detail.showLabel(2, 'LabelMap');

        expect(showEvents()).toEqual([
            'LabelDetail_Show_labelId=1_source=LabelMap',
            'LabelDetail_Show_labelId=2_source=LabelMap',
        ]);
    });

    test('showing the same label again counts again', async () => {
        // A close and reopen is a second look, so the event is not deduplicated by label.
        await card.detail.showLabel(5, 'AdminLabelMap');
        await card.detail.showLabel(5, 'AdminLabelMap');

        expect(showEvents()).toEqual([
            'LabelDetail_Show_labelId=5_source=AdminLabelMap',
            'LabelDetail_Show_labelId=5_source=AdminLabelMap',
        ]);
    });

    test('an open whose label fails to load is still counted', async () => {
        window.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }));

        await expect(card.detail.showLabel(999, 'SharedLabel')).rejects.toThrow('HTTP error 404');

        expect(window.alert).toHaveBeenCalledTimes(1);
        expect(showEvents()).toEqual(['LabelDetail_Show_labelId=999_source=SharedLabel']);
    });

    test('the redraw after a vote the server refused with a 409 is not another open', async () => {
        await showMeta();
        post.mockImplementationOnce(async () => ({ ok: false, status: 409, json: async () => ({}) }));

        q('.label-detail__pano-overlay-button--agree').click();
        await flush();
        await flush();

        // The redraw did happen (it refetched the label and said why), it just isn't counted.
        expect(window.fetch).toHaveBeenCalledWith('/label/id/42', expect.anything());
        expect(window.Toast.show).toHaveBeenCalled();
        expect(showEvents()).toEqual(['LabelDetail_Show_labelId=42_source=TestSource']);
    });

    test('the redraw after a comment the server refused with a 409 is not another open', async () => {
        await showMeta();
        post.mockImplementationOnce(async () => ({ ok: false, status: 409, json: async () => ({}) }));

        q('.label-detail__comment-input').value = 'Not an obstacle';
        q('.label-detail__comment-submit').click();
        await flush();
        await flush();

        expect(window.fetch).toHaveBeenCalledWith('/label/id/42', expect.anything());
        expect(showEvents()).toEqual(['LabelDetail_Show_labelId=42_source=TestSource']);
    });

    test('the 409 redraw still runs through a host\'s showLabel wrapper, and the next open is counted', async () => {
        // LabelPopup replaces showLabel on the instance with a wrapper whose onMetadata tells LabelMap the label's
        // new type, so the redraw must reach that wrapper rather than the card's own fetch-and-render.
        const inner = card.detail.showLabel;
        const wrapped = jest.fn((id, source) => inner(id, source));
        Object.assign(card.detail, { showLabel: wrapped });
        await card.detail.showLabel(42, 'LabelMap');
        setPano.resolve(true);
        await flush();
        post.mockImplementationOnce(async () => ({ ok: false, status: 409, json: async () => ({}) }));

        q('.label-detail__pano-overlay-button--agree').click();
        await flush();
        await flush();
        await card.detail.showLabel(43, 'LabelMap');

        expect(wrapped).toHaveBeenCalledTimes(3);
        // Re-shown with the source the label was opened with, not the overlay button's ('test'): a LabelPopup host
        // keeps whatever source the wrapper last saw for its paging arrows, and the card uses it for edits.
        expect(wrapped).toHaveBeenNthCalledWith(2, 42, 'LabelMap');
        expect(showEvents()).toEqual([
            'LabelDetail_Show_labelId=42_source=LabelMap',
            'LabelDetail_Show_labelId=43_source=LabelMap',
        ]);
    });

    test('a wrapper that throws during the 409 redraw does not swallow the next open', async () => {
        // The suppression flag is cleared in a finally, so a wrapper that fails before reaching the card's own
        // showLabel() can't leave it raised for whatever the user opens next.
        const inner = card.detail.showLabel;
        let failNext = false;
        const wrapped = jest.fn((id, source) => {
            if (failNext) {
                failNext = false;
                throw new Error('host wrapper failed');
            }
            return inner(id, source);
        });
        Object.assign(card.detail, { showLabel: wrapped });
        jest.spyOn(console, 'error').mockImplementation(() => {});
        await card.detail.showLabel(42, 'LabelMap');
        setPano.resolve(true);
        await flush();
        post.mockImplementationOnce(async () => ({ ok: false, status: 409, json: async () => ({}) }));

        failNext = true;
        q('.label-detail__pano-overlay-button--agree').click();
        await flush();
        await flush();
        await card.detail.showLabel(43, 'LabelMap');

        expect(wrapped).toHaveBeenCalledTimes(3);
        expect(showEvents()).toEqual([
            'LabelDetail_Show_labelId=42_source=LabelMap',
            'LabelDetail_Show_labelId=43_source=LabelMap',
        ]);
        console.error.mockRestore();
    });

    describe('through the real LabelPopup', () => {
        // The flag design depends on LabelPopup's wrapper reaching the card's own showLabel() before its first
        // await, and the deep link and paging arrows are opens that only LabelPopup makes, so these run the real
        // module over the real card rather than a stand-in.
        let popup;
        let dialog;
        const onMetadata = jest.fn();

        /** A navigator that always has somewhere to go: one id up or down. */
        const steppingNav = {
            next: (id) => id + 1,
            prev: (id) => id - 1,
            hasPrev: () => true,
            hasNext: () => true,
            onRefresh: () => {},
        };

        /** Builds the popup the way LabelMap does, optionally over a `?labelId=` deep link. */
        async function buildPopup({ deepLinkId = null } = {}) {
            dialog = buildCard({ asDialog: true });
            dialog.id = 'label-modal';
            dialog.insertAdjacentHTML('afterbegin', '<button type="button" data-action="close-label-detail"></button>');
            window.history.replaceState({}, '', deepLinkId ? `/labelMap?labelId=${deepLinkId}` : '/labelMap');
            window.logWebpageActivity.mockClear();
            Object.assign(window, loadModules('frontend/js/common/label-detail/LabelPopup.js'));
            popup = await window.LabelPopup(false, 'Default', null, 'tester', { syncUrlSource: 'LabelMap', onMetadata });
            card = dialog;
        }

        beforeEach(() => {
            onMetadata.mockClear();
            // jsdom has no modal dialog implementation.
            window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
            window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
        });

        afterEach(() => {
            window.history.replaceState({}, '', '/');
        });

        test('a ?labelId= deep link logs one open, with the host\'s source', async () => {
            await buildPopup({ deepLinkId: 7 });
            await flush();

            expect(showEvents()).toEqual(['LabelDetail_Show_labelId=7_source=LabelMap']);
        });

        test('each paging arrow press logs one open for the label it lands on', async () => {
            await buildPopup();
            popup.setNearbyNavigator(steppingNav);
            await popup.showLabel(10, 'LabelMap');

            q('.label-detail__paging--next').click();
            await flush();
            q('.label-detail__paging--prev').click();
            await flush();

            expect(showEvents()).toEqual([
                'LabelDetail_Show_labelId=10_source=LabelMap',
                'LabelDetail_Show_labelId=11_source=LabelMap',
                'LabelDetail_Show_labelId=10_source=LabelMap',
            ]);
        });

        test('the 409 redraw reaches the host\'s onMetadata with the new type, and is not counted', async () => {
            await buildPopup();
            popup.setNearbyNavigator(steppingNav);
            await popup.showLabel(42, 'LabelMap');
            setPano.resolve(true);
            await flush();
            // Someone changed the label's type elsewhere, so the vote is refused and the redraw sees the new type.
            window.fetch.mockImplementationOnce(() => Promise.resolve({
                ok: true, status: 200, json: async () => meta({ label_id: 42, label_type: 'CurbRamp' }),
            }));
            post.mockImplementationOnce(async () => ({ ok: false, status: 409, json: async () => ({}) }));

            q('.label-detail__pano-overlay-button--agree').click();
            await flush();
            await flush();
            q('.label-detail__paging--next').click();
            await flush();

            expect(onMetadata).toHaveBeenCalledWith(42, expect.objectContaining({ label_type: 'CurbRamp' }));
            expect(showEvents()).toEqual([
                'LabelDetail_Show_labelId=42_source=LabelMap',
                'LabelDetail_Show_labelId=43_source=LabelMap',
            ]);
        });
    });
});
