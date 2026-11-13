/**
 * Tests for the slides of the mission-start tutorial (frontend/js/common/MissionStartTutorial.js), the overlay Explore
 * and Validate open on a new mission to show a label type's right and wrong examples. Pinned here: paging through the
 * slides and what each one says, the differences between the two tools (Explore's own photos and its label-type tabs,
 * Validate's nudge toward Start on the last slide), what is logged, and the fade that hides the overlay (#5840).
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker } from './fakes.js';
import { renderMissionStartTutorial } from './support/pageChromeHarness.js';
import { textOf } from './support/routeFetch.js';

// Each translation reads as its key plus whichever values it was handed, so a test can see both.
mockModule('i18next', () => ({
  default: {
    t: (key, opts = {}) => [key, ...['labelType', 'nLabels', 'region'].filter((k) => k in opts)
      .map((k) => `${k}=${opts[k]}`)].join('|'),
  },
}));

let MissionStartTutorial;
let hooks;
let progress;

beforeEach(async () => {
  renderMissionStartTutorial();
  progress = 0;
  hooks = {
    tracker: fakeTracker(),
    keyboard: { enableKeyboard: vi.fn() },
    missionContainer: {
      getCurrentMission: () => ({
        getProperty: (key) => ({ distanceProgress: progress, missionId: 7, missionType: 'audit', regionId: 3 })[key],
        getDistance: () => 804.7,
      }),
    },
  };
  // A fresh class per test: the overlay's handlers are static, shared by every instance.
  ({ MissionStartTutorial } = await loadModules('frontend/js/common/MissionStartTutorial.js'));
});

/**
 * Opens Validate's tutorial, as validate/Main.js does on a new mission.
 * @param {string} [labelType] - The mission's label type.
 * @param {string} [language] - The page's language.
 */
const openValidate = (labelType = 'CurbRamp', language) => new MissionStartTutorial(
  'validate', labelType, { nLabels: 10 }, hooks, language,
);
/**
 * Opens Explore's tutorial, as explore/Main.js does on a new mission.
 * @param {object} [extra] - More mission data, e.g. `{ resuming: true }`.
 */
const openExplore = (extra = {}) => new MissionStartTutorial(
  'audit', 'CurbRamp', { nLength: 0.5, region: 'Downtown', resuming: false, ...extra }, hooks,
);

/** @param {string} selector - An element of the overlay. @returns {HTMLElement} It. */
const $ = (selector) => document.querySelector(selector);
const next = () => $('.next-slide-button').click();
const previous = () => $('.previous-slide-button').click();
/** @returns {string[]} The index each location dot stands for, the current one marked with a star. */
const dots = () => [...document.querySelectorAll('.mst-carousel-location-indicator')]
  .map((dot) => (dot.classList.contains('current-location') ? `*${dot.dataset.idx}` : dot.dataset.idx));
/** @returns {string[]} What the tracker was told, by action name. */
const logged = () => hooks.tracker.push.mock.calls.map(([action]) => action);

describe('the first slide', () => {
  it('shows the correct example, with the overlay up and nothing to page back to', () => {
    openValidate();

    expect($('.mission-start-tutorial-overlay').style.display).toBe('flex');
    expect($('.mst-slide').classList.contains('correct')).toBe(true);
    expect(textOf($('.example-type-label'))).toBe('common:mission-start-tutorial.example-type-label-correct');
    expect(textOf($('.label-type-title')))
      .toBe('common:mission-start-tutorial.curb-ramp.slide-1.title|labelType=common:curb-ramp');
    expect(textOf($('.label-type-subtitle'))).toBe('');
    expect($('.msts-image').getAttribute('src')).toBe('/assets/images/tutorials/curbramp-correct-1.png');
    expect($('.previous-slide-button').classList.contains('is-disabled')).toBe(true);
    expect($('.next-slide-button').classList.contains('is-disabled')).toBe(false);
    expect(dots()).toEqual(['*0', '1', '2']);
  });

  it('places the example\'s label on the photo, scaled with the tool', () => {
    openValidate();

    const label = $('.label-on-image');
    expect(label.style.display).toBe('block');
    expect(label.style.left).toBe('calc(237px * var(--ui-scale))');
    expect(label.style.top).toBe('calc(222px * var(--ui-scale))');
    expect(textOf($('.label-on-image-type-title'))).toBe('common:mission-start-tutorial.label-on-image-title-correct');
    expect(textOf($('.label-on-image-description')))
      .toBe('validate:mission-start-tutorial.label-on-image-description-correct');
  });

  it('tells a validator how many labels of which type the mission holds', () => {
    openValidate('Signal');

    expect(textOf($('.mst-instruction-1'))).toBe('validate:mission-start-tutorial.mst-instruction-1');
    expect(textOf($('.mst-instruction-2')))
      .toBe('validate:mission-start-tutorial.mst-instruction-2|labelType=common:signal|nLabels=10');
    expect(textOf($('.mission-start-tutorial-done-btn'))).toBe('common:mission-start-tutorial.start-mission');
  });

  it('tells an explorer which neighborhood the mission covers', () => {
    openExplore();

    expect(textOf($('.mst-instruction-1'))).toBe('audit:mission-start-tutorial.mst-instruction-1');
    expect(textOf($('.mst-instruction-2'))).toBe('audit:mission-start-tutorial.mst-instruction-2|region=Downtown');
  });

  it('offers to resume, not start, a mission that already has progress', () => {
    openExplore({ resuming: true });

    expect(textOf($('.mission-start-tutorial-done-btn'))).toBe('common:mission-start-tutorial.resume-mission');
  });
});

describe('paging through the slides', () => {
  it('moves on to a wrong example, saying what it shows instead', () => {
    openValidate();

    next();

    expect($('.mst-slide').classList.contains('incorrect')).toBe(true);
    expect($('.mst-slide').classList.contains('correct')).toBe(false);
    expect(textOf($('.example-type-label'))).toBe('validate:mission-start-tutorial.example-type-label-incorrect');
    expect(textOf($('.label-type-title'))).toBe('common:mission-start-tutorial.curb-ramp.slide-2.title');
    expect(textOf($('.label-type-subtitle'))).toBe('common:mission-start-tutorial.label-type-subtitle');
    expect(textOf($('.label-on-image-type-title')))
      .toBe('validate:mission-start-tutorial.label-on-image-title-incorrect');
    expect($('.msts-image').getAttribute('src')).toBe('/assets/images/tutorials/curbramp-incorrect-1.png');
    expect($('.previous-slide-button').classList.contains('is-disabled')).toBe(false);
    expect(dots()).toEqual(['0', '*1', '2']);
    expect(hooks.tracker.push).toHaveBeenCalledWith('NextSlideButton_Click', { currentSlideIdx: 1 }, null);
  });

  it('stops at the last slide and points a validator at the Start button', () => {
    openValidate();

    next();
    next();
    next();

    expect(dots()).toEqual(['0', '1', '*2']);
    expect($('.next-slide-button').classList.contains('is-disabled')).toBe(true);
    expect($('.mission-start-tutorial-done-btn').classList.contains('focus')).toBe(true);
    // The click on the disabled arrow is not logged.
    expect(logged()).toEqual(['NextSlideButton_Click', 'NextSlideButton_Click']);
  });

  it('leaves the Start button quiet on Explore\'s last slide, so the explorer tries the other label types', () => {
    openExplore();

    next();
    next();

    expect($('.next-slide-button').classList.contains('is-disabled')).toBe(true);
    expect($('.mission-start-tutorial-done-btn').classList.contains('focus')).toBe(false);
  });

  it('pages back, and not past the first slide', () => {
    openValidate();
    next();
    next();

    previous();
    expect(dots()).toEqual(['0', '*1', '2']);
    expect($('.mission-start-tutorial-done-btn').classList.contains('focus')).toBe(false);
    previous();
    previous();

    expect(dots()).toEqual(['*0', '1', '2']);
    expect(logged().filter((action) => action === 'PreviousSlideButton_Click')).toHaveLength(2);
    expect(hooks.tracker.push).toHaveBeenLastCalledWith('PreviousSlideButton_Click', { currentSlideIdx: 0 }, null);
  });

  it('shows Explore\'s own photos of the wrong examples', () => {
    openExplore();

    next();

    expect($('.msts-image').getAttribute('src')).toBe('/assets/images/tutorials/explore-curbramp-incorrect-1.png');
    expect(textOf($('.example-type-label'))).toBe('audit:mission-start-tutorial.example-type-label-incorrect');
  });
});

describe('the page\'s language', () => {
  it('nudges German\'s longer descriptions up to fit', () => {
    openValidate('CurbRamp', 'de');

    expect($('.label-on-image-description').style.transform).toBe('translateY(-16%)');
    expect($('.label-on-image').style.maxWidth).toBe('');
  });

  it('narrows the label for Dutch', () => {
    openValidate('CurbRamp', 'nl');

    expect($('.label-on-image').style.maxWidth).toBe('calc(230px * var(--ui-scale))');
    expect($('.label-on-image-description').style.transform).toBe('');
  });

  it('leaves the layout alone for English', () => {
    openValidate();

    expect($('.label-on-image').style.maxWidth).toBe('');
    expect($('.label-on-image-description').style.transform).toBe('');
  });
});

describe('Explore\'s label-type tabs', () => {
  it('shows the tabs, translated, with the mission\'s label type picked; Validate has none', () => {
    openValidate();
    expect($('.explore-mission-start-tab-bar').classList.contains('ps-hidden')).toBe(true);

    openExplore();

    expect($('.explore-mission-start-tab-bar').classList.contains('ps-hidden')).toBe(false);
    const tabs = [...document.querySelectorAll('.explore-mission-start-tab')];
    expect(tabs.map((tab) => textOf(tab))).toEqual(['common:curb-ramp', 'common:no-curb-ramp']);
    expect(tabs.map((tab) => tab.classList.contains('is-active'))).toEqual([true, false]);
  });

  it('teaches another label type from its tab, from its first slide, with one set of dots', () => {
    openExplore();
    next();

    $('.explore-mission-start-tab[data-label-type="NoCurbRamp"]').click();

    expect(dots()).toEqual(['*0', '1', '2', '3']);
    expect($('.msts-image').getAttribute('src')).toBe('/assets/images/tutorials/no-curbramp-correct-1.png');
    expect($('.explore-mission-start-tab[data-label-type="NoCurbRamp"]').classList.contains('is-active')).toBe(true);
    // The old instance's arrows are unhooked, so one click is one step and one log line.
    hooks.tracker.push.mockClear();
    next();
    expect(dots()).toEqual(['0', '*1', '2', '3']);
    expect(logged()).toEqual(['NextSlideButton_Click']);
  });
});

describe('closing', () => {
  it('logs the explorer\'s mission start only for a mission that has not begun', () => {
    progress = 120;
    openExplore();

    $('.mission-start-tutorial-done-btn').click();

    expect(logged()).toEqual(['MSTDoneButton_Click']);
  });

  it('logs the mission\'s size and place when it starts', () => {
    openExplore();

    $('.mission-start-tutorial-done-btn').click();

    expect(hooks.tracker.push).toHaveBeenCalledWith('MissionStart', {
      missionId: 7, missionType: 'audit', distanceMeters: 805, regionId: 3,
    });
  });

  it('fades the overlay out before hiding it, and shows it again whole on the next mission', () => {
    const overlay = $('.mission-start-tutorial-overlay');
    const tabBar = $('.explore-mission-start-tab-bar');
    const fades = [];
    // jsdom has no Web Animations API, so the two elements get just enough of one for the fade.
    for (const el of [overlay, tabBar]) {
      const running = [];
      el.getAnimations = () => running;
      el.animate = () => {
        const fade = new EventTarget();
        fade.cancel = vi.fn(() => running.splice(running.indexOf(fade), 1));
        running.push(fade);
        fades.push(fade);
        return fade;
      };
    }
    openExplore();

    $('.mission-start-tutorial-done-btn').click();
    expect(overlay.style.display).toBe('flex');
    // A second click before the fade ends starts it over rather than stacking another.
    $('.mission-start-tutorial-done-btn').click();
    expect(fades[0].cancel).toHaveBeenCalled();

    fades[2].dispatchEvent(new Event('finish'));
    fades[3].dispatchEvent(new Event('finish'));
    expect(overlay.style.display).toBe('none');
    expect(tabBar.classList.contains('ps-hidden')).toBe(true);
    expect(fades[2].cancel).toHaveBeenCalled();

    // A fade still running when the next mission opens would hide it again, so it is stopped.
    $('.mission-start-tutorial-done-btn').click();
    openExplore();
    expect(fades[4].cancel).toHaveBeenCalled();
    expect(overlay.style.display).toBe('flex');
  });
});

describe('MissionStartTutorial.slidesFor', () => {
  it('gives mobile Validate the same slides, on the frame they are placed in', () => {
    const slides = MissionStartTutorial.slidesFor('validate', 'NoSidewalk');

    expect(slides.map((slide) => slide.isExampleCorrect)).toEqual([true, false, false]);
    expect(slides[1]).toEqual({
      isExampleCorrect: false,
      slideTitle: 'common:mission-start-tutorial.no-sidewalk.slide-2.title',
      slideSubtitle: 'common:mission-start-tutorial.label-type-subtitle',
      slideDescription: 'common:mission-start-tutorial.no-sidewalk.slide-2.description',
      imageURL: '/assets/images/tutorials/no-sidewalk-incorrect-1.png',
      labelOnImage: { position: { left: '352px', top: '312px' } },
    });
    expect(MissionStartTutorial.EXAMPLE_PHOTO).toEqual({ width: 658, height: 436 });
  });
});
