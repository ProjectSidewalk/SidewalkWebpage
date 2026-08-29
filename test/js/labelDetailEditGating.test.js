/**
 * Tests for the label card's edit gating (public/js/common/label-detail/LabelDetail.js, issue #5047).
 *
 * Two behaviors ride on the same render pass, so they are pinned together here.
 *
 * The Tags control names what it will do: "Add" over an untagged label, whose read-only list reads "None" and so
 * offers nothing to edit; "Edit" over one that has tags; "Done" while the editor is open. The visible word stays
 * terse because it sits inline beside the "Tags" heading, so the noun rides an aria-label; a card can show two
 * bare "Edit" buttons (this one and a story's), which is the ambiguity WCAG 2.4.6 is about.
 *
 * Severity and tags are gated on `can_edit` *and* imagery: with nothing on screen to judge the label by, nobody
 * rates it or picks tags for it — labeler and admin alike, the same state that blocks validating and commenting.
 *
 * The two locks deliberately do not line up, and the tests below hold that line:
 *   - Your own label blocks validating but NOT editing (you are its labeler), so the edit lock is not #locked.
 *   - The transient "pano still loading" window is a click-time guard only, never rendered, because dimming the
 *     controls for the moment a pano takes to load would flicker them on every page-through.
 *   - Neither control takes the `disabled` attribute: a natively disabled element swallows the hover that opens
 *     its tooltip, so both are aria-disabled, and a face that has a reason to give stays focusable.
 *
 * LabelDetail is a top-level `class` declaration written for the Grunt-concatenation world, so (like
 * labelDetailSubmissionContext.test.js) the source is eval'd into the jsdom global scope with an epilogue that
 * exposes it. TagEditor is eval'd in the same string because LabelDetail closes over that binding. Unlike that
 * file, these tests need a real instance, so the collaborators LabelDetail reaches for as bare globals are stubbed
 * on `window` first — including the pano manager, whose setPano() promise is the switch every imagery case turns.
 */

const fs = require('fs');
const path = require('path');

const readSrc = (rel) => fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
const LABEL_DETAIL_SRC = readSrc('public/js/common/label-detail/LabelDetail.js');
const TAG_EDITOR_SRC = readSrc('public/js/common/label-detail/TagEditor.js');
/** The shipped English copy, so the wording tests read the strings a user sees rather than the keys. */
const EN_LABELMAP = JSON.parse(readSrc('public/locales/en/labelmap.json'));

/** The tag list `/label/tags` serves, filtered to the type these tests use. */
const TAG_CATALOG = [
    { label_type: 'Obstacle', tag: 'pole', mutually_exclusive_with: null },
    { label_type: 'Obstacle', tag: 'trash can', mutually_exclusive_with: null },
];

/**
 * Builds the card markup as views/common/labelDetail.scala.html renders it for a non-admin host. Every element
 * #cacheElements() looks up is present — LabelDetail dereferences several of them unguarded — but the parts these
 * tests do not assert on are reduced to the tags and attributes the controller actually touches.
 *
 * @returns {HTMLElement} The card root, mounted in the document.
 */
function buildCard() {
    document.body.innerHTML = `
      <div id="card" class="label-detail">
        <header class="label-detail__header">
          <h2 class="label-detail__title"></h2>
          <span class="label-detail__own-badge" role="img" hidden></span>
        </header>

        <div class="label-detail__pano-wrap">
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
            <span><span class="label-detail__labeled-word" data-i18n="common:labeled">Labeled</span>:</span>
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
            <div class="label-detail__vote-display" data-icon-base="/assets/images/icons/validation/">
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
              <h3 class="label-detail__col-title label-detail__tags-title" data-i18n="common:tags">Tags</h3>
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
            <h3 class="label-detail__col-title label-detail__comments-title">
              <span class="label-detail__comments-count" hidden></span>
            </h3>
            <div class="label-detail__comment-row">
              <label class="sr-only" for="label-detail-comment-input">Why?</label>
              <input type="text" id="label-detail-comment-input" class="label-detail__comment-input">
              <button type="button" class="label-detail__comment-submit" data-action="submit-comment">Comment</button>
              <span class="label-detail__comment-confirmation" role="status" aria-live="polite" hidden></span>
            </div>
            <div class="label-detail__validator-comments"></div>
          </section>
        </div>

        <section class="label-detail__stories" hidden></section>
        <span class="label-detail__story-status sr-only" role="status" aria-live="polite"></span>

        <div class="label-detail__footer">
          <a class="label-detail__explore-link" hidden></a>
          <a class="label-detail__labelmap-link" hidden></a>
        </div>
      </div>`;
    return document.getElementById('card');
}

/** A deferred promise, so a test decides when — and how — this label's imagery resolves. */
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/**
 * Label metadata in the shape `/label/id/:id` serves. `can_edit` is the server's answer about this viewer (the
 * labeler or an admin, #2575); `from_current_user` is what blocks validating.
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
        can_edit: true,
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

describe('LabelDetail edit gating (#5047)', () => {
    let LabelDetail;
    let card;
    let panoManager;
    let setPano;
    /** Every save the card makes: #saveEdit posts through util.lazyIdentityFetch, not window.fetch. */
    let saveRequest;

    /** Drains the microtask queue, which #submitEdit's serializing promise chain spreads a save across. */
    const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

    /** Shows a label and waits for the synchronous half of #handleData() to finish. */
    async function showLabel(overrides) {
        const payload = meta(overrides);
        await card.detail.showLabel(payload, 'TestSource');
        return payload;
    }

    /** Settles this label's imagery and lets the setPano() continuation run. */
    async function resolveImagery(imageShown) {
        setPano.resolve(imageShown);
        await setPano.promise;
        await flush();
    }

    /** The bodies of the label edits posted so far, newest last. */
    const savedEdits = () => saveRequest.mock.calls
        .filter(([url]) => url === '/label/edit')
        .map(([, opts]) => JSON.parse(opts.body));

    const q = (sel) => card.querySelector(sel);
    const faces = () => [...card.querySelectorAll('.severity-button')];
    const tagsEdit = () => q('.label-detail__tags-edit');
    const status = (col) => q(`.label-detail__col--${col} .label-detail__edit-status`);

    beforeEach(async () => {
        jest.resetModules();
        card = buildCard();

        // /label/edit echoes the saved row back; the card renders the response rather than its optimistic guess,
        // since the server may drop tags that aren't valid for the label type.
        saveRequest = jest.fn(async (url, opts) => {
            const body = JSON.parse(opts.body);
            return { ok: true, status: 200, json: async () => ({ severity: body.severity, tags: body.tags }) };
        });

        // i18next echoes its key so assertions can name the key they expect rather than an English string that
        // translation churn would break.
        window.i18next = { t: (key) => key };
        window.moment = () => ({ format: () => '' });
        window.logWebpageActivity = jest.fn();
        window.camelToKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        window.buildBackupImageData = () => null;
        window.util = {
            EXPLORE_CANVAS_WIDTH: 720,
            EXPLORE_CANVAS_HEIGHT: 480,
            isMobile: () => false,
            lazyIdentityFetch: saveRequest,
            misc: {
                getRatingLevelKeys: () => ({ 1: 'low', 2: 'medium', 3: 'high' }),
                getSmileyIconPath: (sev, type, selected) => `${type}-${sev}-${selected}.svg`,
                isPositiveLabelType: () => false,
                labelTypeHasSeverity: () => true,
            },
            pano: { centeredPovToCanvasCoord: () => ({ x: 0, y: 0 }) },
            url: { replaceQuery: () => {} },
        };
        window.BadgeAchievements = { seedCounts: () => {}, recordValidation: () => {} };
        window.LabelVisibilityToggle = class { constructor() {} };
        window.PanoInfoPopover = class { constructor() {} };

        setPano = deferred();
        panoManager = {
            clearLabels: jest.fn(),
            setLabel: jest.fn(),
            setLabelsHidden: jest.fn(),
            setPano: jest.fn(() => setPano.promise),
            activeViewerName: 'Default',
            panoViewer: { currPanoData: null },
            svHolder: [document.createElement('div')],
        };
        window.PopupPanoManager = { create: async () => panoManager };

        // TagEditor fetches the city's tag catalog on first open; nothing else here goes to the network, so an
        // unexpected call shows up as an unmatched URL rather than a silent pass.
        window.fetch = jest.fn((url) => {
            if (String(url).includes('/label/tags')) {
                return Promise.resolve({ ok: true, json: async () => TAG_CATALOG });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        window.eval(`${TAG_EDITOR_SRC}\n${LABEL_DETAIL_SRC}\nwindow.LabelDetail = LabelDetail;`);
        LabelDetail = window.LabelDetail;

        card.detail = await LabelDetail.create(card, {
            admin: false,
            viewerType: 'Default',
            currUsername: 'tester',
            panoOverlaySource: 'test',
            voteColumnSource: 'test',
        });
    });

    describe('the Tags control names what it will do', () => {
        test('reads "Add" over a label with no tags', async () => {
            // The read-only list under an untagged label reads "None": there is nothing there to edit yet (#5047).
            await showLabel({ tags: [] });
            await resolveImagery(true);

            expect(tagsEdit().textContent).toBe('labelmap:add-tags');
            expect(tagsEdit().getAttribute('aria-label')).toBe('labelmap:add-tags-label');
        });

        test('reads "Edit" over a label that has tags', async () => {
            await showLabel({ tags: ['pole'] });
            await resolveImagery(true);

            expect(tagsEdit().textContent).toBe('labelmap:edit-tags');
            expect(tagsEdit().getAttribute('aria-label')).toBe('labelmap:edit-tags-label');
        });

        test('reads "Done" while the editor is open, and says so via aria-expanded', async () => {
            await showLabel({ tags: ['pole'] });
            await resolveImagery(true);

            tagsEdit().click();
            await flush();

            expect(tagsEdit().textContent).toBe('labelmap:done-editing-tags');
            expect(tagsEdit().getAttribute('aria-label')).toBe('labelmap:done-editing-tags-label');
            expect(tagsEdit().getAttribute('aria-expanded')).toBe('true');
        });

        test('the English copy keeps the noun out of the visible word and in the accessible name', () => {
            // Two bare "Edit" buttons can share a card (this one and a story's), so the noun rides the aria-label
            // while the visible word stays terse beside the "Tags" heading. Asserted against the shipped strings,
            // since it is a claim about the copy rather than about which key is read.
            for (const key of ['add-tags', 'edit-tags', 'done-editing-tags']) {
                expect(EN_LABELMAP[key]).toBeDefined();
                expect(EN_LABELMAP[`${key}-label`]).toBeDefined();
                expect(EN_LABELMAP[key]).not.toMatch(/tag/i);
                expect(EN_LABELMAP[`${key}-label`]).toMatch(/tags/i);
            }
        });

        test('paging from a tagged label to an untagged one flips Edit back to Add', async () => {
            await showLabel({ tags: ['pole'] });
            await resolveImagery(true);
            expect(tagsEdit().textContent).toBe('labelmap:edit-tags');

            setPano = deferred();
            panoManager.setPano.mockImplementation(() => setPano.promise);
            await showLabel({ label_id: 43, tags: [] });
            await resolveImagery(true);

            expect(tagsEdit().textContent).toBe('labelmap:add-tags');
        });
    });

    describe('with imagery, a viewer who may edit gets live controls', () => {
        test('the faces and the Tags control are live, with no lock tooltip', async () => {
            await showLabel();
            await resolveImagery(true);

            expect(card.classList.contains('label-detail--editable')).toBe(true);
            expect(tagsEdit().hidden).toBe(false);
            expect(tagsEdit().getAttribute('aria-disabled')).toBe('false');
            expect(tagsEdit().hasAttribute('data-ps-tooltip')).toBe(false);
            for (const face of faces()) {
                expect(face.hasAttribute('aria-disabled')).toBe(false);
                expect(face.hasAttribute('tabindex')).toBe(false);
                expect(face.hasAttribute('data-ps-tooltip')).toBe(false);
                expect(face.classList.contains('severity-button--static')).toBe(false);
            }
        });

        test('a face click saves that severity', async () => {
            await showLabel({ severity: 2 });
            await resolveImagery(true);

            faces()[2].click();
            await flush();

            expect(savedEdits()).toEqual([expect.objectContaining({ label_id: 42, severity: 3 })]);
            expect(faces()[2].getAttribute('aria-pressed')).toBe('true');
        });

        test('editing stays on for your own label, where validating is off', async () => {
            // The two locks do not line up: you cannot validate your own label, but re-rating it is the point —
            // you are its labeler. This is the case that keeps the edit lock out of #locked.
            await showLabel({ from_current_user: true, can_edit: true });
            await resolveImagery(true);

            expect(card.classList.contains('label-detail--readonly')).toBe(true);
            expect(card.classList.contains('label-detail--editable')).toBe(true);
            expect(tagsEdit().getAttribute('aria-disabled')).toBe('false');
            for (const face of faces()) expect(face.hasAttribute('aria-disabled')).toBe(false);
        });
    });

    describe('without imagery, rating and tagging go inert', () => {
        test('the Tags control stays visible and focusable, marked aria-disabled with the reason', async () => {
            await showLabel();
            await resolveImagery(false);

            expect(card.classList.contains('label-detail--editable')).toBe(false);
            // Still on screen and still not natively disabled — a disabled element swallows the hover that opens
            // the tooltip, and a hidden one could not explain itself at all.
            expect(tagsEdit().hidden).toBe(false);
            expect(tagsEdit().disabled).toBe(false);
            expect(tagsEdit().getAttribute('aria-disabled')).toBe('true');
            expect(tagsEdit().getAttribute('data-ps-tooltip')).toBe('labelmap:no-imagery-edit-disabled');
        });

        test('the faces keep their place in the tab order so the reason is reachable by keyboard', async () => {
            await showLabel();
            await resolveImagery(false);

            for (const face of faces()) {
                expect(face.disabled).toBe(false);
                expect(face.getAttribute('aria-disabled')).toBe('true');
                expect(face.hasAttribute('tabindex')).toBe(false);
                expect(face.getAttribute('data-ps-tooltip')).toBe('labelmap:no-imagery-edit-disabled');
                // The lock is the more useful thing to say than the face's own level, which reads like an offer.
                expect(face.title).toBe('');
            }
        });

        test('clicking a face saves nothing', async () => {
            await showLabel({ severity: 2 });
            await resolveImagery(false);

            faces()[2].click();
            await flush();

            expect(savedEdits()).toEqual([]);
        });

        test('clicking the Tags control does not open the editor', async () => {
            await showLabel();
            await resolveImagery(false);

            tagsEdit().click();
            await flush();

            expect(tagsEdit().getAttribute('aria-expanded')).toBe('false');
            expect(q('.label-detail__tags').querySelector('.tag-pill')).toBeNull();
        });

        test('an admin gets no exemption — the lock reads can_edit and nothing else', async () => {
            // `can_edit` is the one answer the card has about who may edit; it is true for an admin exactly as it
            // is for the labeler, and the lock consults nothing beside it. So there is no seam for an admin
            // exemption to live in, which is the decision this pins: nobody rates a label they cannot see.
            await showLabel({ can_edit: true, from_current_user: false });
            await resolveImagery(false);

            expect(card.classList.contains('label-detail--editable')).toBe(false);
            expect(tagsEdit().getAttribute('aria-disabled')).toBe('true');
            expect(savedEdits()).toEqual([]);
        });

        test('imagery that fails outright lands on the same lock', async () => {
            // setPano() resolves its own failures into the fallback chain, so a rejection means the pipeline broke.
            // The card lands on "no imagery" rather than staying locked on a load that will never finish.
            const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
            await showLabel();
            setPano.reject(new Error('pipeline broke'));
            await setPano.promise.catch(() => {});
            await Promise.resolve();
            await Promise.resolve();

            expect(card.classList.contains('label-detail--editable')).toBe(false);
            expect(tagsEdit().getAttribute('aria-disabled')).toBe('true');
            consoleError.mockRestore();
        });
    });

    describe('a viewer who may not edit is offered nothing to explain', () => {
        test('the Tags control is hidden and the faces are plain read-only', async () => {
            await showLabel({ can_edit: false });
            await resolveImagery(true);

            expect(tagsEdit().hidden).toBe(true);
            for (const face of faces()) {
                expect(face.getAttribute('aria-disabled')).toBe('true');
                // Out of the tab order, unlike the no-imagery case: there is no reason to go and hear.
                expect(face.getAttribute('tabindex')).toBe('-1');
                expect(face.hasAttribute('data-ps-tooltip')).toBe(false);
                expect(face.classList.contains('severity-button--static')).toBe(true);
            }
        });

        test('no imagery adds no tooltip for them either', async () => {
            // Severity and tags were never controls for this viewer, so naming a lock on them would be noise.
            await showLabel({ can_edit: false });
            await resolveImagery(false);

            expect(tagsEdit().hidden).toBe(true);
            for (const face of faces()) expect(face.hasAttribute('data-ps-tooltip')).toBe(false);
        });
    });

    describe('your own label says so in the wording, not just the chip', () => {
        test('the meta strip and both editable columns address the labeler', async () => {
            await showLabel({ from_current_user: true });
            await resolveImagery(true);

            expect(q('.label-detail__labeled-word').textContent).toBe('labelmap:you-labeled');
            expect(q('.label-detail__severity-title').textContent).toBe('labelmap:your-rating');
            expect(q('.label-detail__tags-title').textContent).toBe('labelmap:your-tags');
        });

        test('the rating heading names the viewer, not the label type', async () => {
            // Obstacle is a negative type, so someone else's label is headed "Severity"; the own-label heading
            // deliberately drops that distinction, which the faces and their level words still carry.
            await showLabel({ from_current_user: false, label_type: 'Obstacle' });
            await resolveImagery(true);
            expect(q('.label-detail__severity-title').textContent).toBe('common:severity');

            setPano = deferred();
            panoManager.setPano.mockImplementation(() => setPano.promise);
            await showLabel({ label_id: 44, from_current_user: true, label_type: 'Obstacle' });
            await resolveImagery(true);
            expect(q('.label-detail__severity-title').textContent).toBe('labelmap:your-rating');
        });

        test('someone else\'s label keeps the neutral wording', async () => {
            await showLabel({ from_current_user: false });
            await resolveImagery(true);

            expect(q('.label-detail__labeled-word').textContent).toBe('common:labeled');
            expect(q('.label-detail__tags-title').textContent).toBe('common:tags');
        });

        test('the wording reverts when paging from your own label to someone else\'s', async () => {
            await showLabel({ from_current_user: true });
            await resolveImagery(true);
            expect(q('.label-detail__labeled-word').textContent).toBe('labelmap:you-labeled');

            setPano = deferred();
            panoManager.setPano.mockImplementation(() => setPano.promise);
            await showLabel({ label_id: 45, from_current_user: false });
            await resolveImagery(true);

            expect(q('.label-detail__labeled-word').textContent).toBe('common:labeled');
            expect(q('.label-detail__tags-title').textContent).toBe('common:tags');
        });

        test('the validate overlay is gone rather than sitting greyed over the imagery', async () => {
            await showLabel({ from_current_user: true });
            await resolveImagery(true);

            expect(q('.label-detail__pano-overlay').hidden).toBe(true);
        });

        test('every other lock keeps the overlay, disabled, so it can explain itself', async () => {
            // No imagery is a state that passes — the buttons stay put and carry the reason. Only your own label,
            // which will never become validatable by you, loses them.
            await showLabel({ from_current_user: false });
            await resolveImagery(false);

            expect(q('.label-detail__pano-overlay').hidden).toBe(false);
            for (const btn of card.querySelectorAll('.label-detail__pano-overlay-button')) {
                expect(btn.disabled).toBe(true);
            }
        });
    });

    describe('an autosaved edit says so', () => {
        test('a rating change confirms in the rating column only', async () => {
            // Nothing was pressed and no dialog closed, so this line is the whole acknowledgement (#5047).
            await showLabel({ severity: 2, tags: [] });
            await resolveImagery(true);

            faces()[2].click();
            await flush();

            expect(status('severity').textContent).toBe('labelmap:edit-saved');
            expect(status('severity').classList.contains('label-detail__edit-status--error')).toBe(false);
            expect(status('tags').textContent).toBe('');
        });

        test('a tag change confirms in the tags column only', async () => {
            await showLabel({ severity: 2, tags: ['pole'] });
            await resolveImagery(true);

            tagsEdit().click();
            await flush();
            card.querySelector('.label-detail__tags .tag-pill:not(.tag-pill--active)').click();
            tagsEdit().click();
            await flush();

            expect(status('tags').textContent).toBe('labelmap:edit-saved');
            expect(status('severity').textContent).toBe('');
        });

        test('a failed save says so on the same column, styled as a failure', async () => {
            const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
            saveRequest.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
            await showLabel({ severity: 2 });
            await resolveImagery(true);

            faces()[2].click();
            await flush();

            expect(status('severity').textContent).toBe('labelmap:edit-failed');
            expect(status('severity').classList.contains('label-detail__edit-status--error')).toBe(true);
            consoleError.mockRestore();
        });

        test('a save that changes nothing stays quiet', async () => {
            // Re-picking the rating the label already has is not news; a "Saved" for it would be a lie about a
            // request that was never made.
            await showLabel({ severity: 3 });
            await resolveImagery(true);

            faces()[2].click();
            await flush();

            expect(savedEdits()).toEqual([]);
            expect(status('severity').textContent).toBe('');
        });

        test('a confirmation is held briefly, then faded rather than cut', async () => {
            // Timers are faked only after the save path is set up, so showLabel/resolveImagery keep real ones.
            await showLabel({ severity: 2 });
            await resolveImagery(true);
            jest.useFakeTimers();
            try {
                faces()[2].click();
                await jest.advanceTimersByTimeAsync(0);
                const el = status('severity');
                expect(el.textContent).toBe('labelmap:edit-saved');
                expect(el.classList.contains('label-detail__edit-status--fading')).toBe(false);

                // Still fully visible just before the hold is up, so the message can't flash past unread.
                await jest.advanceTimersByTimeAsync(900);
                expect(el.classList.contains('label-detail__edit-status--fading')).toBe(false);

                // Fading, but the text stays in the DOM until the fade finishes — taking live-region content away
                // within a beat of adding it can cost the screen-reader announcement.
                await jest.advanceTimersByTimeAsync(200);
                expect(el.classList.contains('label-detail__edit-status--fading')).toBe(true);
                expect(el.textContent).toBe('labelmap:edit-saved');

                await jest.advanceTimersByTimeAsync(500);
                expect(el.textContent).toBe('');
                expect(el.classList.contains('label-detail__edit-status--fading')).toBe(false);
            } finally {
                jest.useRealTimers();
            }
        });

        test('a failure is held far longer than a confirmation', async () => {
            // The failure line is the only place the rollback is explained, so it outlasts the point where a
            // "Saved" would already be gone.
            const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
            saveRequest.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
            await showLabel({ severity: 2 });
            await resolveImagery(true);
            jest.useFakeTimers();
            try {
                faces()[2].click();
                await jest.advanceTimersByTimeAsync(0);
                await jest.advanceTimersByTimeAsync(2000);

                expect(status('severity').textContent).toBe('labelmap:edit-failed');
                expect(status('severity').classList.contains('label-detail__edit-status--fading')).toBe(false);
            } finally {
                jest.useRealTimers();
                consoleError.mockRestore();
            }
        });

        test('paging to another label clears a confirmation left on screen', async () => {
            await showLabel({ severity: 2 });
            await resolveImagery(true);
            faces()[2].click();
            await flush();
            expect(status('severity').textContent).toBe('labelmap:edit-saved');

            setPano = deferred();
            panoManager.setPano.mockImplementation(() => setPano.promise);
            await showLabel({ label_id: 46 });

            expect(status('severity').textContent).toBe('');
            expect(status('tags').textContent).toBe('');
        });
    });

    describe('the loading window is guarded but not rendered', () => {
        test('controls stay lit while the pano loads, so paging does not flicker them', async () => {
            // #editingAllowed is the durable half only. Dimming for the moment a pano takes to load would flash
            // the columns on every page-through, which is why the transient half never reaches the DOM.
            await showLabel();

            expect(card.classList.contains('label-detail--editable')).toBe(true);
            expect(tagsEdit().getAttribute('aria-disabled')).toBe('false');
            for (const face of faces()) expect(face.hasAttribute('aria-disabled')).toBe(false);
        });

        test('but a click landing in that window still saves nothing', async () => {
            await showLabel({ severity: 2 });

            faces()[2].click();
            tagsEdit().click();
            await flush();

            expect(savedEdits()).toEqual([]);
            expect(tagsEdit().getAttribute('aria-expanded')).toBe('false');
        });
    });
});
