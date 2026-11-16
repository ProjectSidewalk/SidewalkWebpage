/**
 * Tests for the desktop landing page's script (frontend/js/homepage.js, #5840): the how-it-works video tabs and
 * their auto-advance, the click logging, the shrinking navbar, the stats count-up, playing videos only while on
 * screen, and warming the hidden videos once the page is idle. jsdom has no media playback or IntersectionObserver,
 * so both are faked here.
 */

import { loadModules, useUtil } from './loader.js';

/** Every IntersectionObserver the page made, oldest first. */
let observers;

/** Stands in for IntersectionObserver, letting a test say when a watched element enters or leaves the screen. */
class FakeIntersectionObserver {
  /**
   * @param {IntersectionObserverCallback} callback - What the page runs on a visibility change.
   * @param {IntersectionObserverInit} [options] - The page's thresholds.
   */
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = [];
    this.disconnected = false;
    observers.push(this);
  }

  /** @param {Element} el - The element to watch. */
  observe(el) { this.targets.push(el); }

  disconnect() { this.disconnected = true; }
}

/**
 * Tells the observer watching `el` that it scrolled in or out of view.
 * @param {string} id - The watched element's id.
 * @param {boolean} isIntersecting - Whether it's now on screen.
 */
function setVisible(id, isIntersecting) {
  const el = document.getElementById(id);
  const observer = observers.find((o) => o.targets.includes(el));
  observer.callback([{ target: el, isIntersecting }], observer);
}

/**
 * Gives a jsdom video the playback surface the page uses, recording what it was told to do.
 * @param {HTMLVideoElement} video - The element to fake.
 * @param {() => Promise<void>} [play] - What play() answers with.
 */
function fakeMedia(video, play = () => Promise.resolve()) {
  let paused = true;
  let currentTime = 0;
  video.calls = [];
  Object.defineProperties(video, {
    paused: { get: () => paused, configurable: true },
    currentTime: { get: () => currentTime, set: (t) => { currentTime = t; }, configurable: true },
  });
  video.play = () => { video.calls.push('play'); paused = false; return play(); };
  video.pause = () => { video.calls.push('pause'); paused = true; };
  video.load = () => { video.calls.push('load'); };
}

/** The parts of index.scala.html and the navbar the script binds to. */
const PAGE = `
  <nav id="header" class="header--tall"></nav>
  <div id="vidbanner"><video id="bgvid"></video></div>
  <a id="landing-cta-button">Start</a>
  <a id="new-deployment-link">New city</a>
  <div id="firstnumbox" role="button" tabindex="0"><span id="number1">01</span><span id="word1">Explore</span></div>
  <div id="secondnumbox" role="button" tabindex="0"><span id="number2">02</span><span id="word2">Find</span></div>
  <div id="thirdnumbox" role="button" tabindex="0"><span id="number3">03</span><span id="word3">Assess</span></div>
  <div id="instructionvideo">
    <video id="vid1" class="ps-hidden"></video>
    <video id="vid2" class="ps-hidden" preload="none"></video>
    <video id="vid3" class="ps-hidden" preload="none"></video>
  </div>
  <div id="stats">
    <span data-count-to="83.4" data-count-decimals="1">83.4</span>
    <span data-count-to="1234">1,234</span>
  </div>
  <div id="partners-container">
    <a data-partner-source="makeability-lab"><img alt="Makeability Lab"></a>
    <a data-partner-source="">Unnamed</a>
    <p id="partner-blurb">Not a link</p>
  </div>`;

let logged;
/** The idle callback warmHiddenInstructionVideos handed util.afterLoadIdle, if any. */
let idleCallback;
/** Whether the visitor asked to save data. */
let saveData;
/** Whether the visitor prefers reduced motion. */
let reducedMotion;
/** Pending requestAnimationFrame callbacks. */
let frames;

/**
 * Builds the page and runs the script, the way AppManager would once it's ready.
 * @param {object} [options] - Tweaks to the page before the script runs.
 * @param {boolean} [options.mapathon] - Whether the city has a mapathon link.
 * @param {(video: HTMLVideoElement) => Promise<void>} [options.play] - What every video's play() answers with.
 */
async function loadPage({ mapathon = false, play } = {}) {
  document.body.innerHTML = PAGE;
  if (mapathon) document.body.insertAdjacentHTML('beforeend', '<a id="mapathonLink">Mapathon</a>');
  for (const video of document.querySelectorAll('video')) fakeMedia(video, play);
  await loadModules('frontend/js/homepage.js');
}

/**
 * @param {number} n - Which how-it-works video, 1-based.
 * @returns {HTMLVideoElement} That video.
 */
const vid = (n) => document.getElementById(`vid${n}`);

/** @returns {number} Which how-it-works video is showing, 1-based. */
const shownStep = () => [1, 2, 3].find((n) => !vid(n).classList.contains('ps-hidden'));

beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  logged = [];
  frames = [];
  idleCallback = null;
  saveData = false;
  reducedMotion = false;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb));
  vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduce') && reducedMotion }));
  window.appManager = { ready: (cb) => cb() };
  window.logWebpageActivity = (activity) => logged.push(activity);
  document.documentElement.lang = 'en';
  useUtil({ saveDataEnabled: () => saveData, afterLoadIdle: (cb) => { idleCallback = cb; } });
});

afterEach(() => {
  // The page's auto-advance interval would otherwise keep ticking into the next test.
  vi.clearAllTimers();
  window.scrollY = 0;
});

describe('how-it-works tabs', () => {
  test('the first video shows with its tab highlighted, and plays only once the section is on screen', async () => {
    await loadPage();

    expect(shownStep()).toBe(1);
    for (const id of ['firstnumbox', 'word1', 'number1']) {
      expect(document.getElementById(id).classList.contains('activetab')).toBe(true);
    }
    expect(document.getElementById('secondnumbox').classList.contains('activetab')).toBe(false);
    expect(vid(1).calls).not.toContain('play');

    setVisible('instructionvideo', true);
    expect(vid(1).calls).toContain('play');
    setVisible('instructionvideo', false);
    expect(vid(1).calls.at(-1)).toBe('pause');
  });

  test('clicking a tab switches to its video from the start, logs the tab, and stops auto-advance', async () => {
    await loadPage();
    setVisible('instructionvideo', true);
    vid(3).currentTime = 9;

    document.getElementById('thirdnumbox').click();

    expect(shownStep()).toBe(3);
    expect(vid(3).currentTime).toBe(0);
    expect(vid(3).calls).toContain('play');
    expect(vid(1).calls.at(-1)).toBe('pause');
    expect(document.getElementById('word3').classList.contains('activetab')).toBe(true);
    expect(document.getElementById('word1').classList.contains('activetab')).toBe(false);
    expect(logged).toEqual(['Click_module=HowYouCanHelp_tab=3']);

    vi.advanceTimersByTime(60_000);
    expect(shownStep()).toBe(3);
  });

  test('Enter or Space on a tab switches to it; other keys, held keys and shortcuts don\'t', async () => {
    await loadPage();
    const tab = document.getElementById('secondnumbox');
    const press = (init) => {
      const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
      tab.dispatchEvent(event);
      return event;
    };

    for (const init of [{ key: 'a' }, { key: 'Enter', repeat: true }, { key: 'Enter', ctrlKey: true },
      { key: ' ', altKey: true }, { key: ' ', metaKey: true }]) {
      expect(press(init).defaultPrevented).toBe(false);
    }
    expect(shownStep()).toBe(1);
    expect(logged).toEqual([]);

    // Space would otherwise scroll the page.
    expect(press({ key: ' ' }).defaultPrevented).toBe(true);
    expect(shownStep()).toBe(2);
    press({ key: 'Enter' });
    expect(logged).toEqual(['Click_module=HowYouCanHelp_tab=2', 'Click_module=HowYouCanHelp_tab=2']);
  });

  test('on screen, each video gets its own time before the next one, wrapping back to the first', async () => {
    await loadPage();
    // Off screen, nothing advances.
    vi.advanceTimersByTime(60_000);
    expect(shownStep()).toBe(1);

    setVisible('instructionvideo', true);
    vi.advanceTimersByTime(18 * 500 - 1);
    expect(shownStep()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(shownStep()).toBe(2);
    vi.advanceTimersByTime(22 * 500);
    expect(shownStep()).toBe(3);
    vi.advanceTimersByTime(17 * 500);
    expect(shownStep()).toBe(1);
  });

  test('a play interrupted by a pause is swallowed rather than surfacing as an error', async () => {
    const rejected = vi.fn();
    await loadPage({ play: () => Promise.reject(new DOMException('interrupted', 'AbortError')) });
    process.on('unhandledRejection', rejected);
    setVisible('instructionvideo', true);
    setVisible('vidbanner', true);
    await vi.advanceTimersByTimeAsync(0);
    process.off('unhandledRejection', rejected);
    expect(rejected).not.toHaveBeenCalled();
  });
});

describe('the banner video', () => {
  test('plays while on screen and pauses once scrolled away', async () => {
    await loadPage();
    const banner = document.getElementById('bgvid');
    setVisible('vidbanner', true);
    expect(banner.calls).toEqual(['play']);
    setVisible('vidbanner', false);
    expect(banner.calls).toEqual(['play', 'pause']);
  });
});

describe('click logging', () => {
  test('the calls to action and the mapathon link each log where they were clicked', async () => {
    await loadPage({ mapathon: true });
    for (const id of ['landing-cta-button', 'new-deployment-link', 'mapathonLink']) document.getElementById(id).click();
    expect(logged).toEqual([
      'Click_module=StartExploring_location=Index',
      'Click_module=NewCity_location=Index',
      'Click_module=mapathonLink',
    ]);
  });

  test('a partner logo click logs the partner, an unnamed one logs as unknown, and other clicks log nothing',
    async () => {
      await loadPage();
      const partners = document.getElementById('partners-container');
      partners.querySelector('img').click();
      partners.querySelector('a[data-partner-source=""]').click();
      document.getElementById('partner-blurb').click();
      expect(logged).toEqual(['Click_module=Partner_source=makeability-lab', 'Click_module=Partner_source=unknown']);
    });
});

describe('the navbar', () => {
  test('is tall at the top of the page and shrinks once the visitor scrolls', async () => {
    window.scrollY = 50;
    await loadPage();
    const header = document.getElementById('header');
    expect(header.classList.contains('header--tall')).toBe(false);

    window.scrollY = 0;
    window.dispatchEvent(new Event('scroll'));
    expect(header.classList.contains('header--tall')).toBe(true);
    window.scrollY = 21;
    window.dispatchEvent(new Event('scroll'));
    expect(header.classList.contains('header--tall')).toBe(false);
  });
});

describe('the stats count-up', () => {
  test('starts from zero and counts up to the real numbers once fully on screen', async () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    await loadPage();
    const [rate, labels] = document.querySelectorAll('[data-count-to]');
    expect(rate.textContent).toBe('0.0');
    expect(labels.textContent).toBe('0');

    const observer = observers.find((o) => o.targets.includes(rate));
    expect(observer.options).toEqual({ threshold: 1 });
    observer.callback([{ target: rate, isIntersecting: false }], observer);
    expect(frames).toEqual([]);

    observer.callback([{ target: rate, isIntersecting: true }], observer);
    expect(observer.disconnected).toBe(true);
    now += 1250;
    frames.shift()();
    // Halfway through the time it's already past 99% of the way, since it eases out.
    expect(Number(labels.textContent.replace(/,/g, ''))).toBeGreaterThan(1220);
    expect(frames).toHaveLength(1);

    now += 1250;
    frames.shift()();
    expect(rate.textContent).toBe('83.4');
    expect(labels.textContent).toBe('1,234');
    expect(frames).toEqual([]);
  });

  test('a visitor who prefers reduced motion just sees the numbers the server wrote', async () => {
    reducedMotion = true;
    await loadPage();
    expect(document.querySelector('[data-count-to="1234"]').textContent).toBe('1,234');
    expect(observers.some((o) => o.options?.threshold === 1)).toBe(false);
  });
});

describe('warming the hidden videos', () => {
  test('once the page is idle, the untouched hidden videos start downloading', async () => {
    await loadPage();
    expect(vid(2).calls).not.toContain('load');
    idleCallback();
    for (const n of [2, 3]) {
      expect(vid(n).preload).toBe('auto');
      expect(vid(n).calls).toContain('load');
    }
  });

  test('a video already playing or partway through is left alone, since load() would reset it', async () => {
    await loadPage();
    document.getElementById('secondnumbox').click();
    setVisible('instructionvideo', true);
    vid(3).currentTime = 2;
    idleCallback();
    expect(vid(2).calls).not.toContain('load');
    expect(vid(3).calls).not.toContain('load');
  });

  test('a page missing a hidden video skips it', async () => {
    await loadPage();
    vid(3).remove();
    idleCallback();
    expect(vid(2).calls).toContain('load');
  });

  test('a visitor saving data never downloads them', async () => {
    saveData = true;
    await loadPage();
    expect(idleCallback).toBeNull();
  });
});
