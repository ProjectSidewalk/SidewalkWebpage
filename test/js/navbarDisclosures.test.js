/**
 * Tests that the collapsed navbar's disclosures stay mutually consistent (#4857).
 *
 * The hamburger panel and the dropdown menus are separate pieces of state, which only became visible once the account
 * control moved out of the panel and into the quick strip: the two are peers anchored to the same bar, so both could
 * be open at once and overlap. A dropdown still *inside* the panel is a child, not a peer, and must leave it open —
 * that asymmetry is the whole reason this is worth pinning.
 *
 * Loaded the same way as navbarQuickStrip.test.js: eval'd with an explicit export, with each test building its own
 * DOM before constructing a controller.
 */

const fs = require('fs');
const path = require('path');

const NAVBAR_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/Navbar.js'), 'utf8'
);

/** Builds a navbar with one quick item (the account control) and one panel-only dropdown (language). */
function buildNavbar() {
    document.body.innerHTML = `
      <div id="page">page content</div>
      <nav id="header">
        <div class="navbar-container">
          <div class="navbar-brand-area">
            <div class="navbar-logo"><a id="navbar-brand" href="/"></a></div>
            <ul class="navbar-nav navbar-quick" id="navbar-quick"></ul>
            <button type="button" class="navbar-toggle" data-nav-toggle aria-controls="navbar"
                    aria-expanded="false"></button>
          </div>
          <div id="navbar">
            <ul class="navbar-nav navbar-nav--utility">
              <li class="dropdown navbar-lnk" id="li-user" data-nav-quick="1">
                <button type="button" id="user-btn" class="navbar-button" data-nav-dropdown aria-expanded="false"
                        aria-controls="nav-user-menu"></button>
                <ul id="nav-user-menu" class="dropdown-menu"><li><a href="/dashboard"></a></li></ul>
              </li>
              <li class="dropdown navbar-lnk" id="language-dropdown">
                <button type="button" id="lang-btn" class="navbar-button" data-nav-dropdown aria-expanded="false"
                        aria-controls="nav-language-menu"></button>
                <ul id="nav-language-menu" class="dropdown-menu"><li><a href="/lang"></a></li></ul>
              </li>
            </ul>
          </div>
        </div>
      </nav>`;
}

/** Stubs enough layout for the responsive pass to treat the nav as collapsed with room for the quick item. */
function stubLayout() {
    const rect = (el, w) => Object.defineProperty(el, 'getBoundingClientRect', {
        configurable: true, value: () => ({ width: w, height: 38, x: 0, y: 0, top: 0, left: 0 }),
    });
    const hamburger = document.querySelector('[data-nav-toggle]');
    Object.defineProperty(hamburger, 'offsetParent', { configurable: true, get: () => document.body });
    rect(hamburger, 44);
    rect(document.querySelector('.navbar-logo'), 110);
    rect(document.getElementById('navbar-quick'), 40);
    for (const group of document.querySelectorAll('#navbar > .navbar-nav')) rect(group, 100);
    const row = document.querySelector('.navbar-brand-area');
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(document.getElementById('navbar'), 'clientWidth', { configurable: true, get: () => 800 });
}

const panelOpen = () => document.getElementById('navbar').classList.contains('is-open');
const isOpen = (id) => document.getElementById(id).classList.contains('is-open');
const press = (el) => el.dispatchEvent(new Event('pointerdown', { bubbles: true }));

describe('Navbar disclosures', () => {
    beforeAll(() => {
        window.eval(`${NAVBAR_SRC}\nwindow.NavbarController = NavbarController;`);
    });

    beforeEach(() => {
        buildNavbar();
        stubLayout();
        new window.NavbarController();
        // The account control is promoted into the strip, which is what makes it a peer of the panel.
        expect(document.getElementById('navbar-quick').children).toHaveLength(1);
    });

    const hamburger = () => document.querySelector('[data-nav-toggle]');
    const userBtn = () => document.getElementById('user-btn');
    const langBtn = () => document.getElementById('lang-btn');

    it('closes the panel when a quick-strip dropdown opens', () => {
        hamburger().click();
        expect(panelOpen()).toBe(true);

        userBtn().click();

        expect(isOpen('li-user')).toBe(true);
        expect(panelOpen()).toBe(false);
    });

    it('closes a quick-strip dropdown when the panel opens', () => {
        userBtn().click();
        expect(isOpen('li-user')).toBe(true);

        hamburger().click();

        expect(panelOpen()).toBe(true);
        expect(isOpen('li-user')).toBe(false);
    });

    it('keeps the panel open for a dropdown that is still inside it', () => {
        hamburger().click();

        langBtn().click();

        expect(isOpen('language-dropdown')).toBe(true);
        expect(panelOpen()).toBe(true);
    });

    it('keeps the hamburger button aria-expanded in step with the panel', () => {
        hamburger().click();
        expect(hamburger().getAttribute('aria-expanded')).toBe('true');

        userBtn().click();

        expect(hamburger().getAttribute('aria-expanded')).toBe('false');
    });

    it('dismisses the panel on a press outside it', () => {
        hamburger().click();

        press(document.getElementById('page'));

        expect(panelOpen()).toBe(false);
    });

    it('does not dismiss the panel on a press on the hamburger, which owns its own toggle', () => {
        hamburger().click();

        press(hamburger());

        expect(panelOpen()).toBe(true);
    });

    it('dismisses on press rather than click, since closing a dropdown reflows the panel mid-tap', () => {
        hamburger().click();
        // A click whose target retargeted to an ancestor after a reflow must not read as an outside tap.
        document.getElementById('page').dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(panelOpen()).toBe(true);
    });

    it('closes the panel on Escape', () => {
        hamburger().click();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(panelOpen()).toBe(false);
    });

    it('leaves the panel open when Escape was already consumed by a dropdown inside it', () => {
        hamburger().click();
        langBtn().click();

        // The dropdown's own handler calls preventDefault, which is how the panel knows the key was spoken for.
        const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        document.getElementById('nav-language-menu').dispatchEvent(consumed);

        expect(isOpen('language-dropdown')).toBe(false);
        expect(panelOpen()).toBe(true);
    });
});
