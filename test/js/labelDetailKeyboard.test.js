/**
 * Tests for the label card's keyboard shortcuts (public/js/common/label-detail/LabelDetail.js, #5194).
 *
 * Left/right page to the previous/next label and A/Y, D/N, U cast agree, disagree and unsure — on every host the
 * shared card has, which is why the shortcuts live in the controller rather than in one host's key manager.
 *
 * The listener is window-wide (the card is often the frontmost thing on the page with nothing inside it holding
 * focus, and the pano viewers stop arrow keys from propagating past `window` anyway), so the whole of the scope is
 * the ownership rule: the card has to be on screen, and the keypress has to have been aimed at it. Most of what is
 * pinned below is therefore what the card *refuses* — a typed "a" in the comment box, a browser chord, an
 * auto-repeat, focus parked on some other control, a dialog stacked over the card, a host that has hidden it.
 *
 * The shortcuts press the card's own buttons rather than reaching past them, so a hidden or disabled control means
 * the key does nothing here and is left for the page to handle (the arrows still scroll). The click they fire
 * carries `detail: 0`, the shape a browser gives a button activated with Enter or Space, which is how the handlers
 * keep logging the keyboard apart from the mouse — and how the vote echo tells the two apart, since a pointer
 * already has the button it pressed as feedback and only the keyboard needs the change pointed out.
 *
 * Fixture and stub strategy follow labelDetailComments.test.js: LabelDetail is a top-level `class` written for
 * Grunt concatenation, so its source is eval'd into the jsdom global with an epilogue exposing it, TagEditor rides
 * along because LabelDetail closes over that binding, and the collaborators it reaches for as bare globals are
 * stubbed on `window` first.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub } = require('./loadGlobalScript');

const readSrc = (rel) => fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
const LABEL_DETAIL_SRC = readSrc('public/js/common/label-detail/LabelDetail.js');
const TAG_EDITOR_SRC = readSrc('public/js/common/label-detail/TagEditor.js');

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

describe('the label card\'s keyboard shortcuts (#5194)', () => {
    let LabelDetail;
    let card;
    let panoManager;
    let setPano;
    /** Every POST the card makes: validations go through util.lazyIdentityFetch, not window.fetch. */
    let post;
    /** Answers opts.isOpen, so a test can put the card's host into its hidden state. */
    let hostOpen;

    /** Drains the microtask queue that the card's promise chains spread work across. */
    const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

    const q = (sel) => card.querySelector(sel);
    const overlayButton = (result) => q(`.label-detail__pano-overlay-button--${result}`);
    const prevArrow = () => q('.label-detail__paging--prev');
    const nextArrow = () => q('.label-detail__paging--next');
    const echo = () => q('.label-detail__vote-pop');

    /** The bodies of the validations posted so far, newest last. */
    const validations = () => post.mock.calls
        .filter(([url]) => url === '/labelmap/validate')
        .map(([, opts]) => JSON.parse(opts.body));

    /**
     * Presses a key the way a browser routes one: at whatever currently has focus, bubbling up to `window`.
     *
     * @param {string} code - The physical key, e.g. 'KeyA' or 'ArrowRight'.
     * @param {Object} [init] - Extra KeyboardEvent fields (modifiers, `repeat`).
     * @returns {KeyboardEvent} The dispatched event, for asserting on defaultPrevented.
     */
    function press(code, init = {}) {
        const event = new window.KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });
        (document.activeElement || document.body).dispatchEvent(event);
        return event;
    }

    /** Builds the markup and mounts a card on it. Any previous card is detached by the rebuild. */
    async function mount({ paging = true, asDialog = false, hosted = false } = {}) {
        card = buildCard({ paging, asDialog });
        card.detail = await LabelDetail.create(card, {
            admin: false,
            viewerType: 'Default',
            currUsername: 'tester',
            panoOverlaySource: 'test',
            // Only a host that shows and hides an inline panel passes this; a <dialog> host answers for itself.
            isOpen: hosted ? () => hostOpen : undefined,
        });
        return card;
    }

    /** Shows a label and settles its imagery, which is what unlocks the card's controls. */
    async function showLabel(overrides) {
        setPano = deferred();
        panoManager.setPano.mockImplementation(() => setPano.promise);
        const payload = meta(overrides);
        await card.detail.showLabel(payload, 'TestSource');
        setPano.resolve(true);
        await setPano.promise;
        await flush();
        return payload;
    }

    beforeEach(async () => {
        jest.resetModules();
        hostOpen = true;

        post = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));

        window.i18next = { t: (key) => key };
        window.moment = () => ({ format: () => '', fromNow: () => 'a while ago' });
        window.logWebpageActivity = jest.fn();
        window.buildBackupImageData = () => null;
        window.camelToKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        window.util = {
            assetPath: assetPathStub,
            EXPLORE_CANVAS_WIDTH: 720,
            EXPLORE_CANVAS_HEIGHT: 480,
            isMobile: () => false,
            lazyIdentityFetch: post,
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
            panoViewer: {
                currPanoData: null,
                getPanoId: () => 'pano-1',
                getPosition: () => ({ lat: 47.61, lng: -122.33 }),
            },
            getPov: () => ({ heading: 250.5, pitch: -12, zoom: 2 }),
            getOriginalPosition: () => ({ heading: 250.5, pitch: -12 }),
            // A jQuery object in the real card: indexable, and asked for its size when a vote is submitted.
            svHolder: Object.assign([document.createElement('div')], { width: () => 720, height: () => 480 }),
            label: { labelId: 42, label_type: 'Obstacle' },
        };
        window.PopupPanoManager = { create: async () => panoManager };

        window.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));

        window.eval(`${TAG_EDITOR_SRC}\n${LABEL_DETAIL_SRC}\nwindow.LabelDetail = LabelDetail;`);
        LabelDetail = window.LabelDetail;

        await mount();
    });

    describe('the vote keys', () => {
        test.each([
            ['KeyA', 'Agree'],
            ['KeyY', 'Agree'],
            ['KeyD', 'Disagree'],
            ['KeyN', 'Disagree'],
            ['KeyU', 'Unsure'],
        ])('%s casts %s', async (code, result) => {
            // A/Y and D/N are the pairs Validate offers for the same two verdicts, kept here so the muscle memory
            // built up in that tool carries over to the card.
            await showLabel();

            press(code);
            await flush();

            expect(validations().map((v) => v.validation_result)).toEqual([result]);
        });

        test('the key drives the card\'s own button, as a click a pointer did not make', async () => {
            // Going through the button rather than around it is what keeps one code path per action — the host's
            // handler and every disabled guard already on the control — and `detail: 0` is what still lets that
            // handler count the keyboard apart from the mouse.
            await showLabel();
            const clicks = [];
            overlayButton('agree').addEventListener('click', (e) => clicks.push(e.detail));

            press('KeyA');
            await flush();

            expect(clicks).toEqual([0]);
        });

        test('pressing the vote you already cast clears it, logged as a shortcut rather than a click', async () => {
            // Clearing a vote deletes its row, so this event is the only record it happened (#4653) — and the two
            // input paths have to stay countable apart (docs/logged-events.md).
            await showLabel({ user_validation: 'Agree', num_agree: 1 });

            press('KeyA');
            await flush();

            expect(validations()[0].undone).toBe(true);
            expect(window.logWebpageActivity).toHaveBeenCalledWith(
                'KeyboardShortcut_module=LabelDetail_action=ClearVote_result=Agree_labelId=42',
            );
        });

        test('a card that cannot be validated ignores them', async () => {
            // Your own label is never yours to validate (#5047): the overlay buttons are disabled, and the
            // shortcut is the same control, so it is disabled too.
            await showLabel({ from_current_user: true });

            press('KeyA');
            await flush();

            expect(validations()).toEqual([]);
        });
    });

    describe('the arrow keys', () => {
        test('left and right press the card\'s prev/next arrows', async () => {
            await showLabel();
            const prev = jest.fn();
            const next = jest.fn();
            prevArrow().addEventListener('click', prev);
            nextArrow().addEventListener('click', next);

            press('ArrowLeft');
            press('ArrowRight');

            expect(prev).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledTimes(1);
            expect(prev.mock.calls[0][0].detail).toBe(0);
        });

        test('a disabled arrow is left alone, and the key stays the page\'s to use', async () => {
            // Nothing to page to, so nothing to swallow: the arrow keys have to keep scrolling the host page.
            await showLabel();
            nextArrow().disabled = true;
            const next = jest.fn();
            nextArrow().addEventListener('click', next);

            const event = press('ArrowRight');

            expect(next).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(false);
        });

        test('an arrow still hidden waiting for its navigator is left alone too', async () => {
            // LabelPopup hides both arrows until the host hands it a navigator, which on LabelMap arrives only
            // once the viewport's labels have loaded (#5068).
            await showLabel();
            nextArrow().hidden = true;
            const next = jest.fn();
            nextArrow().addEventListener('click', next);

            const event = press('ArrowRight');

            expect(next).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(false);
        });

        test('a host with no arrows at all ignores them', async () => {
            // The dashboard's popup and the share page render the card without paging.
            await mount({ paging: false });
            await showLabel();

            const event = press('ArrowRight');

            expect(event.defaultPrevented).toBe(false);
        });
    });

    describe('what the card refuses to claim', () => {
        test('a key typed into the comment box', async () => {
            // The comment box is inside the card, so "a" has to stay an "a" and the arrows have to move the caret.
            await showLabel({ user_validation: 'Disagree', num_disagree: 1 });
            const prev = jest.fn();
            prevArrow().addEventListener('click', prev);
            q('.label-detail__comment-input').focus();

            press('KeyA');
            const arrow = press('ArrowLeft');
            await flush();

            expect(validations()).toEqual([]);
            expect(prev).not.toHaveBeenCalled();
            expect(arrow.defaultPrevented).toBe(false);
        });

        test.each([
            ['ctrlKey'],
            ['metaKey'],
            ['altKey'],
        ])('a chord held with %s, which belongs to the browser', async (modifier) => {
            await showLabel();

            press('KeyA', { [modifier]: true });
            await flush();

            expect(validations()).toEqual([]);
        });

        test('an auto-repeat from a held key', async () => {
            // Holding an arrow down would otherwise page through labels at the OS repeat rate, each step firing a
            // fresh imagery load.
            await showLabel();
            const next = jest.fn();
            nextArrow().addEventListener('click', next);

            press('ArrowRight', { repeat: true });

            expect(next).not.toHaveBeenCalled();
        });

        test('a key pressed with focus parked on some other control', async () => {
            await showLabel();
            document.getElementById('outside').focus();

            press('KeyA');
            await flush();

            expect(validations()).toEqual([]);
        });

        test('a key pressed inside a dialog stacked over the card', async () => {
            // The story composer and its photo lightbox are rendered inside the card's markup, so being inside
            // the card doesn't settle who owns the key.
            await showLabel();
            const composer = q('.story-composer');
            composer.setAttribute('open', ''); // jsdom has no modal dialog implementation.
            document.getElementById('composer-field').focus();

            press('KeyA');
            await flush();

            expect(validations()).toEqual([]);
        });

        test('a key pressed while the host has hidden the card', async () => {
            // The Gallery's expanded view hides its panel with CSS rather than closing a <dialog>, so it answers
            // for itself through opts.isOpen — otherwise a stray "a" would vote on the last label it showed.
            await mount({ hosted: true });
            await showLabel();
            hostOpen = false;

            press('KeyA');
            await flush();

            expect(validations()).toEqual([]);
        });

        test('a key pressed at a <dialog> host that is closed', async () => {
            // LabelPopup's hosts leave the card in the document between openings; a closed dialog owns nothing.
            await mount({ asDialog: true });
            await showLabel();

            press('KeyA');
            await flush();

            expect(validations()).toEqual([]);
        });

        test('a key pressed at a card the host has taken out of the document', async () => {
            await showLabel();
            const detached = card;
            detached.remove();

            press('KeyA');
            await flush();

            expect(validations()).toEqual([]);
        });
    });

    describe('a <dialog> host', () => {
        test('takes the keys once it is open', async () => {
            await mount({ asDialog: true });
            card.setAttribute('open', ''); // What showModal() sets; jsdom implements neither.
            await showLabel();
            // A modal dialog always holds focus, so this is the state the shortcuts actually run in.
            overlayButton('agree').focus();

            press('KeyU');
            await flush();

            expect(validations().map((v) => v.validation_result)).toEqual(['Unsure']);
        });
    });

    describe('the vote echo (#5194)', () => {
        test.each([
            ['KeyA', 'Agree', 'agree'],
            ['KeyD', 'Disagree', 'disagree'],
            ['KeyU', 'Unsure', 'unsure'],
        ])('%s drops a ghost of the %s icon on that vote\'s tally', async (code, action, variant) => {
            await showLabel();

            press(code);
            await flush();

            // Mounted on the icon row, so it starts exactly over the icon it copies; the variant class is what
            // sends agree and unsure up and disagree down.
            expect(echo().parentElement).toBe(q(`.label-detail__vote--${variant} .label-detail__vote-top`));
            expect(echo().classList.contains(`label-detail__vote-pop--${variant}`)).toBe(true);
            // The filled, non-AI icon: the ghost stands for the verdict just cast, not for the icon's own state.
            expect(echo().getAttribute('src')).toBe(`/assets/images/icons/validation/${variant}-filled.svg`);
            // Decoration — the vote it reports is already carried by aria-pressed and the count beside it.
            expect(echo().getAttribute('aria-hidden')).toBe('true');
            expect(echo().alt).toBe('');
        });

        test('a pointer click gets none of it', async () => {
            // Clicking leaves the pressed button under the cursor, which is feedback enough.
            await showLabel();

            overlayButton('agree').dispatchEvent(
                new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
            );
            await flush();

            expect(validations().map((v) => v.validation_result)).toEqual(['Agree']);
            expect(echo()).toBeNull();
        });

        test('clearing a vote gets none of it either', async () => {
            // A rising icon says "counted"; it would read as the opposite of what clearing does.
            await showLabel({ user_validation: 'Agree', num_agree: 1 });

            press('KeyA');
            await flush();

            expect(validations()[0].undone).toBe(true);
            expect(echo()).toBeNull();
        });

        test('prefers-reduced-motion skips it entirely', async () => {
            // Skipped rather than slowed: it is an optional flourish, the way Confetti and StorySection treat theirs.
            window.matchMedia = () => ({ matches: true });
            await showLabel();

            press('KeyA');
            await flush();

            expect(validations().map((v) => v.validation_result)).toEqual(['Agree']);
            expect(echo()).toBeNull();
            delete window.matchMedia;
        });

        test('it takes itself back out of the markup', async () => {
            // On a timer rather than animationend: closing the card mid-flight cancels the animation instead of
            // ending it, and a node left behind on every such vote would accumulate.
            await showLabel();

            press('KeyA');
            await flush();
            expect(echo()).not.toBeNull();

            await new Promise((resolve) => { setTimeout(resolve, 800); });

            expect(echo()).toBeNull();
        });
    });

    describe('claiming a key', () => {
        test('stops it, so nothing further down the page acts on it as well', async () => {
            await showLabel();
            const downstream = jest.fn();
            document.addEventListener('keydown', downstream);

            const event = press('KeyA');
            await flush();

            expect(event.defaultPrevented).toBe(true);
            expect(downstream).not.toHaveBeenCalled();
            document.removeEventListener('keydown', downstream);
        });

        test('a key the card has no use for passes straight through', async () => {
            await showLabel();
            const downstream = jest.fn();
            document.addEventListener('keydown', downstream);

            const event = press('KeyK');

            expect(event.defaultPrevented).toBe(false);
            expect(downstream).toHaveBeenCalledTimes(1);
            document.removeEventListener('keydown', downstream);
        });
    });
});
