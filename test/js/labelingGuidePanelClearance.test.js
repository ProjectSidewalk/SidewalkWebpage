/**
 * Tests the footer clearance of the labeling guide's question panel (public/js/common/labelingGuidePanelResize.js).
 *
 * Scrolled far enough down, the panel stops being fixed and parks itself above the footer ("stuck-sidebar",
 * position: absolute). The offset for that park is derived in document space from the page and footer heights, but
 * `top` on an absolute element resolves against its offset parent -- the Bootstrap column, which Bootstrap gives
 * position: relative -- so the two coordinate spaces have to be reconciled or the panel lands the column's own
 * distance down the document too low and sits on the footer photo.
 *
 * The column's distance down the document is what varies in practice: the test-server banner adds ~51px to the body's
 * top padding on every non-prod stage. The clearance must not depend on that shift, so both cases below assert the
 * same gap, and that invariant is the point of the suite.
 *
 * jsdom has no layout engine, so every measurement the subject reads is stubbed from the model in layout() below.
 */

/* global updateSidebarForScrollState */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC = (p) => fs.readFileSync(path.resolve(REPO_ROOT, p), 'utf8');

// A page tall enough to scroll, with the two footer bands the subject measures.
const BODY_HEIGHT = 8390;
const FOOTER_HEIGHT = 212;
const INFO_FOOTER_HEIGHT = 220;
const PANEL_HEIGHT = 420;

// labelingGuidePanelResize.js's `panelDistanceFromTop`: the panel's gap below the navbar when fixed, and the gap it
// should keep above the footer once parked.
const PANEL_DISTANCE_FROM_TOP = 95;

// Where the footer photo starts, in document coordinates.
const FOOTER_TOP = BODY_HEIGHT - INFO_FOOTER_HEIGHT - FOOTER_HEIGHT;

// How far down the document the panel's Bootstrap column starts. Measured on /labelingGuide/curbRamps: 58px with the
// test-server banner dismissed (and on prod, which never shows it), 109px while it is up.
const COLUMN_TOP_NO_BANNER = 58;
const COLUMN_TOP_WITH_BANNER = 109;

/** Renders the guide's column/panel plus the footer bands, and loads jQuery and the subject over them. */
function setupDom() {
    document.body.innerHTML = `
        <div class="container help">
            <div class="row">
                <div class="col-md-3" id="sidebar">
                    <div id="help-panel" class="panel panel-default"></div>
                </div>
                <div class="col-md-9 maincontent"></div>
            </div>
        </div>
        <footer>
            <div class="container" id="footer-container"></div>
            <div class="container" id="info-footer"></div>
        </footer>
    `;

    // The subject drives its class changes through jQuery, and runs updateSidebarForWindowSize() on load, so the real
    // vendored jQuery has to be in place before it is evaluated.
    window.eval(SRC('public/vendor/jquery/jquery-1.12.2.min.js'));
    global.$ = window.$;
    window.eval(`${SRC('public/js/common/labelingGuidePanelResize.js')}
        window.updateSidebarForScrollState = updateSidebarForScrollState;`);
    global.updateSidebarForScrollState = window.updateSidebarForScrollState;
}

/** Overrides one read-only geometry property that jsdom would otherwise report as 0. */
function stub(target, prop, value) {
    Object.defineProperty(target, prop, {value, configurable: true});
}

/**
 * Stubs the page geometry the subject measures, and puts the panel in the fixed ("sidebar") state it parks from.
 *
 * @param {object}  opts
 * @param {number}  opts.columnTop Document-space top of the panel's Bootstrap column.
 * @param {number}  opts.scrollY   Current vertical scroll position.
 * @returns {{panel: HTMLElement, column: HTMLElement}} The panel under test and its offset parent.
 */
function layout({columnTop, scrollY}) {
    const panel = document.getElementById('help-panel');
    const column = document.getElementById('sidebar');

    stub(document.body, 'clientHeight', BODY_HEIGHT);
    stub(document.getElementById('footer-container'), 'offsetHeight', FOOTER_HEIGHT);
    stub(document.getElementById('info-footer'), 'offsetHeight', INFO_FOOTER_HEIGHT);
    stub(window, 'pageYOffset', scrollY);

    // jsdom always reports offsetParent as null; the real one is the column, because Bootstrap's .col-* is relative.
    stub(panel, 'offsetParent', column);
    stub(column, 'clientTop', 0);
    // getBoundingClientRect() is viewport-relative, hence the scroll subtraction.
    column.getBoundingClientRect = () => ({top: columnTop - scrollY, height: BODY_HEIGHT - columnTop});
    panel.getBoundingClientRect = () => ({top: PANEL_DISTANCE_FROM_TOP, height: PANEL_HEIGHT});

    panel.className = 'panel panel-default sidebar';
    return {panel, column};
}

/** Document-space gap between the parked panel's bottom edge and the top of the footer photo. */
function clearanceAfterScroll({columnTop}) {
    // Far enough down the page that the panel has to park: any scroll past `FOOTER_TOP - PANEL_HEIGHT - 95` does.
    const {panel} = layout({columnTop, scrollY: BODY_HEIGHT});
    updateSidebarForScrollState();

    expect(panel.classList.contains('stuck-sidebar')).toBe(true);
    const panelTopInDocument = columnTop + parseFloat(panel.style.top);
    return FOOTER_TOP - (panelTopInDocument + PANEL_HEIGHT);
}

describe('labeling guide panel clearance above the footer', () => {
    beforeEach(() => {
        setupDom();
    });

    it('parks the panel clear of the footer when the test-server banner is absent', () => {
        expect(clearanceAfterScroll({columnTop: COLUMN_TOP_NO_BANNER})).toBe(PANEL_DISTANCE_FROM_TOP);
    });

    it('parks the panel clear of the footer when the test-server banner pushes the column down', () => {
        expect(clearanceAfterScroll({columnTop: COLUMN_TOP_WITH_BANNER})).toBe(PANEL_DISTANCE_FROM_TOP);
    });

    it('keeps the clearance non-negative however far down the document the column sits', () => {
        // Any layout that pushes the column further down -- a taller banner, an extra masthead -- must not eat into
        // the gap, so sweep well past the offsets the real stages produce.
        for (const columnTop of [0, 58, 109, 200, 400]) {
            setupDom();
            expect(clearanceAfterScroll({columnTop})).toBeGreaterThanOrEqual(0);
        }
    });

    it('returns the panel to its fixed offset below the navbar when scrolled back up', () => {
        const {panel} = layout({columnTop: COLUMN_TOP_WITH_BANNER, scrollY: 0});
        updateSidebarForScrollState();

        expect(panel.classList.contains('sidebar')).toBe(true);
        expect(panel.classList.contains('stuck-sidebar')).toBe(false);
        expect(panel.style.top).toBe(`${PANEL_DISTANCE_FROM_TOP}px`);
    });
});
