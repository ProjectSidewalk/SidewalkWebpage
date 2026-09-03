/**
 * Tests for mobile Validate's two mission screens (#4886): the briefing ModalMission paints before a mission, and
 * the standing row ModalMissionComplete paints after one.
 *
 * Both are the same DOM the desktop tool declares, shown or hidden by toggling `visibility` — which is where most
 * of the sharp edges are. Hiding by visibility preserves how far a screen was scrolled, and these screens are
 * shown over and over. The desktop tool runs the same code against a `display: none` copy of the markup, where a
 * measurement reads zero and a fetched tutorial photo is never seen. And the title is fitted to one line by
 * measuring it, which is only meaningful once the face it is set in has loaded.
 *
 * The classes are top-level declarations concatenated into page scope by Grunt, so the tests evaluate the sources.
 */

const fs = require('fs');
const path = require('path');

const {assetPathStub} = require('./loadGlobalScript');

const SRC = (relativePath) => fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');

/**
 * Load a bare `class` declaration out of a production file.
 * @param {string} relativePath - Path to the file relative to the repo root.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
function loadClass(relativePath, className) {
    return (0, eval)('(() => {\n' + SRC(relativePath) + '\nreturn ' + className + ';\n})()');
}

const ModalMission = loadClass('public/js/validate/src/modal/ModalMission.js', 'ModalMission');
const ModalMissionComplete = loadClass(
    'public/js/validate/src/modal/ModalMissionComplete.js', 'ModalMissionComplete'
);
const ModalNoNewMission = loadClass('public/js/validate/src/modal/ModalNoNewMission.js', 'ModalNoNewMission');
const BadgeAchievements = loadClass('public/js/common/BadgeAchievements.js', 'BadgeAchievements');
const ProgressBar = loadClass('public/js/common/ProgressBar.js', 'ProgressBar');

/** The two slides MissionStartTutorial hands the briefing for a label type: the right example, then a wrong one. */
const SLIDES = [
    {
        isExampleCorrect: true, slideTitle: 'Curb Ramp', slideDescription: 'A ramp cutting through the curb.',
        imageURL: '/assets/images/tutorials/curb-ramp-1.png', labelOnImage: {position: {left: '220px', top: '90px'}},
    },
    {
        isExampleCorrect: false, slideTitle: 'Driveway', slideDescription: 'A driveway is not a curb ramp.',
        imageURL: '/assets/images/tutorials/curb-ramp-2.png', labelOnImage: {position: {left: '100px', top: '40px'}},
    },
];

/** A minimal Mission, with just the properties the two screens read. @returns {Object} */
function makeMission(props = {}) {
    const all = {
        missionId: 1, missionType: 'validation', labelType: 'CurbRamp', labelsValidated: 10, labelsProgress: 0,
        agreeCount: 6, disagreeCount: 3, unsureCount: 1, ...props,
    };
    return {getProperty: (key) => all[key]};
}

describe('mobile Validate mission screens', () => {
    let isMobile;
    let tracker;

    beforeEach(() => {
        isMobile = true;
        tracker = {push: jest.fn()};
        document.body.innerHTML = `
            <div id="modal-mission-holder">
              <div id="modal-mission-background"></div>
              <div id="modal-mission-foreground">
                <div id="modal-mission-eyebrow"></div>
                <h1 id="modal-mission-header"></h1>
                <div id="modal-mission-instruction"></div>
                <button type="button" id="modal-mission-close-button"></button>
              </div>
            </div>
            <div id="modal-mission-complete-holder">
              <div id="modal-mission-complete-background"></div>
              <div id="modal-mission-complete-foreground">
                <div id="mission-complete-celebration"></div>
                <h1 id="modal-mission-complete-title"></h1>
                <span id="mission-complete-label-icon"></span>
                <div id="modal-mission-complete-message"></div>
                <span id="modal-mission-complete-agree-count"></span>
                <span id="modal-mission-complete-disagree-count"></span>
                <span id="modal-mission-complete-unsure-count"></span>
                <span id="mission-complete-badge-icon" class="ps-hidden"></span>
                <span id="mission-complete-badge-name"></span>
                <span id="modal-mission-complete-your-overall-total-count"></span>
                <div class="ps-progress-bar"><div class="ps-progress-bar__track">
                  <div id="mission-complete-badge-progress-fill" class="ps-progress-bar__fill"></div>
                </div></div>
                <span id="mission-complete-badge-next"></span>
                <button type="button" id="modal-mission-complete-close-button-primary"></button>
                <button type="button" id="modal-mission-complete-close-button-secondary"></button>
              </div>
            </div>`;

        // These screens are driven through jQuery element bags built in Main.js, so run the real vendored jQuery
        // rather than a stub — `.html()`, `.css()`, `.scrollTop()`, and empty-set no-ops are all load-bearing here.
        window.eval(SRC('public/vendor/jquery/jquery-1.12.2.min.js'));
        global.$ = window.$;
        global.i18next = {
            // Echo the key plus any interpolation, so assertions can name what a slot was filled with.
            t: (key, opts) => (opts ? `${key}|${JSON.stringify(opts)}` : key),
        };
        global.util = {
            assetPath: assetPathStub,
            isMobile: () => isMobile,
            misc: {getIconImagePaths: (type) => ({iconImagePath: `/assets/icons/${type}_small.svg`})},
        };
        global.MissionStartTutorial = {
            EXAMPLE_PHOTO: {width: 658, height: 436},
            slidesFor: jest.fn(() => SLIDES),
        };
        global.BadgeAchievements = BadgeAchievements;
        global.BadgeAchievements.recordMissionComplete = jest.fn();
        global.ProgressBar = ProgressBar;
        global.Confetti = {burst: jest.fn()};
        global.svv = {
            tracker,
            labelTypes: {1: 'CurbRamp'},
            labelTypeNames: {1: 'Curb Ramp'},
            keyboard: null,
            zoomControl: null,
            undoValidation: {disableUndo: jest.fn()},
            statusField: {getCompletedValidations: () => 0},
            missionContainer: {getCurrentMission: () => makeMission()},
            panoManager: {replayMarkerPulse: jest.fn()},
            missionsCompleted: 1,
        };
        window.matchMedia = jest.fn(() => ({matches: false}));
    });

    afterEach(() => {
        document.body.innerHTML = '';
        for (const key of ['$', 'i18next', 'util', 'MissionStartTutorial', 'BadgeAchievements', 'ProgressBar',
            'Confetti', 'svv']) {
            delete global[key];
        }
    });

    /** The UI element bag Main.js builds for the mission modal. @returns {Object} */
    const missionUI = () => ({
        holder: $('#modal-mission-holder'),
        foreground: $('#modal-mission-foreground'),
        background: $('#modal-mission-background'),
        eyebrow: $('#modal-mission-eyebrow'),
        missionTitle: $('#modal-mission-header'),
        instruction: $('#modal-mission-instruction'),
        closeButton: $('#modal-mission-close-button'),
    });

    /** The UI element bag Main.js builds for the mission-complete modal. @returns {Object} */
    const completeUI = () => ({
        holder: $('#modal-mission-complete-holder'),
        foreground: $('#modal-mission-complete-foreground'),
        background: $('#modal-mission-complete-background'),
        closeButtonPrimary: $('#modal-mission-complete-close-button-primary'),
        closeButtonSecondary: $('#modal-mission-complete-close-button-secondary'),
        agreeCount: $('#modal-mission-complete-agree-count'),
        disagreeCount: $('#modal-mission-complete-disagree-count'),
        unsureCount: $('#modal-mission-complete-unsure-count'),
        message: $('#modal-mission-complete-message'),
        missionTitle: $('#modal-mission-complete-title'),
        labelIcon: $('#mission-complete-label-icon'),
        badgeIcon: $('#mission-complete-badge-icon'),
        badgeName: $('#mission-complete-badge-name'),
        badgeProgressFill: $('#mission-complete-badge-progress-fill'),
        badgeNext: $('#mission-complete-badge-next'),
        yourOverallTotalCount: $('#modal-mission-complete-your-overall-total-count'),
    });

    describe('the briefing’s examples carousel', () => {
        beforeEach(() => {
            new ModalMission(missionUI()).setMissionMessage(makeMission());
        });

        test('is a named group a keyboard can land on, since scrolling it is the only way past example one', () => {
            const strip = document.querySelector('.mv-examples');

            expect(strip.getAttribute('tabindex')).toBe('0');
            expect(strip.getAttribute('role')).toBe('group');
            expect(strip.getAttribute('aria-label')).toContain('examples-label');
        });

        test('renders one figure per slide, the right example first', () => {
            const figures = document.querySelectorAll('.mv-examples .mv-example');

            expect(figures).toHaveLength(2);
            expect(figures[0].classList.contains('mv-example--correct')).toBe(true);
            expect(figures[1].classList.contains('mv-example--incorrect')).toBe(true);
        });

        test('the slides sit inside the strip, not directly in the box the dead end takes over', () => {
            // The dead-end illustration's own figure is a direct child of #modal-mission-instruction and carries a
            // bottom margin; the slides must stay one level in, where that rule can't reach them.
            const instruction = document.getElementById('modal-mission-instruction');

            expect(instruction.querySelectorAll(':scope > figure')).toHaveLength(0);
            expect(instruction.querySelectorAll('.mv-examples > figure')).toHaveLength(2);
        });

        test('only the first photo is fetched up front; the rest wait for a swipe', () => {
            const images = document.querySelectorAll('.mv-example__photo img');

            expect(images[0].getAttribute('loading')).toBeNull();
            expect(images[1].getAttribute('loading')).toBe('lazy');
        });

        test('a dot per slide, the first one current, hidden from screen readers as decoration', () => {
            expect(document.querySelectorAll('.mv-dot')).toHaveLength(2);
            expect(document.querySelectorAll('.mv-dot--current')).toHaveLength(1);
            expect(document.querySelector('.mv-dots').getAttribute('aria-hidden')).toBe('true');
        });
    });

    describe('the briefing on desktop, which shows this same markup only to announce a dead end', () => {
        test('builds no carousel, so no tutorial photo is fetched for markup nobody sees', () => {
            isMobile = false;

            new ModalMission(missionUI()).setMissionMessage(makeMission());

            expect(MissionStartTutorial.slidesFor).not.toHaveBeenCalled();
            expect(document.querySelector('.mv-examples')).toBeNull();
            expect(document.querySelectorAll('#modal-mission-instruction img')).toHaveLength(0);
        });

        test('leaves no shrunk-to-one-line sizing on a heading it never measured', () => {
            isMobile = false;

            new ModalMission(missionUI()).setMissionMessage(makeMission());

            const title = document.getElementById('modal-mission-header');
            expect(title.style.fontSize).toBe('');
            expect(title.style.whiteSpace).toBe('');
        });
    });

    describe('fitting the mission title to one line', () => {
        let title;

        /**
         * Publishes the size the heading token sets this title in, as a stylesheet rule rather than an inline
         * style — the fit clears the inline size to read it back, which is the whole point.
         * @param {number} px - The token's font size.
         */
        function setTokenSize(px) {
            let sheet = document.getElementById('token-sheet');
            if (!sheet) {
                sheet = document.createElement('style');
                sheet.id = 'token-sheet';
                document.head.appendChild(sheet);
            }
            sheet.textContent = `#modal-mission-header { font-size: ${px}px; }`;
        }

        /**
         * Makes the title report a rendered width, as jsdom lays nothing out. `scrollWidth` is what the text needs
         * at the size it is currently set in; `clientWidth` is the room it has.
         * @param {number} widthPerPx - How wide the text is per px of font size.
         * @param {number} available - The width of the box it has to fit into.
         * @param {number} [tokenSize=24] - The size the title is set in before anything is stamped on it.
         */
        function measureAs(widthPerPx, available, tokenSize = 24) {
            setTokenSize(tokenSize);
            Object.defineProperty(title, 'clientWidth', {get: () => available, configurable: true});
            Object.defineProperty(title, 'scrollWidth', {configurable: true, get: () => {
                const size = parseFloat(title.style.fontSize) || tokenSize;
                return Math.round(widthPerPx * size);
            }});
        }

        beforeEach(() => {
            title = document.getElementById('modal-mission-header');
            title.style.fontSize = '';
            setTokenSize(24);
        });

        test('a title that already fits keeps the heading token’s own size, with nothing stamped on it', () => {
            measureAs(8, 320); // 192px of text in a 320px box.

            new ModalMission(missionUI()).setMissionMessage(makeMission());

            expect(title.style.fontSize).toBe('');
            expect(title.style.whiteSpace).toBe('nowrap');
        });

        test('a title that overflows is shrunk only as far as it has to be', () => {
            measureAs(16, 320); // 384px of text in a 320px box: 20px is the first size that fits.

            new ModalMission(missionUI()).setMissionMessage(makeMission());

            expect(parseFloat(title.style.fontSize)).toBe(20);
            expect(title.style.whiteSpace).toBe('nowrap');
        });

        test('the starting size is the stylesheet’s, so retuning the heading token carries this heading too', () => {
            // 10px of text per px of font size, in a 260px box: it fits at 26px and no larger.
            measureAs(10, 260, 30);

            new ModalMission(missionUI()).setMissionMessage(makeMission());

            // Seeded from the token's 30px it lands on 26. Seeded from a size copied into the source it would
            // start below what already fits and stamp that instead, silently ignoring the token.
            expect(parseFloat(title.style.fontSize)).toBe(26);
        });

        test('a title too long even at the floor wraps rather than shrinking into the unreadable', () => {
            measureAs(100, 320); // 1600px of text at the floor: no size in range fits.

            new ModalMission(missionUI()).setMissionMessage(makeMission());

            expect(parseFloat(title.style.fontSize)).toBe(16);
            expect(title.style.whiteSpace).toBe(''); // Cleared, so it wraps.
        });

        test('a later, shorter title is measured from the token size, not from the last one’s', () => {
            // Left to inherit the previous mission's stamped size, a short title would stay shrunk for good.
            const modal = new ModalMission(missionUI());
            measureAs(100, 320);
            modal.setMissionMessage(makeMission());
            expect(parseFloat(title.style.fontSize)).toBe(16);

            measureAs(8, 320);
            modal.setMissionMessage(makeMission());
            expect(title.style.fontSize).toBe('');
        });

        test('it fits again once the real face has loaded, since the first fit measured the fallback', async () => {
            let resolveFont;
            const load = jest.fn(() => new Promise((resolve) => { resolveFont = resolve; }));
            Object.defineProperty(document, 'fonts', {value: {load}, configurable: true});
            measureAs(8, 320); // The fallback face fits, so nothing is stamped...

            new ModalMission(missionUI()).setMissionMessage(makeMission());
            expect(title.style.fontSize).toBe('');
            expect(load).toHaveBeenCalledTimes(1);

            measureAs(16, 320); // ...and then the real face swaps in wider.
            resolveFont();
            await Promise.resolve();
            await Promise.resolve();

            expect(parseFloat(title.style.fontSize)).toBe(20);
            delete document.fonts;
        });

        test('a dead end that arrived while the face was loading keeps the heading’s own size', async () => {
            let resolveFont;
            const load = jest.fn(() => new Promise((resolve) => { resolveFont = resolve; }));
            Object.defineProperty(document, 'fonts', {value: {load}, configurable: true});
            measureAs(8, 320);
            new ModalMission(missionUI()).setMissionMessage(makeMission());

            svv.modalNoNewMission = {isShowing: () => true};
            measureAs(16, 320);
            resolveFont();
            await Promise.resolve();
            await Promise.resolve();

            expect(title.style.fontSize).toBe('');
            delete document.fonts;
        });
    });

    describe('scroll position across missions', () => {
        test('the briefing opens at the top, however far the last one was scrolled', () => {
            const modal = new ModalMission(missionUI());
            const foreground = document.getElementById('modal-mission-foreground');
            modal.setMissionMessage(makeMission());
            foreground.scrollTop = 240; // The validator read to the bottom of a long briefing.
            modal.hide();

            modal.setMissionMessage(makeMission());

            expect(foreground.scrollTop).toBe(0);
        });

        test('the mission-complete screen does too', () => {
            const modal = new ModalMissionComplete(completeUI(), {}, 'en');
            const foreground = document.getElementById('modal-mission-complete-foreground');
            modal.show(makeMission());
            foreground.scrollTop = 180;
            modal.hide();

            modal.show(makeMission());

            expect(foreground.scrollTop).toBe(0);
        });

        test('so does the dead end, which can replace a briefing that was scrolled', () => {
            const ui = missionUI();
            const foreground = document.getElementById('modal-mission-foreground');
            new ModalMission(ui).setMissionMessage(makeMission());
            foreground.scrollTop = 240;

            new ModalNoNewMission(ui).show();

            expect(foreground.scrollTop).toBe(0);
        });
    });

    describe('the mission-complete standing row', () => {
        /** Shows the screen for a validator with `total` all-time validations. @returns {Object} The UI bag. */
        function showWith(total) {
            svv.statusField.getCompletedValidations = () => total;
            const ui = completeUI();
            new ModalMissionComplete(ui, {}, 'en').show(makeMission());
            return ui;
        }

        test('reads the same progress as everything else that draws a badge', () => {
            showWith(175); // Halfway from Validator I (100) to Validator II (250).

            const {fraction, remaining} = BadgeAchievements.getProgress('validations', 175);
            expect(document.getElementById('mission-complete-badge-progress-fill').style.width)
                .toBe(`${(fraction * 100).toFixed(0)}%`);
            expect(document.getElementById('mission-complete-badge-next').textContent)
                .toContain(`"count":${remaining}`);
        });

        test('the fill is sized by the shared progress bar, the way this page’s mission bar is', () => {
            showWith(175);

            expect(document.getElementById('mission-complete-badge-progress-fill').style.width).toBe('50%');
        });

        test('someone with no badge yet still gets a line about the one they are working toward', () => {
            showWith(40);

            expect(document.getElementById('mission-complete-badge-icon').classList.contains('ps-hidden')).toBe(true);
            expect(document.getElementById('mission-complete-badge-name').textContent).toBe('');
            expect(document.getElementById('mission-complete-badge-next').textContent).toContain('next-badge');
            expect(document.getElementById('mission-complete-badge-progress-fill').style.width).toBe('40%');
        });

        test('a badge earned is shown, named, and its artwork loaded', () => {
            showWith(300);

            expect(document.getElementById('mission-complete-badge-icon').classList.contains('ps-hidden'))
                .toBe(false);
            expect(document.getElementById('mission-complete-badge-name').textContent).toContain('II');
            expect(document.getElementById('mission-complete-badge-icon').style.backgroundImage)
                .toContain('badge_validation_badge2.png');
        });

        test('the top badge fills the bar and says so, instead of counting down to nothing', () => {
            showWith(9999);

            expect(document.getElementById('mission-complete-badge-progress-fill').style.width).toBe('100%');
            expect(document.getElementById('mission-complete-badge-next').textContent).toBe('mission-complete.top-badge');
        });

        test('the count says what it counts, rather than leaving "overall total" to be guessed at', () => {
            showWith(1234);

            const line = document.getElementById('modal-mission-complete-your-overall-total-count').textContent;
            expect(line).toContain('mission-complete.all-time');
            expect(line).toContain('"count":1234');
        });

        test('desktop, whose screen has none of these elements, keeps the bare number its table column expects', () => {
            isMobile = false;

            showWith(1234);

            expect(document.getElementById('modal-mission-complete-your-overall-total-count').textContent)
                .toBe('1234');
        });
    });
});
