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
 * Also the buttons on those screens and on the dead end (ModalNoNewMission) that takes the briefing's markup over, on
 * both layouts, since where each one leads differs between them (#5840).
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeGate, fakeTracker, navigationAttempts } from './fakes.js';

mockModule('i18next', () => ({ default: {
  // Echo the key plus any interpolation, so assertions can name what a slot was filled with.
  t: (key, opts) => (opts ? `${key}|${JSON.stringify(opts)}` : key),
} }));

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

/** The briefing reads the tutorial's slides and photo frame; the desktop completion raises one, and needs no more. */
class FakeMissionStartTutorial {
  static EXAMPLE_PHOTO = {width: 658, height: 436};

  static slidesFor = vi.fn(() => SLIDES);
}
mockModule('frontend/js/common/MissionStartTutorial.js', () => ({MissionStartTutorial: FakeMissionStartTutorial}));
// jsdom has no canvas to burst confetti on.
const confettiBurst = vi.fn();
mockModule('frontend/js/common/Confetti.js', () => ({Confetti: {burst: confettiBurst}}));

const {ModalMission, ModalMissionComplete, ModalNoNewMission, BadgeAchievements, Gate} = await loadModules(
  'frontend/js/validate/modal/ModalMission.js', 'frontend/js/validate/modal/ModalMissionComplete.js',
  'frontend/js/validate/modal/ModalNoNewMission.js', 'frontend/js/common/BadgeAchievements.js',
  'frontend/js/common/Gate.js',
);

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
  let deadEndShowing;
  const keyboardLock = fakeGate();
  const modalNoNewMission = {isShowing: () => deadEndShowing};
  const statusField = {getCompletedValidations: () => 0};
  const panoManager = {replayMarkerPulse: vi.fn()};

  beforeEach(() => {
    isMobile = true;
    deadEndShowing = false;
    tracker = fakeTracker();
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

    useUtil({isMobile: () => isMobile});
    FakeMissionStartTutorial.slidesFor = vi.fn(() => SLIDES);
    // The real one counts missions toward a badge toast; nothing here is about that.
    vi.spyOn(BadgeAchievements, 'recordMissionComplete').mockImplementation(() => {});
    window.matchMedia = vi.fn(() => ({matches: false}));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** @returns {ModalMission} A briefing wired the way Main.js wires it. */
  const briefing = () => new ModalMission(missionUI(), modalNoNewMission, tracker);

  /** @returns {ModalMissionComplete} A mission-complete screen wired the way Main.js wires it, for the phone. */
  const completion = (ui = completeUI()) =>
    new ModalMissionComplete(ui, 'en', null, keyboardLock, statusField, panoManager, tracker);

  /** The UI element bag Main.js builds for the mission modal. @returns {Object} */
  const missionUI = () => ({
    holder: document.getElementById('modal-mission-holder'),
    foreground: document.getElementById('modal-mission-foreground'),
    background: document.getElementById('modal-mission-background'),
    eyebrow: document.getElementById('modal-mission-eyebrow'),
    missionTitle: document.getElementById('modal-mission-header'),
    instruction: document.getElementById('modal-mission-instruction'),
    closeButton: document.getElementById('modal-mission-close-button'),
  });

  /** The UI element bag Main.js builds for the mission-complete modal. @returns {Object} */
  const completeUI = () => ({
    holder: document.getElementById('modal-mission-complete-holder'),
    foreground: document.getElementById('modal-mission-complete-foreground'),
    background: document.getElementById('modal-mission-complete-background'),
    closeButtonPrimary: document.getElementById('modal-mission-complete-close-button-primary'),
    closeButtonSecondary: document.getElementById('modal-mission-complete-close-button-secondary'),
    agreeCount: document.getElementById('modal-mission-complete-agree-count'),
    disagreeCount: document.getElementById('modal-mission-complete-disagree-count'),
    unsureCount: document.getElementById('modal-mission-complete-unsure-count'),
    message: document.getElementById('modal-mission-complete-message'),
    missionTitle: document.getElementById('modal-mission-complete-title'),
    labelIcon: document.getElementById('mission-complete-label-icon'),
    badgeIcon: document.getElementById('mission-complete-badge-icon'),
    badgeName: document.getElementById('mission-complete-badge-name'),
    badgeProgressFill: document.getElementById('mission-complete-badge-progress-fill'),
    badgeNext: document.getElementById('mission-complete-badge-next'),
    yourOverallTotalCount: document.getElementById('modal-mission-complete-your-overall-total-count'),
  });

  describe('the briefing’s examples carousel', () => {
    beforeEach(() => {
      briefing().setMissionMessage(makeMission());
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

      briefing().setMissionMessage(makeMission());

      expect(FakeMissionStartTutorial.slidesFor).not.toHaveBeenCalled();
      expect(document.querySelector('.mv-examples')).toBeNull();
      expect(document.querySelectorAll('#modal-mission-instruction img')).toHaveLength(0);
    });

    test('titles the screen without the phone’s eyebrow, which desktop’s markup lacks', () => {
      isMobile = false;
      const ui = {...missionUI(), eyebrow: null};

      new ModalMission(ui, modalNoNewMission, tracker).setMissionMessage(makeMission());

      expect(ui.missionTitle.innerHTML).toContain('mst-instruction-2');
      expect(document.getElementById('modal-mission-eyebrow').innerHTML).toBe('');
    });

    test('leaves no shrunk-to-one-line sizing on a heading it never measured', () => {
      isMobile = false;

      briefing().setMissionMessage(makeMission());

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

      briefing().setMissionMessage(makeMission());

      expect(title.style.fontSize).toBe('');
      expect(title.style.whiteSpace).toBe('nowrap');
    });

    test('a title that overflows is shrunk only as far as it has to be', () => {
      measureAs(16, 320); // 384px of text in a 320px box: 20px is the first size that fits.

      briefing().setMissionMessage(makeMission());

      expect(parseFloat(title.style.fontSize)).toBe(20);
      expect(title.style.whiteSpace).toBe('nowrap');
    });

    test('the starting size is the stylesheet’s, so retuning the heading token carries this heading too', () => {
      // 10px of text per px of font size, in a 260px box: it fits at 26px and no larger.
      measureAs(10, 260, 30);

      briefing().setMissionMessage(makeMission());

      // Seeded from the token's 30px it lands on 26. Seeded from a size copied into the source it would
      // start below what already fits and stamp that instead, silently ignoring the token.
      expect(parseFloat(title.style.fontSize)).toBe(26);
    });

    test('a title that fits only at the floor stays on one line there', () => {
      measureAs(20, 320); // 320px of text at 16px, in a 320px box.

      briefing().setMissionMessage(makeMission());

      expect(parseFloat(title.style.fontSize)).toBe(16);
      expect(title.style.whiteSpace).toBe('nowrap');
    });

    test('a title too long even at the floor wraps rather than shrinking into the unreadable', () => {
      measureAs(100, 320); // 1600px of text at the floor: no size in range fits.

      briefing().setMissionMessage(makeMission());

      expect(parseFloat(title.style.fontSize)).toBe(16);
      expect(title.style.whiteSpace).toBe(''); // Cleared, so it wraps.
    });

    test('a later, shorter title is measured from the token size, not from the last one’s', () => {
      // Left to inherit the previous mission's stamped size, a short title would stay shrunk for good.
      const modal = briefing();
      measureAs(100, 320);
      modal.setMissionMessage(makeMission());
      expect(parseFloat(title.style.fontSize)).toBe(16);

      measureAs(8, 320);
      modal.setMissionMessage(makeMission());
      expect(title.style.fontSize).toBe('');
    });

    test('it fits again once the real face has loaded, since the first fit measured the fallback', async () => {
      let resolveFont;
      const load = vi.fn(() => new Promise((resolve) => { resolveFont = resolve; }));
      Object.defineProperty(document, 'fonts', {value: {load}, configurable: true});
      measureAs(8, 320); // The fallback face fits, so nothing is stamped...

      briefing().setMissionMessage(makeMission());
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
      const load = vi.fn(() => new Promise((resolve) => { resolveFont = resolve; }));
      Object.defineProperty(document, 'fonts', {value: {load}, configurable: true});
      measureAs(8, 320);
      briefing().setMissionMessage(makeMission());

      deadEndShowing = true;
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
      const modal = briefing();
      const foreground = document.getElementById('modal-mission-foreground');
      modal.setMissionMessage(makeMission());
      foreground.scrollTop = 240; // The validator read to the bottom of a long briefing.
      modal.hide();

      modal.setMissionMessage(makeMission());

      expect(foreground.scrollTop).toBe(0);
    });

    test('the mission-complete screen does too', () => {
      const modal = completion();
      const foreground = document.getElementById('modal-mission-complete-foreground');
      modal.show(makeMission(), 1);
      foreground.scrollTop = 180;
      modal.hide();

      modal.show(makeMission(), 2);

      expect(foreground.scrollTop).toBe(0);
    });

    test('so does the dead end, which can replace a briefing that was scrolled', () => {
      const ui = missionUI();
      const foreground = document.getElementById('modal-mission-foreground');
      new ModalMission(ui, modalNoNewMission, tracker).setMissionMessage(makeMission());
      foreground.scrollTop = 240;

      new ModalNoNewMission(ui, keyboardLock, tracker).show();

      expect(foreground.scrollTop).toBe(0);
    });
  });

  describe('the mission-complete standing row', () => {
    /** Shows the screen for a validator with `total` all-time validations. @returns {Object} The UI bag. */
    function showWith(total) {
      statusField.getCompletedValidations = () => total;
      const ui = completeUI();
      completion(ui).show(makeMission(), 1);
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
        .toContain('badge_validation_badge2.svg');
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

  describe('the keyboard behind the mission-complete screen (#5752)', () => {
    let lock;
    let hooks;

    beforeEach(() => {
      isMobile = false;
      lock = new Gate();
      hooks = {tracker, keyboard: {enableKeyboard: () => lock.release('tutorial')}};
    });

    /** @returns {{ui: Object, screen: ModalMissionComplete}} A screen up, with the next mission behind it. */
    function screenUp() {
      const ui = completeUI();
      const screen = new ModalMissionComplete(ui, 'en', hooks, lock, statusField, panoManager, tracker);
      screen.show(makeMission(), 1);
      screen.nextMissionLoaded(makeMission());
      return {ui, screen};
    }

    test('the next label finishing its load behind the screen does not wake the shortcuts', () => {
      screenUp();

      // As KeyboardManager relays the load of the next mission's first label.
      lock.hold('loading');
      lock.release('loading');

      expect(lock.isHeld()).toBe(true);
    });

    test('closing the screen hands the pause to the next tutorial, and only its Done lets it go', () => {
      const {ui} = screenUp();

      ui.closeButtonSecondary.click();
      expect(lock.isHeld()).toBe(true);

      hooks.keyboard.enableKeyboard();
      expect(lock.isHeld()).toBe(false);
    });

    test('on the phone, with no tutorial to raise, closing the screen is what lets the pause go', () => {
      isMobile = true;
      const ui = completeUI();
      const screen = new ModalMissionComplete(ui, 'en', null, lock, statusField, panoManager, tracker);
      screen.show(makeMission(), 1);
      screen.nextMissionLoaded(makeMission());

      ui.closeButtonSecondary.click();

      expect(lock.isHeld()).toBe(false);
    });
  });

  describe('the briefing’s start button', () => {
    test('a fresh mission logs its start, and the briefing goes away', () => {
      briefing().setMissionMessage(makeMission({missionId: 9, labelsValidated: 10, labelsProgress: 0}));

      document.getElementById('modal-mission-close-button').click();

      expect(tracker.push).toHaveBeenCalledWith('MissionStart', {
        missionId: 9, missionType: 'validation', labelType: 'CurbRamp', labelsValidated: 10,
      });
      expect(document.getElementById('modal-mission-holder').style.visibility).toBe('hidden');
    });

    test('a mission resumed partway through does not log a second start', () => {
      briefing().setMissionMessage(makeMission({labelsProgress: 4}));

      document.getElementById('modal-mission-close-button').click();

      expect(tracker.push).not.toHaveBeenCalledWith('MissionStart', expect.anything());
      expect(document.getElementById('modal-mission-holder').style.visibility).toBe('hidden');
    });

    test('heads the screen with the mission type’s own marker', () => {
      briefing().setMissionMessage(makeMission());

      expect(document.querySelector('#modal-mission-eyebrow img').getAttribute('src'))
        .toContain('label_type_icons/CurbRamp_small.svg');
    });

    test('never paints over a dead end that already took the screen', () => {
      deadEndShowing = true;
      const instruction = document.getElementById('modal-mission-instruction');
      instruction.textContent = 'no more labels';

      briefing().setMissionMessage(makeMission());

      expect(instruction.textContent).toBe('no more labels');
      expect(document.getElementById('modal-mission-close-button').onclick).toBeNull();
    });
  });

  describe('swiping the examples', () => {
    let strip;

    /**
     * Scrolls the strip to a position, as a swipe would; jsdom lays nothing out, so the strip's size is stated.
     * @param {number} scrollLeft - How far along the strip has been scrolled, in px.
     * @param {number} [width] - The strip's width, one example's worth.
     */
    function swipeTo(scrollLeft, width = 300) {
      Object.defineProperty(strip, 'scrollLeft', {value: scrollLeft, configurable: true});
      Object.defineProperty(strip, 'clientWidth', {value: width, configurable: true});
      strip.dispatchEvent(new Event('scroll'));
    }

    /** @returns {number} Which dot is marked current. */
    const currentDot = () => [...document.querySelectorAll('.mv-dot')]
      .findIndex((dot) => dot.classList.contains('mv-dot--current'));

    beforeEach(() => {
      briefing().setMissionMessage(makeMission());
      strip = document.querySelector('.mv-examples');
    });

    test('moves the current dot to the example swiped to, and logs that it was reached', () => {
      swipeTo(310);

      expect(currentDot()).toBe(1);
      expect(tracker.push).toHaveBeenCalledWith('MSTSlide_Swipe', {currentSlideIdx: 1});
    });

    test('a scroll that settles on the same example logs nothing more', () => {
      swipeTo(310);
      tracker.push.mockClear();

      swipeTo(290);

      expect(tracker.push).not.toHaveBeenCalled();
      expect(currentDot()).toBe(1);
    });

    test('a strip with no width yet, so no example to point at, leaves the dots alone', () => {
      swipeTo(0, 0);

      expect(tracker.push).not.toHaveBeenCalled();
      expect(currentDot()).toBe(0);
    });
  });

  describe('the dead end', () => {
    /** @returns {ModalNoNewMission} The dead end, wired the way Main.js wires it. */
    const deadEnd = () => new ModalNoNewMission(missionUI(), keyboardLock, tracker);
    const button = () => document.getElementById('modal-mission-close-button');

    test('on desktop, says there is nothing left here and sends the validator to Explore', () => {
      isMobile = false;
      const navigations = navigationAttempts();
      const modal = deadEnd();

      modal.show();

      expect(modal.isShowing()).toBe(true);
      expect(keyboardLock.hold).toHaveBeenCalledWith('no-mission');
      expect(document.getElementById('modal-mission-header').innerHTML).toBe('mission-complete.no-new-mission-title');
      expect(document.getElementById('modal-mission-instruction').textContent)
        .toContain('mission-complete.no-new-mission-body');
      expect(button().innerHTML).toBe('mission-complete.no-new-mission-button');
      expect(button().style.width).toBe('fit-content');

      button().click();

      expect(tracker.push).toHaveBeenCalledWith('Click_NoMoreMissionModal_Audit');
      expect(navigations).toHaveBeenCalledTimes(1);
    });

    test('on the phone, sends the validator to Seattle’s Validate, on a button already full width', () => {
      const navigations = navigationAttempts();
      deadEnd().show();

      expect(document.getElementById('modal-mission-instruction').textContent).toContain('mobile.no-new-mission-body');
      expect(button().innerHTML).toBe('mobile.no-new-mission-button Seattle, WA');
      expect(button().style.width).toBe('');
      // The briefing's eyebrow would sit over a sentence that has no mission to introduce.
      expect(document.getElementById('modal-mission-eyebrow').childNodes).toHaveLength(0);

      button().click();

      expect(tracker.push).toHaveBeenCalledWith('Click_NoMoreMissionModal_ValidateSeattle');
      expect(navigations).toHaveBeenCalledTimes(1);
    });

    test('when the imagery would not load, offers a retry that reloads the page', () => {
      const navigations = navigationAttempts();
      deadEnd().show({imageryUnavailable: true});

      expect(document.getElementById('modal-mission-header').innerHTML).toBe('imagery-unavailable.title');
      expect(document.getElementById('modal-mission-instruction').textContent).toContain('imagery-unavailable.body');
      expect(button().innerHTML).toBe('imagery-unavailable.retry');

      button().click();

      expect(tracker.push).toHaveBeenCalledWith('Click_ImageryUnavailableModal_Retry');
      expect(navigations).toHaveBeenCalledTimes(1);
    });

    test('is not showing until it is shown', () => {
      expect(deadEnd().isShowing()).toBe(false);
    });
  });

  describe('the mission-complete buttons', () => {
    const primary = () => document.getElementById('modal-mission-complete-close-button-primary');
    const secondary = () => document.getElementById('modal-mission-complete-close-button-secondary');

    /**
     * Puts the screen up for the nth mission this page finished, with the next mission behind it.
     * @param {number} missionsCompleted - Missions finished on this page, this one included.
     * @returns {ModalMissionComplete} The screen.
     */
    function finish(missionsCompleted) {
      const modal = completion();
      modal.show(makeMission(), missionsCompleted);
      modal.nextMissionLoaded(makeMission());
      return modal;
    }

    test('every third mission on desktop offers Explore beside carrying on, and Explore leaves the page', () => {
      isMobile = false;
      const navigations = navigationAttempts();
      const modal = finish(3);

      expect(primary().innerHTML).toBe('mission-complete.explore');
      expect(secondary().innerHTML).toBe('mission-complete.continue');
      expect(secondary().classList.contains('ps-hidden')).toBe(false);

      primary().click();

      expect(navigations).toHaveBeenCalledTimes(1);
      expect(modal.isShowing()).toBe(true);
    });

    test('other missions on desktop offer one button, to validate more, which closes the screen', () => {
      isMobile = false;
      const navigations = navigationAttempts();
      const modal = finish(2);

      expect(primary().innerHTML).toBe('mission-complete.validate-more');
      expect(secondary().classList.contains('ps-hidden')).toBe(true);

      primary().click();

      expect(navigations).not.toHaveBeenCalled();
      expect(modal.isShowing()).toBe(false);
      expect(panoManager.replayMarkerPulse).toHaveBeenCalled();
    });

    test('the phone never sends the validator off to Explore, even on a third mission', () => {
      const navigations = navigationAttempts();
      const modal = finish(3);

      expect(primary().innerHTML).toBe('mission-complete.validate-more');

      primary().click();

      expect(navigations).not.toHaveBeenCalled();
      expect(modal.isShowing()).toBe(false);
    });
  });

  describe('the mission-complete celebration', () => {
    const celebration = () => document.getElementById('mission-complete-celebration');

    test('plays the fireworks and confetti, and buzzes where the phone can', () => {
      const vibrate = vi.fn();
      Object.defineProperty(navigator, 'vibrate', {value: vibrate, configurable: true});

      completion().show(makeMission(), 1);

      expect(celebration().classList.contains('mv-celebrate--play')).toBe(true);
      expect(vibrate).toHaveBeenCalled();
      expect(confettiBurst).toHaveBeenCalled();
      delete navigator.vibrate;
    });

    test('a visitor who asked for less motion gets none of it', () => {
      window.matchMedia = vi.fn((query) => ({matches: query === '(prefers-reduced-motion: reduce)'}));

      completion().show(makeMission(), 1);

      expect(celebration().classList.contains('mv-celebrate--play')).toBe(false);
      expect(confettiBurst).not.toHaveBeenCalled();
    });

    test('desktop’s screen, with no fireworks, label icon or badge, still shows the tally', () => {
      isMobile = false;
      celebration().remove();
      const ui = {...completeUI(), labelIcon: null, badgeIcon: null};
      statusField.getCompletedValidations = () => 42;

      completion(ui).show(makeMission(), 1);

      expect(confettiBurst).not.toHaveBeenCalled();
      expect(document.getElementById('modal-mission-complete-agree-count').textContent).toBe('6');
      expect(document.getElementById('mission-complete-label-icon').style.backgroundImage).toBe('');
      expect(document.getElementById('modal-mission-complete-your-overall-total-count').textContent).toBe('42');
      expect(document.getElementById('mission-complete-badge-name').textContent).toBe('');
    });
  });
});
