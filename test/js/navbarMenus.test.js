/**
 * Tests for the navbar's menus on a wide screen (frontend/js/common/Navbar.js): opening and closing the dropdowns
 * by mouse and keyboard, moving through a menu with the arrow keys, filtering the city switcher, logging which
 * links were clicked, and dropping the least-needed links when the bar runs out of room. The collapsed bar is
 * covered by navbarQuickStrip and navbarDisclosures (#5840).
 */

import { loadModules } from './loader.js';
import { NAVBAR_CITY_DROPDOWN } from './support/pageChromeHarness.js';

/**
 * common/navbar.scala.html for a signed-in user, cut down.
 * @param {string[]} [languages] - The languages the language menu offers.
 */
function renderNavbar(languages = ['es', 'nl']) {
  document.body.innerHTML = `
    <div id="page"><button id="page-button">Elsewhere</button></div>
    <nav id="header" aria-label="Main">
      <div class="navbar-container">
        <div class="navbar-brand-area">
          <div class="navbar-logo"><a id="navbar-brand" href="/"><img alt="Project Sidewalk Logo"></a></div>
          <ul class="navbar-list navbar-quick" id="navbar-quick"></ul>
          <button type="button" class="navbar-menu-toggle" data-nav-toggle aria-controls="navbar"
                  aria-expanded="false"></button>
        </div>
        <div id="navbar">
          <ul class="navbar-list navbar-list--primary" id="topbuttons">
            <li class="navbar-item">
              <a class="navbar-button" id="navbar-start-btn" href="/explore"><svg></svg>Explore</a>
            </li>
            <li class="navbar-item" data-nav-quick="2"><a id="navbar-validate-btn" href="/validate">Validate</a></li>
            <li class="navbar-item" id="li-labelmap" data-nav-shed="4">
              <a id="navbar-labelmap-btn" href="/labelMap">Label Map</a>
            </li>
            <li class="navbar-item" id="li-guide" data-nav-shed="2">
              <a id="navbar-guide-btn" href="/labelingGuide">Guide</a>
            </li>
            <li class="navbar-item" id="navbar-tools-dropdown-list">
              <button type="button" id="nav-tools-dropdown" class="navbar-button" data-nav-dropdown
                      aria-haspopup="true" aria-expanded="false" aria-controls="nav-tools-menu">Tools</button>
              <ul id="nav-tools-menu" class="navbar-menu">
                <li class="navbar-menu-section">Analyze</li>
                <li><a id="navbar-gallery-btn" href="/gallery">Gallery</a></li>
                <li><a id="navbar-labelmap-btn-tools" href="/labelMap">Label Map</a></li>
                <li class="navbar-menu-section">Community</li>
                <li><a id="navbar-stories-btn" href="/stories">Stories</a></li>
              </ul>
            </li>
            <li class="navbar-item" id="li-api" data-nav-shed="3" data-nav-quick="4">
              <a id="navbar-api-btn" href="/api">API</a>
            </li>
            <li class="navbar-item" id="li-about" data-nav-shed="1" data-nav-quick="3">
              <a id="navbar-about-btn" href="/about">About</a>
            </li>
          </ul>
          <ul class="navbar-list navbar-list--utility">
            ${NAVBAR_CITY_DROPDOWN}
            <li class="navbar-item" id="navbar-user-dropdown-list" data-nav-quick="1">
              <button type="button" id="nav-user-dropdown" class="navbar-button" data-nav-dropdown
                      aria-haspopup="true" aria-expanded="false" aria-controls="nav-user-menu">pat</button>
              <ul id="nav-user-menu" class="navbar-menu">
                <li><a id="navbar-dashboard-btn" href="/dashboard">Dashboard</a></li>
                <li class="navbar-menu-divider" role="separator"></li>
                <li><a id="navbar-sign-out-btn" href="/signOut">Sign out</a></li>
              </ul>
            </li>
            <li class="navbar-item" id="language-dropdown">
              <button type="button" class="navbar-button" id="language-button" data-nav-dropdown
                      aria-haspopup="true" aria-expanded="false" aria-controls="nav-language-menu">English</button>
              <ul id="nav-language-menu" class="navbar-menu">
                ${languages.map((lang) => `<li><a class="navbar-language-btn" href="/changeLanguage?lang=${lang}">
                  ${lang}</a></li>`).join('')}
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </nav>`;
}

// What each nav group takes up with nothing dropped, and what dropping a link or shortening the language name saves.
const PRIMARY_WIDTH = 700;
const UTILITY_WIDTH = 300;
const SHED_SAVES = 80;
const COMPACT_LANGUAGE_SAVES = 60;
// The slack the fit keeps between the two groups.
const SLACK = 24;

/**
 * Lays the inline bar out the way a browser would for a window giving the nav `barWidth` px: each group is as wide as
 * its links, less whatever has been dropped. jsdom lays nothing out, and the hamburger shows only on a narrow screen.
 * @param {number} barWidth - The width the nav has.
 */
function layOut(barWidth) {
  const width = (el, measure) => Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true, value: () => ({ width: measure(), right: measure(), left: 0, top: 0, height: 40 }),
  });
  const menu = document.getElementById('navbar');
  Object.defineProperty(menu, 'clientWidth', { configurable: true, get: () => barWidth });
  width(menu, () => barWidth);
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => barWidth });
  Object.defineProperty(document.querySelector('[data-nav-toggle]'), 'offsetParent', {
    configurable: true, get: () => null,
  });
  width(document.querySelector('.navbar-list--primary'),
    () => PRIMARY_WIDTH - SHED_SAVES * document.querySelectorAll('.is-shed').length);
  width(document.querySelector('.navbar-list--utility'),
    () => UTILITY_WIDTH - (document.querySelector('.is-compact') ? COMPACT_LANGUAGE_SAVES : 0));
}

const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');

let NavbarController;

beforeAll(async () => {
  // jsdom reports every element as not displayed; here anything not inside a `hidden` element is.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true, get() { return this.closest('[hidden]') ? null : document.body; },
  });
  // jsdom can't follow a link, so a clicked one stays on the page.
  document.addEventListener('click', (e) => e.preventDefault());
  ({ NavbarController } = await loadModules('frontend/js/common/Navbar.js'));
});

afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent);
});

/**
 * Builds a navbar, lays it out, and starts a controller on it.
 * @param {object} [opts] - `barWidth`, the room the nav has; `languages`, what the language menu offers.
 */
function start({ barWidth = PRIMARY_WIDTH + UTILITY_WIDTH + SLACK, languages } = {}) {
  renderNavbar(languages);
  layOut(barWidth);
  new NavbarController();
}

const el = (id) => document.getElementById(id);
const isOpen = (toggleId) => el(toggleId).closest('.navbar-item').classList.contains('is-open');
/**
 * Presses a key on an element.
 * @param {Element} target - Where focus is.
 * @param {string} key - The key.
 * @returns {KeyboardEvent} The event, to read whether it was consumed.
 */
const press = (target, key) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
/** @param {Element} target - What the mouse clicks; a real click has a detail of at least 1. */
const mouseClick = (target) => target.dispatchEvent(
  new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
);
/** @returns {Promise<void>} Once the re-fit queued for the next frame has run. */
const nextFrame = () => new Promise((resolve) => { requestAnimationFrame(() => resolve()); });

describe('opening and closing a dropdown', () => {
  beforeEach(() => start());

  it('opens on a mouse click without pulling focus into it, and closes on a second', () => {
    mouseClick(el('nav-city-dropdown'));

    expect(isOpen('nav-city-dropdown')).toBe(true);
    expect(el('nav-city-dropdown').getAttribute('aria-expanded')).toBe('true');
    // No on-screen keyboard popping up for the city search on a tap.
    expect(document.activeElement).not.toBe(el('nav-city-search'));

    mouseClick(el('nav-city-dropdown'));
    expect(isOpen('nav-city-dropdown')).toBe(false);
    expect(el('nav-city-dropdown').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(el('nav-city-dropdown'));
  });

  it('moves focus into a menu opened from the keyboard: the city search, or the first link', () => {
    el('nav-city-dropdown').click();
    expect(document.activeElement).toBe(el('nav-city-search'));

    el('nav-tools-dropdown').click();
    expect(document.activeElement).toBe(el('navbar-gallery-btn'));
  });

  it('keeps one dropdown open at a time', () => {
    mouseClick(el('nav-tools-dropdown'));
    mouseClick(el('nav-user-dropdown'));

    expect(isOpen('nav-tools-dropdown')).toBe(false);
    expect(isOpen('nav-user-dropdown')).toBe(true);
  });

  it('opens from the Down arrow on its button, or moves into the menu if it is already open', () => {
    const toggle = el('nav-user-dropdown');

    expect(press(toggle, 'ArrowDown').defaultPrevented).toBe(true);
    expect(isOpen('nav-user-dropdown')).toBe(true);
    expect(document.activeElement).toBe(el('navbar-dashboard-btn'));

    toggle.focus();
    press(toggle, 'ArrowDown');
    expect(document.activeElement).toBe(el('navbar-dashboard-btn'));
  });

  it('closes on Escape from its button, and leaves Escape alone when it is not open', () => {
    const toggle = el('nav-tools-dropdown');
    expect(press(toggle, 'Escape').defaultPrevented).toBe(false);

    mouseClick(toggle);
    const escape = press(toggle, 'Escape');

    expect(escape.defaultPrevented).toBe(true);
    expect(isOpen('nav-tools-dropdown')).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it('ignores other keys on its button', () => {
    expect(press(el('nav-tools-dropdown'), 'a').defaultPrevented).toBe(false);
    expect(isOpen('nav-tools-dropdown')).toBe(false);
  });

  it('closes on a click anywhere outside it, but not on one inside it', () => {
    mouseClick(el('nav-tools-dropdown'));
    mouseClick(el('nav-tools-menu').querySelector('.navbar-menu-section'));
    expect(isOpen('nav-tools-dropdown')).toBe(true);

    mouseClick(el('page'));
    expect(isOpen('nav-tools-dropdown')).toBe(false);
  });

  it('closes when focus leaves the navbar, but not when it moves to another navbar control', () => {
    mouseClick(el('nav-tools-dropdown'));

    el('navbar-about-btn').focus();
    expect(isOpen('nav-tools-dropdown')).toBe(true);

    el('page-button').focus();
    expect(isOpen('nav-tools-dropdown')).toBe(false);
  });
});

describe('a deployment that offers only one language', () => {
  it('opens an empty language menu without moving focus anywhere', () => {
    start({ languages: [] });
    const toggle = el('language-button');
    toggle.focus();

    toggle.click();
    expect(isOpen('language-button')).toBe(true);
    press(toggle, 'ArrowDown');

    expect(document.activeElement).toBe(toggle);
  });
});

describe('moving through an open menu', () => {
  beforeEach(() => start());

  /**
   * Opens a dropdown from the keyboard, leaving focus where it lands.
   * @param {string} toggleId - The dropdown's button.
   */
  const openFromKeyboard = (toggleId) => el(toggleId).click();

  it('steps down and up the links with the arrow keys, and jumps to either end with Home and End', () => {
    openFromKeyboard('nav-tools-dropdown');
    const menu = el('nav-tools-menu');

    press(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(el('navbar-labelmap-btn-tools'));
    press(document.activeElement, 'End');
    expect(document.activeElement).toBe(el('navbar-stories-btn'));
    // Nothing below the last link.
    press(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(el('navbar-stories-btn'));
    press(document.activeElement, 'ArrowUp');
    expect(document.activeElement).toBe(el('navbar-labelmap-btn-tools'));
    press(document.activeElement, 'Home');
    expect(document.activeElement).toBe(el('navbar-gallery-btn'));
    // Up from the first link goes back to the menu's button.
    expect(press(document.activeElement, 'ArrowUp').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('nav-tools-dropdown'));
    expect(menu.contains(document.activeElement)).toBe(false);
  });

  it('leaves other keys to the link', () => {
    openFromKeyboard('nav-tools-dropdown');

    expect(press(document.activeElement, 'Enter').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(el('navbar-gallery-btn'));
  });

  it('closes on Escape from inside, handing focus back to its button', () => {
    openFromKeyboard('nav-user-dropdown');

    press(document.activeElement, 'Escape');

    expect(isOpen('nav-user-dropdown')).toBe(false);
    expect(document.activeElement).toBe(el('nav-user-dropdown'));
  });

  it('goes from the city search to the first city on Down, and lets every other key type', () => {
    openFromKeyboard('nav-city-dropdown');

    expect(press(el('nav-city-search'), 'ArrowUp').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(el('nav-city-search'));
    press(el('nav-city-search'), 'ArrowDown');
    expect(document.activeElement).toBe(el('burnaby-bc'));
  });

  it('returns to the city search from either end of the city list', () => {
    openFromKeyboard('nav-city-dropdown');
    press(el('nav-city-search'), 'ArrowDown');

    press(document.activeElement, 'ArrowUp');
    expect(document.activeElement).toBe(el('nav-city-search'));

    el('navbar-cities-btn').focus();
    press(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(el('nav-city-search'));
  });
});

describe('filtering the city switcher', () => {
  beforeEach(() => start());

  /** @param {string} text - What the user types in the search. */
  const search = (text) => {
    el('nav-city-search').value = text;
    el('nav-city-search').dispatchEvent(new Event('input'));
  };
  /** @returns {string[]} The cities still listed, by their search text. */
  const listed = () => [...document.querySelectorAll('.nav-city-item:not([hidden])')]
    .map((item) => item.dataset.search);
  const groupShown = (country) => !document.querySelector(`.nav-city-group[data-country="${country}"]`).hidden;
  const emptyShown = () => !document.querySelector('.nav-city-empty').hidden;

  it('lists only the cities that match, without their emptied countries', () => {
    search('  CHI ');

    expect(listed()).toEqual(['chicago, il united states']);
    expect(groupShown('usa')).toBe(true);
    expect(groupShown('canada')).toBe(false);
    expect(emptyShown()).toBe(false);
  });

  it('says so when nothing matches, and lists everything again once the search is cleared', () => {
    search('zzz');
    expect(listed()).toEqual([]);
    expect(emptyShown()).toBe(true);

    search('');
    expect(listed()).toHaveLength(4);
    expect(groupShown('canada')).toBe(true);
    expect(emptyShown()).toBe(false);
  });
});

describe('logging navbar clicks', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/explore');
    window.logWebpageActivity = vi.fn();
    start();
  });

  it.each([
    ['navbar-gallery-btn', 'Click_module=Gallery_location=Navbar_route=/explore'],
    ['navbar-sign-out-btn', 'Click_module=SignOut_location=Navbar_route=/explore'],
    ['navbar-cities-btn', 'Click_module=DeploymentSitesDashboard_location=Navbar_route=/explore'],
  ])('logs a click on %s as its own module', (id, logged) => {
    mouseClick(el(id));

    expect(window.logWebpageActivity).toHaveBeenCalledExactlyOnceWith(logged);
  });

  it('logs a click on an icon inside a link as a click on the link', () => {
    mouseClick(el('navbar-start-btn').querySelector('svg'));

    expect(window.logWebpageActivity)
      .toHaveBeenCalledExactlyOnceWith('Click_module=StartExploring_location=Navbar_route=/explore');
  });

  it('logs which city was picked from the switcher', () => {
    mouseClick(el('chicago-il'));

    const logged = 'Click_module=NavbarCityDropdown_city=chicago-il_location=Navbar_route=/explore';
    expect(window.logWebpageActivity).toHaveBeenCalledExactlyOnceWith(logged);
  });

  it('logs nothing for a link it has no name for, or a click on the current city', () => {
    mouseClick(el('navbar-stories-btn'));
    mouseClick(document.querySelector('.current-city'));

    expect(window.logWebpageActivity).not.toHaveBeenCalled();
  });

  it('logs nothing, and does not break, before the page has set up its logging', () => {
    delete window.logWebpageActivity;

    expect(() => mouseClick(el('navbar-gallery-btn'))).not.toThrow();
  });
});

describe('fitting the bar on one line', () => {
  const shed = () => [...document.querySelectorAll('.is-shed')].map((li) => li.id);
  const compactLanguage = () => el('language-dropdown').classList.contains('is-compact');

  it('drops nothing when everything fits', () => {
    start();

    expect(shed()).toEqual([]);
    expect(compactLanguage()).toBe(false);
  });

  it('drops About first, and stops as soon as the rest fit', () => {
    start({ barWidth: PRIMARY_WIDTH + UTILITY_WIDTH + SLACK - 1 });

    expect(shed()).toEqual(['li-about']);
  });

  it('drops in priority order, then shortens the language name, on a narrow bar', () => {
    start({ barWidth: PRIMARY_WIDTH + UTILITY_WIDTH + SLACK - 3 * SHED_SAVES });
    expect(shed()).toEqual(['li-guide', 'li-api', 'li-about']);
    expect(compactLanguage()).toBe(false);

    start({ barWidth: 600 });
    expect(shed()).toEqual(['li-labelmap', 'li-guide', 'li-api', 'li-about']);
    expect(compactLanguage()).toBe(true);
  });

  it('puts everything back when the window widens', async () => {
    start({ barWidth: 600 });

    layOut(PRIMARY_WIDTH + UTILITY_WIDTH + SLACK);
    // Two resizes in one frame cost one re-fit.
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    await nextFrame();

    expect(shed()).toEqual([]);
    expect(compactLanguage()).toBe(false);
  });

  it('fits again once the web fonts are in, since they change every label\'s width', async () => {
    let fontsLoaded;
    document.fonts = { ready: new Promise((resolve) => { fontsLoaded = resolve; }) };
    try {
      start();
      layOut(PRIMARY_WIDTH + UTILITY_WIDTH + SLACK - 1);

      fontsLoaded();
      await document.fonts.ready;
      await nextFrame();

      expect(shed()).toEqual(['li-about']);
    } finally {
      delete document.fonts;
    }
  });
});

describe('a page without the navbar', () => {
  it('sets up nothing, as on mobile Validate', () => {
    document.body.innerHTML = '<div id="page"></div>';

    expect(() => new NavbarController()).not.toThrow();
  });
});
