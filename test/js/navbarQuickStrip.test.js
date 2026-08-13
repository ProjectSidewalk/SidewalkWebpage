/**
 * Tests for the collapsed navbar's quick strip in Navbar.js (#4857).
 *
 * Below the collapse breakpoint the bar is otherwise a logo and a hamburger, so Navbar.js promotes `data-nav-quick`
 * items into a strip beside the hamburger — moving the elements rather than copying them, because their ids are what
 * the click logging and the sign-in dialog key on. That makes three things worth pinning: the strip reads in authored
 * order while it *drops* by `data-nav-quick` priority, so the account control survives narrowest; an item is in
 * exactly one place at a time (promoted items leave the panel, and anything that doesn't fit stays in it, so nothing
 * goes missing); and widening the window puts every item back where the inline bar expects it, in order.
 *
 * jsdom has no layout, so the widths the fit check reads are stubbed per element; `stacked` is likewise driven by
 * stubbing the hamburger's offsetParent, which is what the real code tests.
 */

const fs = require('fs');
const path = require('path');

const NAVBAR_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/Navbar.js'), 'utf8'
);

const LOGO_WIDTH = 110;
const HAMBURGER_WIDTH = 44;
// Destinations carry a label, so they are wider than the icon-only account control.
const ACCOUNT_WIDTH = 40;
const LABELLED_WIDTH = 90;

/** Builds the navbar markup the template renders, reduced to what the responsive code reads. */
function buildNavbar() {
    document.body.innerHTML = `
      <nav id="header">
        <div class="navbar-container">
          <div class="navbar-brand-area">
            <div class="navbar-logo"><a id="navbar-brand" href="/"></a></div>
            <ul class="navbar-nav navbar-quick" id="navbar-quick"></ul>
            <button type="button" class="navbar-toggle" data-nav-toggle aria-controls="navbar"
                    aria-expanded="false"></button>
          </div>
          <div id="navbar">
            <ul class="navbar-nav navbar-nav--primary">
              <li class="navbar-lnk" id="li-explore"><a class="navbar-button" id="navbar-start-btn"></a></li>
              <li class="navbar-lnk" id="li-validate" data-nav-quick="2">
                <a class="navbar-button" id="navbar-validate-btn"></a>
              </li>
              <li class="navbar-lnk" id="li-api" data-nav-shed="3" data-nav-quick="4">
                <a class="navbar-button" id="navbar-api-btn"></a>
              </li>
              <li class="navbar-lnk" id="li-about" data-nav-shed="1" data-nav-quick="3">
                <a class="navbar-button" id="navbar-about-btn"></a>
              </li>
            </ul>
            <ul class="navbar-nav navbar-nav--utility">
              <li class="dropdown navbar-lnk" id="li-user" data-nav-quick="1">
                <button type="button" class="navbar-button" data-nav-dropdown aria-expanded="false"
                        aria-controls="nav-user-menu"></button>
                <ul id="nav-user-menu" class="dropdown-menu"><li><a href="/dashboard"></a></li></ul>
              </li>
              <li class="dropdown navbar-lnk" id="language-dropdown">
                <button type="button" class="navbar-button" data-nav-dropdown aria-expanded="false"
                        aria-controls="nav-language-menu"></button>
                <ul id="nav-language-menu" class="dropdown-menu"><li><a href="/lang"></a></li></ul>
              </li>
            </ul>
          </div>
        </div>
      </nav>`;
}

/**
 * Stubs the layout the fit check reads.
 *
 * @param {object} opts - Configuration.
 * @param {boolean} opts.stacked - Whether the hamburger is showing (which is what puts the nav in its collapsed form).
 * @param {number} opts.barWidth - The width available to the brand row.
 */
function stubLayout({ stacked, barWidth }) {
    const width = (el, w) => Object.defineProperty(el, 'getBoundingClientRect', {
        configurable: true, value: () => ({ width: w, height: 38, x: 0, y: 0, top: 0, left: 0 }),
    });

    const hamburger = document.querySelector('[data-nav-toggle]');
    Object.defineProperty(hamburger, 'offsetParent', {
        configurable: true, get: () => (stacked ? document.body : null),
    });

    const row = document.querySelector('.navbar-brand-area');
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => barWidth });
    width(document.querySelector('.navbar-logo'), LOGO_WIDTH);
    width(hamburger, HAMBURGER_WIDTH);

    // The strip is a flex row, so its width is the sum of whichever items are currently in it.
    const strip = document.getElementById('navbar-quick');
    Object.defineProperty(strip, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
            width: Array.from(strip.children)
                .reduce((sum, li) => sum + (li.id === 'li-user' ? ACCOUNT_WIDTH : LABELLED_WIDTH), 0),
            height: 36, x: 0, y: 0, top: 0, left: 0,
        }),
    });

    // The inline bar's own fit check; irrelevant while stacked, and generous enough not to shed when not.
    for (const group of document.querySelectorAll('#navbar > .navbar-nav')) width(group, 100);
    Object.defineProperty(document.getElementById('navbar'), 'clientWidth', {
        configurable: true, get: () => barWidth,
    });
}

/** @returns {string[]} The ids in the quick strip, in visual order. */
function stripIds() {
    return Array.from(document.getElementById('navbar-quick').children).map((el) => el.id);
}

/** @returns {string[]} The ids of the items still inside the collapsible panel, in DOM order. */
function panelIds() {
    return Array.from(document.querySelectorAll('#navbar .navbar-lnk')).map((el) => el.id);
}

describe('Navbar quick strip', () => {
    beforeAll(() => {
        // The source self-instantiates on load; with no #header in the document that constructor returns immediately,
        // so each test can build its own DOM and construct explicitly.
        window.eval(`${NAVBAR_SRC}\nwindow.NavbarController = NavbarController;`);
    });

    /**
     * Renders the navbar at a given width and runs the responsive pass.
     *
     * @param {object} opts - Passed through to stubLayout.
     * @returns {object} The controller, so a test can re-run the pass after changing the layout.
     */
    function render(opts) {
        buildNavbar();
        stubLayout(opts);
        return new window.NavbarController();
    }

    describe('when the nav is collapsed', () => {
        it('promotes every quick item to the strip when they all fit', () => {
            render({ stacked: true, barWidth: 800 });

            expect(stripIds()).toEqual(['li-validate', 'li-api', 'li-about', 'li-user']);
        });

        it('shows them in authored order, with the account control last as in the inline bar', () => {
            render({ stacked: true, barWidth: 800 });

            // Not `data-nav-quick` order (user, validate, about, api) — that ranking only decides what gets dropped.
            expect(stripIds()).toEqual(['li-validate', 'li-api', 'li-about', 'li-user']);
        });

        it('takes promoted items out of the panel, so nothing is listed twice', () => {
            render({ stacked: true, barWidth: 800 });

            expect(panelIds()).toEqual(['li-explore', 'language-dropdown']);
        });

        it('drops the lowest-priority items on a narrow screen and leaves them in the panel', () => {
            // Room for the logo, the hamburger, the account control, and one labelled destination.
            render({
                stacked: true,
                barWidth: LOGO_WIDTH + HAMBURGER_WIDTH + ACCOUNT_WIDTH + LABELLED_WIDTH + 16,
            });

            expect(stripIds()).toEqual(['li-validate', 'li-user']);
            expect(panelIds()).toEqual(expect.arrayContaining(['li-about', 'li-api']));
        });

        it('keeps the account control even when nothing else fits', () => {
            render({ stacked: true, barWidth: LOGO_WIDTH + HAMBURGER_WIDTH + ACCOUNT_WIDTH + 16 });

            expect(stripIds()).toEqual(['li-user']);
        });

        it('leaves the strip empty when there is no room at all', () => {
            render({ stacked: true, barWidth: LOGO_WIDTH + HAMBURGER_WIDTH });

            expect(stripIds()).toEqual([]);
            expect(panelIds()).toEqual(
                ['li-explore', 'li-validate', 'li-api', 'li-about', 'li-user', 'language-dropdown']
            );
        });
    });

    describe('when the nav is inline', () => {
        it('leaves every item in the bar', () => {
            render({ stacked: false, barWidth: 1400 });

            expect(stripIds()).toEqual([]);
        });

        it('restores promoted items to their original positions when the window widens', async () => {
            render({ stacked: false, barWidth: 1400 });
            const authoredOrder = panelIds();

            render({ stacked: true, barWidth: 800 });
            expect(stripIds()).toHaveLength(4);

            stubLayout({ stacked: false, barWidth: 1400 });
            window.dispatchEvent(new Event('resize'));
            await new Promise((resolve) => requestAnimationFrame(resolve));

            expect(stripIds()).toEqual([]);
            expect(panelIds()).toEqual(authoredOrder);
        });

        it('restores correctly from a partly-filled strip, where a dropped item outranks a promoted one', async () => {
            render({
                stacked: true,
                barWidth: LOGO_WIDTH + HAMBURGER_WIDTH + ACCOUNT_WIDTH + LABELLED_WIDTH + 16,
            });
            expect(stripIds()).toEqual(['li-validate', 'li-user']);

            stubLayout({ stacked: false, barWidth: 1400 });
            window.dispatchEvent(new Event('resize'));
            await new Promise((resolve) => requestAnimationFrame(resolve));

            expect(panelIds()).toEqual(
                ['li-explore', 'li-validate', 'li-api', 'li-about', 'li-user', 'language-dropdown']
            );
        });
    });
});
