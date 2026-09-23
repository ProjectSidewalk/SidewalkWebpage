/**
 * Tests for where a Gallery card draws its label marker (public/js/gallery/src/cards/Card.js, issue #2660).
 *
 * A card's image is one of three things, and the label is in a different place in each: a crop the nightly job cut
 * around the label from the pano (label wherever `label_crop` says, usually the centre), the browser's snapshot of the
 * Explore canvas (label at the canvas fraction), or the Street View still the card falls back to when the crop fails
 * to load (the 720x480 Explore frame again, so the canvas fraction). The card is handed the crop's marker with the
 * crop; these pin that it uses it for the crop, and only for the crop.
 *
 * Card is a Grunt-concatenated `class` that reaches for page globals, so the source is eval'd into jsdom with the
 * collaborators it touches during construction stubbed out.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub, installUtilitiesMisc } = require('./loadGlobalScript');

const CARD_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/gallery/src/cards/Card.js'), 'utf8'
);

/** What the source-logo and licence-line stubs were last told: the card owes a credit on a crop and nothing else. */
const credit = { logo: null, attribution: null };

/** One label payload, shaped like an entry from POST /label/labels; the click sits at 1/4, 3/4 of the canvas. */
function label(overrides = {}) {
    return {
        label_id: 1, label_type: 'CurbRamp', region_id: 7, severity: 2, canvas_x: 180, canvas_y: 360,
        agree_count: 1, disagree_count: 0, unsure_count: 0, tags: [], ai_generated: false, ...overrides,
    };
}

describe('a Gallery card\'s label marker', () => {
    /** @returns {HTMLElement} The wrapper positioned over the image. */
    const markerWrapper = () => document.querySelector('.gallery-marker-wrapper');

    /** The fractions the wrapper hands the stylesheet, as percentages. */
    function markerPercents() {
        const pct = (name) => 100 * Number(markerWrapper().style.getPropertyValue(name));
        return { left: pct('--gallery-marker-x'), top: pct('--gallery-marker-y') };
    }

    /**
     * Renders a card into the document.
     * @param {?string} cropUrl The crop image URL, or null for a card with no crop.
     * @param {?{x: number, y: number}} cropMarker Where the label is in the crop, or null.
     * @param {?string} gsvImageUrl The Street View still's URL, or null for non-GSV imagery.
     * @returns {Card} The card under test.
     */
    function renderCard(cropUrl, cropMarker, gsvImageUrl = 'https://maps.example/still.jpg') {
        document.body.innerHTML = '<div id="cards"></div>';
        const card = new window.Card(label(), cropUrl, gsvImageUrl, cropMarker);
        card.render(document.getElementById('cards'));
        return card;
    }

    beforeAll(() => {
        window.i18next = { t: (key) => key, language: 'en' };
        window.moment = (value) => value;
        window.util = {
            assetPath: assetPathStub,
            camelToKebab: (s) => s.toLowerCase(),
            EXPLORE_CANVAS_WIDTH: 720,
            EXPLORE_CANVAS_HEIGHT: 480,
        };
        installUtilitiesMisc(); // The real util.misc, so labelMarkerFraction under test is the shipped one.
        // Collaborators the constructor builds but this test doesn't exercise.
        window.SeverityDisplay = class {};
        window.ValidationInfoDisplay = class {};
        window.ValidationMenu = class {};
        window.TagDisplay = class {};
        window.createPanoViewerLogo = () => ({
            showSourceLogo: () => { credit.logo = 'shown'; },
            hide: () => { credit.logo = 'hidden'; },
        });
        window.createPanoAttribution = () => ({
            show: () => { credit.attribution = 'shown'; },
            hide: () => { credit.attribution = 'hidden'; },
        });
        window.$ = () => ({ tooltip: () => ({ tooltip: () => {} }) });
        window.eval(`${CARD_SRC}\nwindow.Card = Card;`);
    });

    beforeEach(() => {
        window.sg = { regionNames: {}, tracker: { push: jest.fn() } };
        credit.logo = null;
        credit.attribution = null;
    });

    it('draws the marker where the crop says its label is', () => {
        renderCard('/cropImage/CurbRamp/1', { x: 0.5, y: 0.62 });

        expect(markerPercents()).toEqual({ left: 50, top: 62 });
    });

    it('falls back to the canvas fraction for a crop nothing has recorded yet', () => {
        renderCard('/cropImage/CurbRamp/1', null);

        expect(markerPercents()).toEqual({ left: 25, top: 75 });
    });

    it('uses the canvas fraction on the Street View still, which reproduces the Explore frame', () => {
        renderCard(null, null);

        expect(markerPercents()).toEqual({ left: 25, top: 75 });
    });

    // A crop is our own cut of the panorama, so it owes a credit; the still arrives with Google's logo and © baked in.
    it('credits a crop but leaves the still to Google', () => {
        renderCard('/cropImage/CurbRamp/1', { x: 0.5, y: 0.62 });
        expect(credit).toEqual({ logo: 'shown', attribution: 'shown' });

        renderCard(null, null);
        expect(credit).toEqual({ logo: 'hidden', attribution: 'hidden' });
    });

    it('moves the marker to the canvas fraction when the crop fails and the still takes its place', async () => {
        const card = renderCard('/cropImage/CurbRamp/1', { x: 0.5, y: 0.62 });
        expect(markerPercents()).toEqual({ left: 50, top: 62 });

        const loaded = card.loadImage();
        const img = document.querySelector('.static-gallery-image');
        img.onerror(); // The crop 404s; the card retries with the still.
        img.onload();
        await expect(loaded).resolves.toBe(true);

        expect(card.getStatus().imageSource).toBe('api');
        expect(markerPercents()).toEqual({ left: 25, top: 75 });
        expect(credit).toEqual({ logo: 'hidden', attribution: 'hidden' }); // The still brands itself.
    });

    // With `return_error_code` on the still (#5327) an expired pano 404s instead of answering with a grey "no
    // imagery" card, so a card that has lost its crop as well has nothing to show and no place to point.
    it('hides the image and the marker when neither the crop nor the still loads', async () => {
        const card = renderCard('/cropImage/CurbRamp/1', { x: 0.5, y: 0.62 });

        const loaded = card.loadImage();
        const img = document.querySelector('.static-gallery-image');
        img.onerror(); // The crop 404s; the card retries with the still.
        img.onerror(); // The still 404s too.
        await expect(loaded).resolves.toBe(false);

        expect(img.classList.contains('static-gallery-image--missing')).toBe(true);
        expect(img.getAttribute('aria-hidden')).toBe('true'); // Its alt would describe a picture that isn't there.
        expect(markerWrapper().classList.contains('gallery-marker-wrapper--missing')).toBe(true);
        expect(credit).toEqual({ logo: 'hidden', attribution: 'hidden' }); // Nothing is owed on no image.
    });

    // The container loads every card again on each page and filter render, so a transient failure (a crop 502 during
    // a deploy, a Static API 5xx) must not blank the card for the rest of the visit.
    it('shows the image again when a retry after a total failure loads the crop', async () => {
        const card = renderCard('/cropImage/CurbRamp/1', { x: 0.5, y: 0.62 });
        const img = document.querySelector('.static-gallery-image');
        const failed = card.loadImage();
        img.onerror();
        img.onerror();
        await expect(failed).resolves.toBe(false);
        expect(card.getStatus().imageSource).toBe('api');

        const retried = card.loadImage();
        img.onload();
        await expect(retried).resolves.toBe(true);

        expect(img.classList.contains('static-gallery-image--missing')).toBe(false);
        expect(img.hasAttribute('aria-hidden')).toBe(false);
        expect(markerWrapper().classList.contains('gallery-marker-wrapper--missing')).toBe(false);
        // The retry starts over from the crop, so the marker and the credit are the crop's again.
        expect(card.getStatus().imageSource).toBe('crop');
        expect(markerPercents()).toEqual({ left: 50, top: 62 });
        expect(credit).toEqual({ logo: 'shown', attribution: 'shown' });
    });

    it('hides them on the first failure for non-GSV imagery, whose crop is the only source', async () => {
        const card = renderCard('/cropImage/CurbRamp/1', { x: 0.5, y: 0.62 }, null);

        const loaded = card.loadImage();
        const img = document.querySelector('.static-gallery-image');
        img.onerror();
        await expect(loaded).resolves.toBe(false);

        expect(img.classList.contains('static-gallery-image--missing')).toBe(true);
        expect(markerWrapper().classList.contains('gallery-marker-wrapper--missing')).toBe(true);
        expect(credit).toEqual({ logo: 'hidden', attribution: 'hidden' });
    });

    it('leaves the image and marker visible once a source loads', async () => {
        const card = renderCard('/cropImage/CurbRamp/1', { x: 0.5, y: 0.62 });

        const loaded = card.loadImage();
        const img = document.querySelector('.static-gallery-image');
        img.onload();
        await expect(loaded).resolves.toBe(true);

        expect(img.classList.contains('static-gallery-image--missing')).toBe(false);
        expect(markerWrapper().classList.contains('gallery-marker-wrapper--missing')).toBe(false);
        expect(credit).toEqual({ logo: 'shown', attribution: 'shown' });
    });

    it('hands the crop marker on to whoever opens the label', () => {
        const marker = { x: 0.5, y: 0.62 };
        expect(renderCard('/cropImage/CurbRamp/1', marker).getCropMarker()).toBe(marker);
        expect(renderCard('/cropImage/CurbRamp/1', null).getCropMarker()).toBeNull();
    });
});
