/**
 * Where the landing page's validation grid draws its label marker (public/js/LandingValidationGrid.js, issue #2660).
 *
 * A card shows a crop or the Street View still it falls back to, and the label is in a different place in each: only
 * a crop's `label_crop` row says where a job-cut window put it, while the still reproduces the Explore frame. These
 * pin that `cropMarker` is used for the crop and only for the crop, and that the validation the card submits reports
 * the same position it drew.
 *
 * LandingValidationGrid is a Grunt-concatenated `class` that reaches for page globals, so the source is eval'd into
 * jsdom with the collaborators it touches stubbed out.
 */

const fs = require('fs');
const path = require('path');

const GRID_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/LandingValidationGrid.js'), 'utf8'
);

/** One /label/labels entry; the click sits at 1/4, 3/4 of the 720x480 Explore canvas. */
function entry(overrides = {}) {
    return {
        label: {
            label_id: 1, label_type: 'CurbRamp', canvas_x: 180, canvas_y: 360, severity: 2, tags: [],
            heading: 10, pitch: 0, zoom: 1, from_current_user: false, user_validation: null, pano_source: 'GSV',
        },
        cropUrl: '/cropImage/CurbRamp/1',
        cropMarker: { x: 0.5, y: 0.62 },
        gsvImageUrl: 'https://maps.example/still.jpg',
        ...overrides,
    };
}

describe('the landing validation grid\'s label marker', () => {
    const marker = () => document.querySelector('.lvg-card-marker');

    /** The fractions the marker is placed at, as percentages. */
    function markerPercents() {
        return { left: parseFloat(marker().style.left), top: parseFloat(marker().style.top) };
    }

    /**
     * Builds a grid whose one card is the given entry, with the first-interaction gate already tripped.
     * @param {Object} gridEntry - The /label/labels entry to render.
     */
    async function renderGrid(gridEntry) {
        document.body.innerHTML = `
            <section id="landing-validation-container" hidden>
              <div id="landing-validation-grid"></div>
            </section>`;
        window.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ labelsOfType: [gridEntry] }),
        }));
        // Votes go through the anonymous-session wrapper, not bare fetch.
        window.util.lazyIdentityFetch = jest.fn(() => Promise.resolve({ ok: true }));
        let start;
        window.util.onFirstInteractionOrIdle = (fn) => { start = fn; };
        // The tests read the DOM the grid builds, not the instance.
        const grid = new window.LandingValidationGrid(document.getElementById('landing-validation-container'));
        expect(grid).toBeInstanceOf(window.LandingValidationGrid);
        await start();
    }

    beforeAll(() => {
        window.i18next = { t: (key) => key };
        window.util = {
            camelToKebab: (s) => s.toLowerCase(),
            saveDataEnabled: () => false,
            onFirstInteractionOrIdle: () => {},
            lazyIdentityFetch: () => Promise.resolve({ ok: true }),
            EXPLORE_CANVAS_WIDTH: 720,
            EXPLORE_CANVAS_HEIGHT: 480,
            misc: { getIconImagePaths: () => ({ iconImagePath: 'icon.png' }) },
        };
        window.logWebpageActivity = jest.fn();
        // jsdom has no layout, so it has no matchMedia; the grid asks it how many slots this width shows.
        window.matchMedia = () => ({ matches: false });
        window.createPanoViewerLogo = () => ({ showSourceLogo: () => {} });
        window.createPanoAttribution = () => ({ show: () => {} });
        window.eval(`${GRID_SRC}\nwindow.LandingValidationGrid = LandingValidationGrid;`);
    });

    it('draws the marker where the crop says its label is', async () => {
        await renderGrid(entry());

        expect(markerPercents()).toEqual({ left: 50, top: 62 });
    });

    it('falls back to the canvas fraction for a crop nothing has recorded yet', async () => {
        await renderGrid(entry({ cropMarker: null }));

        expect(markerPercents()).toEqual({ left: 25, top: 75 });
    });

    it('uses the canvas fraction on the Street View still, which reproduces the Explore frame', async () => {
        await renderGrid(entry({ cropUrl: null, cropMarker: null }));

        expect(markerPercents()).toEqual({ left: 25, top: 75 });
    });

    it('moves the marker to the canvas fraction when the crop fails and the still takes its place', async () => {
        await renderGrid(entry());
        expect(markerPercents()).toEqual({ left: 50, top: 62 });

        const img = document.querySelector('.lvg-card-photo');
        img.dispatchEvent(new window.Event('error')); // The crop 404s; the card retries with the still.

        expect(document.querySelector('.lvg-card').dataset.imageSource).toBe('api');
        expect(markerPercents()).toEqual({ left: 25, top: 75 });
    });

    it('reports the position it drew, not the canvas fraction, with the validation', async () => {
        await renderGrid(entry());
        const img = document.querySelector('.lvg-card-photo');
        Object.defineProperty(img, 'clientWidth', { value: 300 });
        Object.defineProperty(img, 'clientHeight', { value: 200 });

        document.querySelector('.lvg-btn-agree').click();
        await Promise.resolve();

        const validate = window.util.lazyIdentityFetch.mock.calls.find(([url]) => url === '/labelmap/validate');
        expect(validate).toBeDefined();
        const payload = JSON.parse(validate[1].body);
        expect([payload.canvas_x, payload.canvas_y]).toEqual([150, 124]); // 0.5 x 300, 0.62 x 200.
    });
});
