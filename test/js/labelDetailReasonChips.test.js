/**
 * Tests for the one-tap reasons on the label card (public/js/common/label-detail/LabelDetail.js, #5475).
 *
 * After a Disagree or Unsure vote the card offers the canned reasons Validate asks for, in place of the open comment
 * box: one tap records the reason through the comment path the card already has, "Other…" reopens the box, and the
 * number keys pick alongside the card's other shortcuts (#5194). The reason on record marks its chip on a revisit,
 * and a canned reason in the comment list reads in the reader's language rather than the writer's.
 *
 * Fixture and stub strategy follow labelDetailComments.test.js, with the real vocabulary and chip component loaded
 * beside the card and the backend's catalog stamped from the committed fixture.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub, loadGlobalScript, REPO_ROOT, stampValidationReasons } = require('./loadGlobalScript');

const readSrc = (rel) => fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
const LABEL_DETAIL_SRC = readSrc('public/js/common/label-detail/LabelDetail.js');
const TAG_EDITOR_SRC = readSrc('public/js/common/label-detail/TagEditor.js');
const CHIPS_SRC = readSrc('public/js/common/ReasonChips.js');
const EN_COMMON = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public/locales/en/common.json'), 'utf8'));

/** The card markup, reduced to what #cacheElements() dereferences plus the rows these tests drive. */
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
            <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--agree" aria-pressed="false">Agree</button>
            <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--disagree" aria-pressed="false">Disagree</button>
            <button type="button" class="label-detail__pano-overlay-button label-detail__pano-overlay-button--unsure" aria-pressed="false">Unsure</button>
          </div>
          <span class="label-detail__pan-hint" hidden></span>
        </div>
        <div class="label-detail__meta-row">
          <div class="label-detail__meta-cell"><span><span class="label-detail__labeled-word">Labeled</span>:</span><span class="label-detail__timestamp label-detail__meta-value"></span></div>
          <div class="label-detail__meta-cell"><span class="label-detail__image-capture-date label-detail__meta-value"></span></div>
          <span class="label-detail__meta-divider label-detail__meta-divider--address" aria-hidden="true" hidden></span>
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
            <div class="label-detail__col-header"><h3 class="label-detail__col-title label-detail__severity-title">Severity</h3><span class="label-detail__edit-status" role="status" aria-live="polite"></span></div>
            <div class="label-detail__severity-faces" role="group" aria-label="Severity">
              ${[1, 2, 3].map((n) => `
                <button type="button" class="severity-button severity-button--static" data-severity="${n}" aria-disabled="true" aria-pressed="false" tabindex="-1">
                  <img alt="" class="severity-button__icon"><span class="severity-button__label"></span>
                </button>`).join('')}
            </div>
          </section>
          <section class="label-detail__col label-detail__col--tags">
            <div class="label-detail__col-header"><h3 class="label-detail__col-title label-detail__tags-title">Tags</h3><button type="button" class="label-detail__tags-edit" hidden aria-expanded="false">Edit</button><span class="label-detail__edit-status" role="status" aria-live="polite"></span></div>
            <div class="label-detail__tags"></div>
          </section>
        </div>
        <div class="label-detail__reasons" hidden></div>
        <div class="label-detail__desc-comments">
          <section class="label-detail__description-section"><div class="label-detail__description"></div></section>
          <section class="label-detail__comments-section">
            <h3 class="label-detail__col-title label-detail__comments-title" tabindex="-1"><span class="label-detail__comments-count" hidden></span></h3>
            <div class="label-detail__comment-row">
              <label class="sr-only" for="label-detail-comment-input">Why?</label>
              <input type="text" id="label-detail-comment-input" class="label-detail__comment-input">
              <button type="button" class="label-detail__comment-submit" data-action="submit-comment">Comment</button>
              <button type="button" class="button-ps button--small button--secondary label-detail__comment-cancel" data-action="cancel-comment-edit" hidden>Cancel</button>
            </div>
            <span class="label-detail__comment-confirmation" role="status" aria-live="polite" hidden></span>
            <div class="label-detail__validator-comments"></div>
          </section>
        </div>
        <section class="label-detail__stories" hidden></section>
        <span class="label-detail__story-status sr-only" role="status" aria-live="polite"></span>
        <div class="label-detail__footer"><a class="label-detail__explore-link" hidden></a><a class="label-detail__labelmap-link" hidden></a></div>
      </div>`;
    return document.getElementById('card');
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** Label metadata in the shape `/label/id/:id` serves. */
function meta(overrides = {}) {
    return {
        label_id: 42, label_type: 'CurbRamp', severity: 2, tags: [], can_edit: false, from_current_user: false,
        description: '', pano_id: 'pano-1', lat: 47.61, lng: -122.33, camera_lat: 47.615, camera_lng: -122.335,
        heading: 250.5, pitch: -12, zoom: 2, canvas_x: 100, canvas_y: 200, canvas_width: 720, canvas_height: 480,
        street_edge_id: 7, region_id: 3, timestamp: '2026-08-01T12:00:00Z', image_capture_date: '2025-06-01',
        num_agree: 0, num_disagree: 1, num_unsure: 0, user_validation: 'Disagree', ai_validation: null,
        comments: [],
        ...overrides,
    };
}

/** A comment entry as the non-admin payload carries it. */
const comment = (text, mine, extra = {}) => (
    { comment: text, mine, reason: null, time_created: '2026-08-20T10:00:00Z', commenter: 0, validation: 'Disagree', ...extra }
);

/** An i18next over the real English common.json (the vocabulary reads `exists`); other namespaces echo the key. */
function installI18next() {
    const lookup = (key) => {
        const [ns, rest] = key.split(':');
        if (ns !== 'common') return undefined;
        return rest.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), EN_COMMON);
    };
    window.i18next = {
        t: (key) => (typeof lookup(key) === 'string' ? lookup(key) : key),
        exists: (key) => typeof lookup(key) === 'string',
    };
}

describe('the one-tap reasons on the label card (#5475)', () => {
    let card;
    let setPano;
    let posted;

    const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

    async function showLabel(overrides) {
        const payload = meta(overrides);
        await card.detail.showLabel(payload, 'TestSource');
        return payload;
    }

    async function resolveImagery(imageShown = true) {
        setPano.resolve(imageShown);
        await setPano.promise;
        await flush();
    }

    const q = (sel) => card.querySelector(sel);
    const reasons = () => q('.label-detail__reasons');
    const chips = () => [...card.querySelectorAll('.label-detail__reasons [role="radio"]')];
    const chipById = (id) => card.querySelector(`.label-detail__reasons [data-reason-id="${id}"]`);
    const other = () => q('.reason-chips__chip--other');
    const boxOpen = () => q('.label-detail__comment-row').classList.contains('is-open');
    const input = () => q('.label-detail__comment-input');
    const status = () => q('.label-detail__comment-confirmation');
    const listText = () => q('.label-detail__validator-comments').textContent;
    const keydown = (code) => window.dispatchEvent(new window.KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));

    beforeEach(async () => {
        jest.resetModules();
        card = buildCard();
        posted = [];

        installI18next();
        window.moment = () => ({ format: () => '', fromNow: () => 'a while ago' });
        window.logWebpageActivity = jest.fn();
        window.buildBackupImageData = () => null;
        window.camelToKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        window.util = {
            assetPath: assetPathStub,
            escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
            EXPLORE_CANVAS_WIDTH: 720,
            EXPLORE_CANVAS_HEIGHT: 480,
            isMobile: () => false,
            lazyIdentityFetch: jest.fn(async (url, init) => {
                posted.push({ url, body: JSON.parse(init.body) });
                return { ok: true, status: 200, json: async () => ({ username: 'tester', comment_id: 1 }) };
            }),
            camelToKebab: window.camelToKebab,
            misc: {
                getRatingLevelKeys: () => ({ 1: 'low', 2: 'medium', 3: 'high' }),
                getSmileyIconPath: (sev, type, selected) => `${type}-${sev}-${selected}.svg`,
                isPositiveLabelType: () => true,
                labelTypeHasSeverity: () => true,
            },
            pano: { centeredPovToCanvasCoord: () => ({ x: 0, y: 0 }), renderedHFov: () => 90 },
            url: { replaceQuery: () => {} },
        };
        stampValidationReasons();
        loadGlobalScript('public/js/common/validationReasons.js');
        window.BadgeAchievements = { seedCounts: () => {}, recordValidation: () => {} };
        window.LabelVisibilityToggle = class { constructor() {} };
        window.PanoInfoPopover = class { constructor() {} };
        window.ConfirmDialog = { confirm: jest.fn(async () => true) };

        setPano = deferred();
        const panoManager = {
            clearLabels: jest.fn(),
            setLabel: jest.fn(),
            setLabelsHidden: jest.fn(),
            setPano: jest.fn(() => setPano.promise),
            activeViewerName: 'Default',
            panoViewer: {
                currPanoData: null,
                getViewerType: () => 'gsv',
                getPanoId: () => 'pano-1',
                getPosition: () => ({ lat: 47.61, lng: -122.33 }),
            },
            getPov: () => ({ heading: 250.5, pitch: -12, zoom: 2 }),
            getOriginalPosition: () => ({ heading: 250.5, pitch: -12 }),
            svHolder: Object.assign([document.createElement('div')], { width: () => 720, height: () => 480 }),
            label: { labelId: 42, label_type: 'CurbRamp' },
        };
        window.PopupPanoManager = { create: async () => panoManager };
        window.fetch = jest.fn(async (url) => {
            if (String(url).includes('/label/tags')) return { ok: true, json: async () => [] };
            return { ok: true, status: 200, json: async () => ({ username: 'tester', comment_id: 1, deleted: 1 }) };
        });

        window.eval(`${CHIPS_SRC}\n${TAG_EDITOR_SRC}\n${LABEL_DETAIL_SRC}\nwindow.LabelDetail = LabelDetail;`);
        card.detail = await window.LabelDetail.create(card, {
            admin: false, viewerType: 'Default', currUsername: 'tester', panoOverlaySource: 'test', voteColumnSource: 'test',
        });
    });

    test('a Disagree shows that type\'s reasons and keeps the box shut; an Agree or no vote shows none', async () => {
        await showLabel({ user_validation: 'Disagree' });
        await resolveImagery();
        expect(reasons().hidden).toBe(false);
        expect(chips().map((c) => c.dataset.reasonId)).toEqual(['wrong-type', 'driveway', 'driveway-transition']);
        expect(q('.reason-chips__prompt').textContent).toBe('Why do you disagree?');
        // The chips stand in for the box: one tap answers, and "Other…" is the way to the box.
        expect(boxOpen()).toBe(false);

        await showLabel({ user_validation: 'Unsure' });
        await resolveImagery();
        expect(chips().map((c) => c.dataset.reasonId)).toEqual(['better-image', 'placement-incorrect', 'ramp-required-unsure']);

        await showLabel({ user_validation: 'Agree' });
        await resolveImagery();
        expect(reasons().hidden).toBe(true);
        expect(boxOpen()).toBe(true); // An Agree keeps its optional-note box (#5015).

        await showLabel({ user_validation: null });
        await resolveImagery();
        expect(reasons().hidden).toBe(true);
    });

    test('a type with no canned reasons keeps the box as the way to answer', async () => {
        await showLabel({ user_validation: 'Disagree', label_type: 'Other' });
        await resolveImagery();
        expect(reasons().hidden).toBe(true);
        expect(boxOpen()).toBe(true);
    });

    test('the reason on record marks its chip, and the list shows it in the reader\'s language', async () => {
        // Stored text is whatever the writer's menu showed; the id is what crosses languages.
        await showLabel({ comments: [comment('Dit is een oprit', true, { reason: 'driveway' })] });
        await resolveImagery();
        expect(chipById('driveway').getAttribute('aria-checked')).toBe('true');
        expect(listText()).toContain('This is a driveway');
        expect(listText()).not.toContain('Dit is een oprit');
        expect(boxOpen()).toBe(false); // A comment of theirs exists; Edit on it is the way back into the box.

        // An id these locale files don't know falls back to the stored words rather than a raw key.
        await showLabel({ comments: [comment('Something new', true, { reason: 'not-yet-translated' })] });
        await resolveImagery();
        expect(chips().every((c) => c.getAttribute('aria-checked') === 'false')).toBe(true);
        expect(listText()).toContain('Something new');
    });

    test('a tap records the reason through the comment path, marks the chip, and logs the pick', async () => {
        await showLabel({ user_validation: 'Disagree' });
        await resolveImagery();
        chipById('driveway').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
        expect(reasons().classList.contains('reason-chips--busy')).toBe(true);
        await flush();

        expect(posted).toHaveLength(1);
        expect(posted[0].url).toBe('/labelmap/comment');
        expect(posted[0].body).toMatchObject({ label_id: 42, label_type: 'CurbRamp', comment: 'This is a driveway', reason: 'driveway' });
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=LabelDetail_action=DisagreeReason_option=driveway_labelId=42');
        expect(chipById('driveway').getAttribute('aria-checked')).toBe('true');
        expect(reasons().classList.contains('reason-chips--busy')).toBe(false);
        expect(listText()).toContain('This is a driveway');
        expect(status().hidden).toBe(false);
        expect(status().textContent).toBe('Reason saved');

        // Picking another replaces it: one comment per (label, user), so the list holds the new one alone.
        chipById('driveway-transition').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
        await flush();
        expect(posted).toHaveLength(2);
        expect(chipById('driveway').getAttribute('aria-checked')).toBe('false');
        expect(chipById('driveway-transition').getAttribute('aria-checked')).toBe('true');
        expect(listText()).not.toContain('This is a driveway');
        expect(listText()).toContain('sidewalk to driveway transition');
    });

    test('a failed save leaves nothing selected and says so', async () => {
        await showLabel({ user_validation: 'Disagree' });
        await resolveImagery();
        window.util.lazyIdentityFetch.mockImplementationOnce(async () => ({ ok: false, status: 500 }));
        chipById('driveway').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
        await flush();
        expect(chipById('driveway').getAttribute('aria-checked')).toBe('false');
        expect(status().textContent).toBe('labelmap:comment-save-failed');
        expect(reasons().classList.contains('reason-chips--busy')).toBe(false);
    });

    test('the number keys pick while the row is open, and the one past the reasons opens the box', async () => {
        await showLabel({ user_validation: 'Disagree' });
        await resolveImagery();
        keydown('Digit2');
        await flush();
        expect(posted[0].body.reason).toBe('driveway');
        expect(window.logWebpageActivity).toHaveBeenCalledWith('KeyboardShortcut_module=LabelDetail_action=DisagreeReason_option=driveway_labelId=42');

        // 4 on a three-reason type is "Other…": the box opens, focused, as an edit of the canned reason just picked.
        keydown('Digit4');
        await flush();
        expect(window.logWebpageActivity).toHaveBeenCalledWith('KeyboardShortcut_module=LabelDetail_action=DisagreeReasonOther_labelId=42');
        expect(boxOpen()).toBe(true);
        expect(document.activeElement).toBe(input());
        expect(input().value).toBe(''); // The canned text would only be in the way of words of their own.

        // A digit typed into the box is text, not a pick.
        posted.length = 0;
        input().dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Digit1', bubbles: true, cancelable: true }));
        await flush();
        expect(posted).toHaveLength(0);
    });

    test('a digit with no row open is left to the page', async () => {
        await showLabel({ user_validation: 'Agree' });
        await resolveImagery();
        const e = new window.KeyboardEvent('keydown', { code: 'Digit1', bubbles: true, cancelable: true });
        window.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(false);
        expect(posted).toHaveLength(0);
    });

    test('"Other…" with no comment yet opens the box focused; a typed comment then clears the chip', async () => {
        await showLabel({ user_validation: 'Disagree' });
        await resolveImagery();
        other().dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
        expect(boxOpen()).toBe(true);
        expect(document.activeElement).toBe(input());
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=LabelDetail_action=DisagreeReasonOther_labelId=42');

        input().value = 'It is a garage entrance.';
        input().dispatchEvent(new window.Event('input', { bubbles: true }));
        q('.label-detail__comment-submit').click();
        await flush();
        expect(posted[0].body).toMatchObject({ comment: 'It is a garage entrance.', reason: null });
        expect(chips().every((c) => c.getAttribute('aria-checked') === 'false')).toBe(true);
        expect(boxOpen()).toBe(false);
        expect(status().textContent).toBe('labelmap:comment-submitted');
    });

    test('changing the vote to Agree drops the chips along with the comment the vote carried', async () => {
        await showLabel({ user_validation: 'Disagree', comments: [comment('This is a driveway', true, { reason: 'driveway' })] });
        await resolveImagery();
        expect(chipById('driveway').getAttribute('aria-checked')).toBe('true');
        q('.label-detail__pano-overlay-button--agree').click();
        await flush();
        expect(reasons().hidden).toBe(true);
        expect(listText()).not.toContain('driveway');
        expect(boxOpen()).toBe(true); // The Agree's own optional-note box.
    });

    test('a request for the box that arrives while the imagery loads is honored once it settles', async () => {
        // What a Gallery card's "Other…" does: opens this card and asks for the box before the pano is up.
        await showLabel({ user_validation: 'Disagree' });
        card.detail.requestOtherReason();
        expect(boxOpen()).toBe(false);
        expect(document.activeElement).not.toBe(input());
        await resolveImagery();
        expect(boxOpen()).toBe(true);
        expect(document.activeElement).toBe(input());
    });

    test('the viewer\'s own label offers no reasons', async () => {
        await showLabel({ user_validation: 'Disagree', from_current_user: true });
        await resolveImagery();
        expect(reasons().hidden).toBe(true);
    });
});
