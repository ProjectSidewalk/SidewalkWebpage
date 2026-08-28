/**
 * Tests the sidebar disclosure shared by the `.api-*` shells and the Gallery's filter column (#4691).
 *
 * The two surfaces build their button differently — the shells synthesise one from the active nav item, the Gallery
 * renders its own in Twirl so the label goes through Play's i18n — so what has to be pinned is that both end up with
 * the same behaviour: the open state lives on the sidebar root as `mobile-visible`, `aria-expanded` tracks it, and
 * `aria-controls` names what actually opens. A drift here is invisible until a screen reader hits it.
 *
 * Loaded the same way as navbarDisclosures.test.js: eval'd with an explicit export.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/sidebarDisclosure.js'), 'utf8'
);

/** Evaluates the production file and hands back the two entry points the pages use. */
function load() {
    window.eval(`${SRC}
    window.wireSidebarDisclosure = wireSidebarDisclosure;
    window.initSidebarDisclosure = initSidebarDisclosure;`);
    return {
        wire: window.wireSidebarDisclosure,
        init: window.initSidebarDisclosure,
    };
}

describe('wireSidebarDisclosure', () => {
    /** Builds the Gallery's shape: a Twirl-rendered button beside the sections it discloses. */
    function buildGallery() {
        document.body.innerHTML = `
          <div class="sidebar">
            <div class="gallery-filter-header">
              <button type="button" id="gallery-filter-toggle" aria-expanded="false"
                      aria-controls="gallery-filter-sections">Filter By</button>
            </div>
            <div id="card-filter">
              <div id="gallery-filter-sections"></div>
            </div>
          </div>`;
        return {
            toggle: document.getElementById('gallery-filter-toggle'),
            root: document.querySelector('.sidebar'),
            sections: document.getElementById('gallery-filter-sections'),
        };
    }

    it('toggles mobile-visible on the root and tracks it in aria-expanded', () => {
        const {wire} = load();
        const {toggle, root} = buildGallery();
        wire(toggle, root);

        expect(root.classList.contains('mobile-visible')).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        toggle.click();
        expect(root.classList.contains('mobile-visible')).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');

        toggle.click();
        expect(root.classList.contains('mobile-visible')).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('points aria-controls at what opens', () => {
        const {wire} = load();
        const {toggle, root, sections} = buildGallery();
        wire(toggle, root, {controlled: sections});

        expect(toggle.getAttribute('aria-controls')).toBe('gallery-filter-sections');
    });

    it('names an unnamed disclosed element so aria-controls can reference it', () => {
        const {wire} = load();
        const {toggle, root} = buildGallery();
        const anonymous = document.createElement('div');
        root.append(anonymous);

        wire(toggle, root, {controlled: anonymous, controlledId: 'some-nav'});

        expect(anonymous.id).toBe('some-nav');
        expect(toggle.getAttribute('aria-controls')).toBe('some-nav');
    });

    it('reports each state change to the caller, so the Gallery can log the interaction', () => {
        const {wire} = load();
        const {toggle, root} = buildGallery();
        const seen = [];
        wire(toggle, root, {onToggle: (open) => seen.push(open)});

        toggle.click();
        toggle.click();

        expect(seen).toEqual([true, false]);
    });

    it('adopts a root that is already open, rather than reporting it closed', () => {
        const {wire} = load();
        const {toggle, root} = buildGallery();
        root.classList.add('mobile-visible');

        wire(toggle, root);

        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });
});

describe('initSidebarDisclosure', () => {
    /** Builds an `.api-*` shell sidebar with a nav the button has to discover on its own. */
    function buildShell({active = true} = {}) {
        document.body.innerHTML = `
          <aside class="page-sidebar">
            <nav class="page-nav">
              <div class="page-nav-header">Overview</div>
              <a class="page-nav-item${active ? ' active' : ''}" href="#">Raw Labels</a>
            </nav>
          </aside>`;
        return document.querySelector('.page-sidebar');
    }

    it('labels the button with the active nav item and discloses the nav', () => {
        const {init} = load();
        const sidebar = buildShell();

        init();

        const toggle = sidebar.querySelector('.page-sidebar-toggle');
        expect(toggle).not.toBeNull();
        expect(sidebar.firstElementChild).toBe(toggle);
        expect(toggle.querySelector('.page-sidebar-toggle-label').textContent).toBe('Raw Labels');
        expect(toggle.getAttribute('aria-controls')).toBe('page-sidebar-nav');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        toggle.click();
        expect(sidebar.classList.contains('mobile-visible')).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('falls back to the first group header when no item is active', () => {
        const {init} = load();
        const sidebar = buildShell({active: false});

        init();

        expect(sidebar.querySelector('.page-sidebar-toggle-label').textContent).toBe('Overview');
    });

    it('carries both the page name and the control it is, with the visible text first (WCAG 2.5.3)', () => {
        const {init} = load();
        const sidebar = buildShell();

        init();

        expect(sidebar.querySelector('.page-sidebar-toggle').getAttribute('aria-label'))
            .toBe('Raw Labels — section navigation');
    });

    it('renders a page title as text, never as markup', () => {
        const {init} = load();
        const sidebar = buildShell();
        sidebar.querySelector('.page-nav-item').textContent = '<img src=x onerror=alert(1)>';

        init();

        const label = sidebar.querySelector('.page-sidebar-toggle-label');
        expect(label.querySelector('img')).toBeNull();
        expect(label.textContent).toBe('<img src=x onerror=alert(1)>');
    });

    it('is a no-op on a page with no shell sidebar, and never adds a second button', () => {
        const {init} = load();
        document.body.innerHTML = '<main></main>';
        expect(() => init()).not.toThrow();

        const sidebar = buildShell();
        init();
        init();
        expect(sidebar.querySelectorAll('.page-sidebar-toggle')).toHaveLength(1);
    });
});
