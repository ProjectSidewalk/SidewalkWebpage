/**
 * Tests for the validator comment box on the label card (public/js/common/label-detail/LabelDetail.js, #5015).
 *
 * A comment belongs to a vote. All three votes carry one — Disagree and Unsure ask for the reasoning behind the
 * dispute, Agree invites an optional note — and a vote that moves takes its comment with it, because the server
 * deletes the comment on a cleared or changed vote and the list has to say so without a reload.
 *
 * A comment is also unique per (label, user): validation_task_comment_label_id_user_id_unique, added by evolution
 * 359 for #4942, which `ValidationService.replaceComment` enforces by deleting before inserting. So the card
 * mirrors what a story of your own already does (`StorySection`): once yours exists the compose box closes and the
 * comment carries Edit/Delete instead, which is what keeps a second submission from silently destroying the first.
 * Cancel and Escape are the two ways out that keep the box from being a one-way door.
 *
 * Fixture and stub strategy follow labelDetailEditGating.test.js: LabelDetail is a top-level `class` written for
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
 * Builds the card markup as views/common/labelDetail.scala.html renders it for a non-admin host, reduced to the
 * elements #cacheElements() dereferences (several of them unguarded) plus the comment row these tests drive.
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
              <button type="button" class="button-ps button--small button--secondary label-detail__comment-cancel" data-action="cancel-comment-edit" hidden>Cancel</button>
            </div>
            <span class="label-detail__comment-confirmation" role="status" aria-live="polite" hidden></span>
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

/** A deferred promise, so a test decides when this label's imagery resolves. */
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/**
 * Label metadata in the shape `/label/id/:id` serves, with a vote already cast so the comment box has a reason to
 * be open in the first place.
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
        num_disagree: 1,
        num_unsure: 0,
        user_validation: 'Disagree',
        ai_validation: null,
        comments: [],
        ...overrides,
    };
}

/** A comment entry as the non-admin `/label/id/:id` payload carries it. */
const comment = (text, mine, extra = {}) => (
    { comment: text, mine, time_created: '2026-08-20T10:00:00Z', commenter: 0, validation: 'Disagree', ...extra }
);

describe('the validator comment box (#5015)', () => {
    let LabelDetail;
    let card;
    let panoManager;
    let setPano;
    let confirmResult;

    /** Drains the microtask queue that the card's promise chains spread work across. */
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
    const commentRow = () => q('.label-detail__comment-row');
    const boxOpen = () => commentRow().classList.contains('is-open');
    const input = () => q('.label-detail__comment-input');
    const submitBtn = () => q('.label-detail__comment-submit');
    const cancelBtn = () => q('.label-detail__comment-cancel');
    const editBtn = () => q('.label-detail__comment-edit');
    const deleteBtn = () => q('.label-detail__comment-delete');
    const status = () => q('.label-detail__comment-confirmation');
    /** Sends one half of an Escape press to the comment input, the way a browser routes it to the focused element. */
    const escape = (type) => document.activeElement.dispatchEvent(
        new window.KeyboardEvent(type, { key: 'Escape', bubbles: true })
    );

    beforeEach(async () => {
        jest.resetModules();
        card = buildCard();

        window.i18next = { t: (key) => key };
        window.moment = () => ({ format: () => '', fromNow: () => 'a while ago' });
        window.logWebpageActivity = jest.fn();
        window.buildBackupImageData = () => null;
        // The card reaches for this both bare and through `util`, so both spellings have to answer.
        window.camelToKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        window.util = {
            assetPath: assetPathStub,
            EXPLORE_CANVAS_WIDTH: 720,
            EXPLORE_CANVAS_HEIGHT: 480,
            isMobile: () => false,
            lazyIdentityFetch: jest.fn(async () => (
                { ok: true, status: 200, json: async () => ({ username: 'tester', comment_id: 1 }) }
            )),
            camelToKebab: (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(),
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
        confirmResult = true;
        window.ConfirmDialog = { confirm: jest.fn(async () => confirmResult) };

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

        window.fetch = jest.fn(async (url) => {
            if (String(url).includes('/label/tags')) return { ok: true, json: async () => [] };
            return { ok: true, status: 200, json: async () => ({ username: 'tester', comment_id: 1, deleted: 1 }) };
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

    describe('the box opens alongside a vote, with that vote\'s prompt', () => {
        test.each([
            ['Agree', 'labelmap:why-agree'],
            ['Disagree', 'labelmap:why-disagree'],
            ['Unsure', 'labelmap:why-unsure'],
        ])('a %s vote opens it asking %s', async (vote, key) => {
            // All three votes carry a comment (#5015): Disagree/Unsure ask for the reasoning behind the dispute,
            // Agree invites an optional note.
            await showLabel({ user_validation: vote });
            await resolveImagery();

            expect(boxOpen()).toBe(true);
            expect(input().placeholder).toBe(key);
            expect(q('.label-detail__comment-row label').textContent).toBe(key);
        });

        test('no vote leaves it closed', async () => {
            // Comments stay tied to a vote; open-ended notes about a place are lived-experience stories (#4054).
            await showLabel({ user_validation: null });
            await resolveImagery();

            expect(boxOpen()).toBe(false);
        });
    });

    describe('a vote that moves takes its comment with it', () => {
        test('changing your vote drops the comment and reopens the box on the new prompt', async () => {
            await showLabel({ user_validation: 'Disagree', comments: [comment('because of the snow', true)] });
            await resolveImagery();
            expect(q('.label-detail__validator-comments').textContent).toContain('because of the snow');

            // The server deletes the comment on a changed vote; the list has to say so without a reload.
            card.querySelector('.label-detail__vote--agree').click();
            await flush();

            expect(q('.label-detail__validator-comments').textContent).not.toContain('because of the snow');
            expect(boxOpen()).toBe(true);
            expect(input().placeholder).toBe('labelmap:why-agree');
            expect(q('.label-detail__comment-confirmation').textContent).toBe('labelmap:comment-cleared');
        });

        test('clearing your vote drops the comment and closes the box', async () => {
            await showLabel({ user_validation: 'Disagree', comments: [comment('because of the snow', true)] });
            await resolveImagery();

            // Re-clicking the vote you already cast clears it.
            card.querySelector('.label-detail__vote--disagree').click();
            await flush();

            expect(q('.label-detail__validator-comments').textContent).not.toContain('because of the snow');
            expect(boxOpen()).toBe(false);
        });

        test('leaves someone else\'s comment alone', async () => {
            await showLabel({ user_validation: 'Disagree', comments: [comment('theirs', false), comment('mine', true)] });
            await resolveImagery();
            card.querySelector('.label-detail__vote--agree').click();
            await flush();

            const list = q('.label-detail__validator-comments').textContent;
            expect(list).toContain('theirs');
            expect(list).not.toContain('mine');
        });
    });

    describe('the compose box yields to the comment it would overwrite', () => {
        test('stays open when the voter has not commented yet', async () => {
            await showLabel({ comments: [comment('someone else said this', false)] });
            await resolveImagery();

            expect(boxOpen()).toBe(true);
            expect(editBtn()).toBeNull();
        });

        test('closes once one of your own comments exists, offering Edit/Delete instead', async () => {
            await showLabel({ comments: [comment('mine', true)] });
            await resolveImagery();

            // The whole point: no open box above your own comment inviting the submission that replaces it.
            expect(boxOpen()).toBe(false);
            expect(editBtn().textContent).toBe('labelmap:comment-edit');
            expect(deleteBtn().textContent).toBe('labelmap:comment-delete');
        });

        test('puts the controls after the comment text, not before it', async () => {
            await showLabel({ comments: [comment('the snow hides it', true)] });
            await resolveImagery();

            // The reader meets what was said before what can be done to it, so the buttons trail the text.
            const row = q('.label-detail__validator-comments p');
            const nodes = [...row.childNodes];
            const textIdx = nodes.findIndex((n) => (n.textContent ?? '').includes('the snow hides it'));
            expect(textIdx).toBeGreaterThanOrEqual(0);
            expect(nodes.indexOf(editBtn())).toBeGreaterThan(textIdx);
            expect(nodes.indexOf(deleteBtn())).toBeGreaterThan(nodes.indexOf(editBtn()));
        });

        test('puts no controls on someone else\'s comment', async () => {
            await showLabel({ comments: [comment('theirs', false), comment('mine', true)] });
            await resolveImagery();

            const rows = [...card.querySelectorAll('.label-detail__validator-comments p')];
            const withControls = rows.filter((r) => r.querySelector('.label-detail__comment-own-control'));
            expect(withControls).toHaveLength(1);
            expect(withControls[0].textContent).toContain('mine');
        });
    });

    describe('Edit opens the box on the existing text', () => {
        test('prefills the input and relabels the submit button', async () => {
            await showLabel({ comments: [comment('the snow hides it', true)] });
            await resolveImagery();
            editBtn().click();

            expect(boxOpen()).toBe(true);
            expect(input().value).toBe('the snow hides it');
            expect(submitBtn().textContent).toBe('labelmap:comment-save');
            expect(cancelBtn().hidden).toBe(false);
        });

        test('hides the Edit button while its own box is open', async () => {
            await showLabel({ comments: [comment('mine', true)] });
            await resolveImagery();
            editBtn().click();

            // The open box below is already acting on this comment; a second Edit beside it would reopen what is open.
            expect(editBtn()).toBeNull();
        });

        test('opens even for a comment left before its vote was cleared', async () => {
            // Clearing a vote deletes its comment now, but comments predating that rule still exist and their
            // author has to be able to reach their own text. With no vote there is no per-vote prompt to show.
            await showLabel({ user_validation: null, comments: [comment('older than the rule', true, { validation: null })] });
            await resolveImagery();
            editBtn().click();

            expect(boxOpen()).toBe(true);
            expect(input().placeholder).toBe('labelmap:add-comment');
        });
    });

    describe('there are two ways out that do not save', () => {
        test('Cancel closes the box and leaves the comment alone', async () => {
            await showLabel({ comments: [comment('unchanged', true)] });
            await resolveImagery();
            editBtn().click();
            input().value = 'a draft nobody asked to keep';
            cancelBtn().click();

            expect(boxOpen()).toBe(false);
            expect(input().value).toBe('');
            expect(q('.label-detail__validator-comments').textContent).toContain('unchanged');
            // Comment saves go through util.lazyIdentityFetch (#4442), not window.fetch.
            expect(window.util.lazyIdentityFetch).not.toHaveBeenCalled();
        });

        test('Escape abandons the edit', async () => {
            await showLabel({ comments: [comment('unchanged', true)] });
            await resolveImagery();
            editBtn().click();
            escape('keydown');

            expect(boxOpen()).toBe(false);
            expect(editBtn()).not.toBeNull();
        });

        test('Escape keeps focus in the input until its own keyup, then hands it to Edit', async () => {
            // Gallery's shortcut handler is on `window` and stands down only for an INPUT/TEXTAREA
            // (KeyboardManager.#documentKeyUp), and its Escape case closes the expanded view. So the focus move that
            // ends an edit has to wait for the keyup: hand focus to the Edit <button> during keydown and the keyup
            // arrives on the button instead, past the input's own listener and that guard, and the single press that
            // cancelled the edit also closes the card.
            await showLabel({ comments: [comment('unchanged', true)] });
            await resolveImagery();
            editBtn().click();

            escape('keydown');
            expect(document.activeElement).toBe(input());

            escape('keyup');
            expect(document.activeElement).toBe(editBtn());
        });

        test('an Escape that cancels nothing still blurs the input, as it always did', async () => {
            await showLabel({ user_validation: 'Disagree' });
            await resolveImagery();
            input().focus();

            escape('keydown');
            escape('keyup');

            expect(document.activeElement).not.toBe(input());
        });

        test('Cancel returns focus to the Edit button that opened the box', async () => {
            await showLabel({ comments: [comment('mine', true)] });
            await resolveImagery();
            editBtn().click();
            cancelBtn().click();

            expect(document.activeElement).toBe(editBtn());
        });
    });

    describe('saving and deleting', () => {
        test('a saved edit replaces the comment and closes the box', async () => {
            await showLabel({ comments: [comment('before', true)] });
            await resolveImagery();
            editBtn().click();
            input().value = 'after';
            submitBtn().click();
            await flush();

            const list = q('.label-detail__validator-comments').textContent;
            expect(list).toContain('after');
            expect(list).not.toContain('before');
            expect(boxOpen()).toBe(false);
            expect(editBtn()).not.toBeNull();
        });

        test('Delete removes the comment and reopens the box', async () => {
            await showLabel({ comments: [comment('regrettable', true)] });
            await resolveImagery();
            deleteBtn().click();
            await flush();

            expect(window.fetch).toHaveBeenCalledWith('/labelmap/comment/42', { method: 'DELETE' });
            expect(q('.label-detail__validator-comments').textContent).not.toContain('regrettable');
            // With nothing of theirs left, commenting is on offer again.
            expect(boxOpen()).toBe(true);
        });

        test('declining the confirm leaves the comment in place', async () => {
            confirmResult = false;
            await showLabel({ comments: [comment('kept', true)] });
            await resolveImagery();
            deleteBtn().click();
            await flush();

            expect(window.fetch).not.toHaveBeenCalledWith('/labelmap/comment/42', { method: 'DELETE' });
            expect(q('.label-detail__validator-comments').textContent).toContain('kept');
        });

        test('Delete moves focus into the reopened box rather than dropping it', async () => {
            // The button that had focus is destroyed by the re-render, so without this focus falls to the document
            // and a keyboard or screen-reader user loses their place mid-card.
            await showLabel({ comments: [comment('regrettable', true)] });
            await resolveImagery();
            deleteBtn().click();
            await flush();

            expect(document.activeElement).toBe(input());
        });
    });

    describe('every outcome is announced, including the ones that close the box', () => {
        test('the live region sits outside the row that a save collapses', () => {
            // Inside the row it would be display-collapsed in the same frame its text is set: shown to no one, and
            // announced to no one under prefers-reduced-motion, where the row has no transition to linger through.
            expect(status().closest('.label-detail__comment-row')).toBeNull();
        });

        test('a saved comment is announced after the box has closed', async () => {
            await showLabel({ user_validation: 'Agree' });
            await resolveImagery();
            input().value = 'a curb ramp is under the snow';
            submitBtn().click();
            await flush();

            expect(boxOpen()).toBe(false);
            expect(status().hidden).toBe(false);
            expect(status().textContent).toBe('labelmap:comment-submitted');
        });

        test('a saved edit says so rather than repeating the first-comment wording', async () => {
            await showLabel({ comments: [comment('before', true)] });
            await resolveImagery();
            editBtn().click();
            input().value = 'after';
            submitBtn().click();
            await flush();

            expect(status().textContent).toBe('labelmap:comment-updated');
        });

        test('a save that fails says so, in the failure colour', async () => {
            window.util.lazyIdentityFetch = jest.fn(async () => ({ ok: false, status: 500 }));
            await showLabel({ user_validation: 'Agree' });
            await resolveImagery();
            input().value = 'never lands';
            submitBtn().click();
            await flush();

            expect(status().textContent).toBe('labelmap:comment-save-failed');
            expect(status().classList.contains('is-error')).toBe(true);
        });

        test('a delete that fails says so instead of looking like a no-op', async () => {
            // They confirmed a destructive action in a modal; silence is indistinguishable from it having worked.
            window.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
            await showLabel({ comments: [comment('still here', true)] });
            await resolveImagery();
            deleteBtn().click();
            await flush();

            expect(q('.label-detail__validator-comments').textContent).toContain('still here');
            expect(status().textContent).toBe('labelmap:comment-delete-failed');
            expect(status().classList.contains('is-error')).toBe(true);
        });

        test('a removal holds on screen longer than a save, and a failure longer still', async () => {
            // A save is a second opinion on the comment that just appeared below it; a removal reports an absence,
            // which gives the reader nothing to check it against. So the tiers have to stay ordered.
            jest.spyOn(window, 'setTimeout');

            /** The hold the flash was scheduled with, found by running pending timers until one hides the region. */
            const holdMs = () => {
                for (const [fn, ms] of window.setTimeout.mock.calls) {
                    if (typeof fn !== 'function' || status().hidden) continue;
                    fn();
                    if (status().hidden) return ms;
                }
                return null;
            };

            await showLabel({ user_validation: 'Agree' });
            await resolveImagery();
            input().value = 'a curb ramp is under the snow';
            submitBtn().click();
            await flush();
            const saved = holdMs();

            window.setTimeout.mockClear();
            deleteBtn().click();
            await flush();
            const removed = holdMs();

            // The delete left the box open with nothing of theirs in it, so a fresh attempt is one keystroke away.
            window.setTimeout.mockClear();
            window.util.lazyIdentityFetch = jest.fn(async () => ({ ok: false, status: 500 }));
            input().value = 'never lands';
            submitBtn().click();
            await flush();
            const failed = holdMs();

            expect(saved).toBeGreaterThan(0);
            expect(removed).toBeGreaterThan(saved);
            expect(failed).toBeGreaterThan(removed);
        });

        test('the message does not outlive the label it was about', async () => {
            await showLabel({ user_validation: 'Agree' });
            await resolveImagery();
            input().value = 'about this label';
            submitBtn().click();
            await flush();
            expect(status().hidden).toBe(false);

            // Gallery pages between labels without tearing the card down, and the flash runs on a 1.5s timer.
            setPano = deferred();
            await showLabel({ user_validation: 'Disagree' });
            await resolveImagery();

            expect(status().hidden).toBe(true);
        });
    });
});
