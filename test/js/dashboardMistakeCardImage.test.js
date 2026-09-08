/**
 * Tests which image a dashboard "recent mistakes" card shows (public/js/user-dashboard/MistakeGallery.js, #4478).
 *
 * Two sources cover the same view and the order between them is the contract: the crop is ours and free to serve,
 * `image_url` is billed per request, so the crop wins -- and stays only a preference, since its URL expires.
 *
 * A crop is the WHOLE 720x480 canvas, not a cutout centered on the label, so the marker overlay must survive the
 * switch; without it a card with several features in frame stops saying which one was called a mistake.
 *
 * MistakeGallery is a page-global `class` reaching for globals, so the source is eval'd into jsdom with its
 * collaborators (fetch, i18next, util) stubbed.
 */

const fs = require('fs');
const path = require('path');

const GALLERY_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/user-dashboard/MistakeGallery.js'), 'utf8'
);

const CROP_URL = '/cropImage/Obstacle/501?exp=1&sig=x';
const GSV_URL = 'https://maps.googleapis.com/maps/api/streetview?pano=abc123';

/** One record shaped like an entry from GET /userapi/mistakes. */
function mistake(overrides = {}) {
    return {
        label_id: 501, pano_id: 'abc123', heading: 12, pitch: -5, zoom: 1,
        canvas_x: 180, canvas_y: 360, label_type: 'Obstacle',
        time_validated: '2026-07-01T12:00:00Z', validator_comment: null,
        crop_url: CROP_URL, image_url: GSV_URL, ...overrides,
    };
}

describe('the dashboard mistake card\'s image', () => {
    /** @returns {?HTMLImageElement} The first card's photo, or null when every source has dropped out. */
    const photo = () => document.querySelector('.ud-card-photo');
    const marker = () => document.querySelector('.ud-card-label-marker');

    let mistakes;
    let saveData;

    /**
     * @param {object} [opts] Overrides for the MistakeGallery options.
     * @returns {Promise<void>} Resolves once the cards are in the DOM.
     */
    async function renderGallery(opts = {}) {
        document.body.innerHTML = '<div id="ud-mistakes"></div>';
        const gallery = new window.MistakeGallery(document.getElementById('ud-mistakes'),
            { userId: 'ada', ...opts });
        await gallery.render();
    }

    beforeAll(() => {
        window.i18next = { t: (key) => key };
        window.util = {
            EXPLORE_CANVAS_WIDTH: 720,
            EXPLORE_CANVAS_HEIGHT: 480,
            misc: { getIconImagePaths: (type) => ({ iconImagePath: `/assets/images/${type}_small.svg` }) },
            saveDataEnabled: () => saveData,
        };
        window.eval(`${GALLERY_SRC}\nwindow.MistakeGallery = MistakeGallery;`);
    });

    beforeEach(() => {
        mistakes = [mistake()];
        saveData = false;
        window.fetch = jest.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve({ Obstacle: mistakes }) }));
    });

    it('prefers the saved crop over the Street View Static API image', async () => {
        await renderGallery();

        expect(photo().src).toContain(CROP_URL);
        expect(photo().dataset.udSource).toBe('crop');
    });

    it('uses the Street View image when the label has no saved crop', async () => {
        mistakes = [mistake({ crop_url: null })];
        await renderGallery();

        expect(photo().src).toBe(GSV_URL);
        expect(photo().dataset.udSource).toBe('api');
    });

    it('warms a crop eagerly but leaves the billed Street View image lazy', async () => {
        mistakes = [mistake(), mistake({ label_id: 502, crop_url: null })];
        await renderGallery();

        const [crop, api] = Array.from(document.querySelectorAll('.ud-card-photo'));
        expect(crop.loading).toBe('eager');
        expect(api.loading).toBe('lazy');
    });

    it('leaves even a crop lazy when the viewer has asked to save data', async () => {
        saveData = true;
        await renderGallery();

        expect(photo().loading).toBe('lazy');
    });

    it('falls back to the Street View image when the crop\'s signed URL has expired', async () => {
        await renderGallery();
        photo().dispatchEvent(new window.Event('error'));

        expect(photo().src).toBe(GSV_URL);
        expect(photo().dataset.udSource).toBe('api');
    });

    it('drops the photo when the Street View image fails too, leaving the wrapper\'s gradient', async () => {
        await renderGallery();
        photo().dispatchEvent(new window.Event('error')); // Crop 404s; falls back to the API image.
        photo().dispatchEvent(new window.Event('error')); // That fails as well.

        expect(photo()).toBeNull();
        expect(document.querySelector('.ud-card-img')).not.toBeNull();
    });

    it('keeps the marker on the label\'s canvas position over the crop, which is the whole canvas', async () => {
        await renderGallery();

        expect(marker().src).toContain('Obstacle_small.svg');
        expect(marker().style.left).toBe('25%'); // 180/720
        expect(marker().style.top).toBe('75%'); // 360/480
    });

    it('centers the marker on the bare gradient when the label has neither image nor canvas position', async () => {
        // canvas_x/y are null when the label wasn't in frame at validation time.
        mistakes = [mistake({ crop_url: null, image_url: null, canvas_x: null, canvas_y: null })];
        await renderGallery();

        expect(photo()).toBeNull();
        expect(marker().style.left).toBe('50%');
        expect(marker().style.top).toBe('50%');
    });
});
