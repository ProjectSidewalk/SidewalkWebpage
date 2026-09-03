/**
 * Tests for PanoInfoPopover's "view in <provider>" link (public/js/common/pano-viewer/src/PanoInfoPopover.js).
 *
 * Regression coverage for #4813. Validate (and the Gallery/LabelMap label card) swap the active pano viewer from
 * label to label: the provider's own viewer for live imagery, Pannellum for our self-hosted copy of imagery the
 * provider has dropped, and a static crop when neither exists. Only the first of those has anywhere to link to, so
 * the popover resolves the active viewer on every open and offers the link only when that viewer both publishes a
 * public site and is holding the pano on screen.
 *
 * PanoInfoPopover is a top-level `class` declaration written for the Grunt-concatenation world, so — as with
 * ShareWidget — the source is eval'd into the jsdom global scope with an explicit `window.X = X` epilogue rather
 * than require()-d.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub } = require('./loadGlobalScript');

const POPOVER_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src/PanoInfoPopover.js'), 'utf8'
);

// The parts of app/views/common/panoInfoPopover.scala.html the class actually reads. Kept minimal on purpose: if a
// selector is renamed there without being renamed here, these tests fail, which is the point.
const POPOVER_MARKUP = `
<div id="pano-info-popover" popover="manual">
  <button type="button" class="pano-info-popover__clipboard"></button>
  <button type="button" class="pano-info-popover__close"></button>
  <span class="pano-info-popover__copied" hidden></span>
  <dl>
    <div><dd class="pano-info-popover__val" data-field="image-id">-</dd></div>
    <div><dd class="pano-info-popover__val" data-field="latitude">-</dd></div>
    <div><dd class="pano-info-popover__val" data-field="longitude">-</dd></div>
    <div><dd class="pano-info-popover__val" data-field="street-id">-</dd></div>
    <div><dd class="pano-info-popover__val" data-field="region-id">-</dd></div>
  </dl>
  <a class="pano-info-popover__view-link" href="#" target="_blank" rel="noopener noreferrer">-</a>
</div>`;

const GSV_PANO = 'gsvPano1';
const BACKUP_PANO = 'backupPano2';
const CROPPED_PANO = 'croppedPano3';

/**
 * Minimal stand-in for a PanoViewer. `link` mirrors the real contract: a {url, i18nKey} for providers with a public
 * viewer (GsvViewer, MapillaryViewer), null for those without — Infra3d, and Pannellum, which inherits PanoViewer's
 * null-returning base implementation because our self-hosted backup image has no provider page to link to.
 * `currPanoData` is what the popover reads to tell whether this viewer is the one showing the pano on screen.
 */
function makeViewer(panoId, link) {
    return {
        panoId,
        currPanoData: { getPanoId: () => panoId },
        publicViewerLink: jest.fn(() => (link ? { ...link } : null)),
        getPosition: () => ({ lat: 38.9, lng: -77.0 }),
        getPov: () => ({ heading: 12, pitch: -3 }),
        addListener: jest.fn(),
    };
}

/** A provider-hosted viewer: has a real destination. */
const makeGsvViewer = () => makeViewer(GSV_PANO, {
    url: `https://www.google.com/maps/@?api=1&map_action=pano&pano=${GSV_PANO}&heading=12&pitch=-3`,
    i18nKey: 'common:pano-info.view-in-gsv',
});

/** The Pannellum fallback: self-hosted imagery, so no public link. */
const makePannellumViewer = () => makeViewer(BACKUP_PANO, null);

describe('PanoInfoPopover view-in-pano link', () => {
    let PanoInfoPopover;
    let activeViewer;
    let popoverEl;
    let viewLink;
    let clipboardText;
    // Explore and Validate report the active viewer's own pano id; the Gallery/LabelMap label card reports the pano
    // id off the label's metadata instead, which is how the two can disagree on the static-crop fallback. Leave this
    // null for the viewer-sourced shape, set it for the label-sourced one.
    let labelPanoId;

    /** Constructs a popover whose accessors all read through `activeViewer`, as the real call sites now do. */
    function buildPopover() {
        return new PanoInfoPopover(
            document.getElementById('host'),
            () => activeViewer,
            () => activeViewer.getPosition(),
            () => labelPanoId ?? activeViewer.panoId,
            () => 100,  // streetEdgeId
            () => 200,  // regionId
            () => ({ format: () => 'Jan 2020' }),  // panoDate
            () => '123 Main St',                   // panoAddress
            () => activeViewer.getPov(),
            true,           // whiteIcon
            jest.fn(),      // infoLogging
            jest.fn(),      // clipboardLogging
            jest.fn(),      // viewPanoLogging
        );
    }

    /** Clicks the info button, which is what triggers the popover's value/link refresh. */
    function openPopover() {
        document.getElementById('pano-info-button').click();
    }

    /** Closes the popover so the next openPopover() takes the "open" branch of the toggle. */
    function closePopover() {
        document.getElementById('pano-info-button').click();
    }

    beforeEach(() => {
        document.body.innerHTML = `<span id="host"></span>${POPOVER_MARKUP}`;
        popoverEl = document.getElementById('pano-info-popover');
        viewLink = popoverEl.querySelector('.pano-info-popover__view-link');

        // jsdom (via jest-environment-jsdom 29) implements neither the Popover API nor the :popover-open
        // pseudo-class, so stand both up over a simple open flag.
        let open = false;
        popoverEl.showPopover = () => { open = true; };
        popoverEl.hidePopover = () => { open = false; };
        const domMatches = popoverEl.matches.bind(popoverEl);
        popoverEl.matches = (sel) => (sel === ':popover-open' ? open : domMatches(sel));

        // Translations render as their raw keys so assertions stay locale-independent.
        window.i18next = { t: (key) => key };
        window.util = { assetPath: assetPathStub }; // The info button's icon URL.
        window.cityName = 'Washington';
        clipboardText = null;
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: jest.fn((text) => { clipboardText = text; return Promise.resolve(); }) },
            configurable: true,
        });

        window.eval(`${POPOVER_SRC}\nwindow.PanoInfoPopover = PanoInfoPopover;`);
        PanoInfoPopover = window.PanoInfoPopover;

        activeViewer = makeGsvViewer();
        labelPanoId = null;
    });

    it('shows the provider link when the active viewer has a public viewer', () => {
        buildPopover();
        openPopover();

        expect(viewLink.style.display).not.toBe('none');
        expect(viewLink.getAttribute('href')).toContain(`pano=${GSV_PANO}`);
        expect(viewLink.textContent).toBe('common:pano-info.view-in-gsv');
    });

    it('hides the link, rather than leaving href="#", when the first pano opened is a Pannellum one', () => {
        // The markup ships with href="#", which resolves to the current page — so leaving the link visible and
        // untouched would open Validate again in a new tab.
        activeViewer = makePannellumViewer();
        buildPopover();
        openPopover();

        expect(viewLink.style.display).toBe('none');
        expect(viewLink.hasAttribute('href')).toBe(false);
    });

    it('drops a stale provider link when the viewer swaps to Pannellum', () => {
        // A link left in place across the swap points at the previous label's pano, which is worse than none.
        buildPopover();
        openPopover();
        expect(viewLink.getAttribute('href')).toContain(`pano=${GSV_PANO}`);
        closePopover();

        activeViewer = makePannellumViewer();
        openPopover();

        expect(viewLink.style.display).toBe('none');
        expect(viewLink.hasAttribute('href')).toBe(false);
    });

    it('restores the link when the viewer swaps back to a provider-hosted pano', () => {
        activeViewer = makePannellumViewer();
        buildPopover();
        openPopover();
        expect(viewLink.style.display).toBe('none');
        closePopover();

        activeViewer = makeGsvViewer();
        openPopover();

        expect(viewLink.style.display).not.toBe('none');
        expect(viewLink.getAttribute('href')).toContain(`pano=${GSV_PANO}`);
    });

    it('hides the link on the static-crop fallback, where the provider viewer holds a different pano', () => {
        // Gallery/LabelMap fall back to a stored crop when neither live nor backup imagery exists. panoViewer is
        // pointed back at the provider's viewer, still sitting on whatever pano it loaded for an earlier label, so
        // the provider does publish a viewer — it just isn't showing this label. Building the link anyway lands the
        // user on a provider page for imagery the provider has already dropped.
        labelPanoId = CROPPED_PANO;
        buildPopover();
        openPopover();

        expect(viewLink.style.display).toBe('none');
        expect(viewLink.hasAttribute('href')).toBe(false);
        expect(activeViewer.publicViewerLink).not.toHaveBeenCalled();
    });

    it('shows the link when the provider viewer is holding the label-sourced pano', () => {
        labelPanoId = GSV_PANO;
        buildPopover();
        openPopover();

        expect(viewLink.style.display).not.toBe('none');
        expect(viewLink.getAttribute('href')).toContain(`pano=${GSV_PANO}`);
    });

    it('reads the displayed values from the active viewer, not the one present at construction', () => {
        buildPopover();
        openPopover();
        expect(popoverEl.querySelector('[data-field="image-id"]').textContent).toBe(GSV_PANO);
        closePopover();

        activeViewer = makePannellumViewer();
        openPopover();

        expect(popoverEl.querySelector('[data-field="image-id"]').textContent).toBe(BACKUP_PANO);
    });

    it('builds the link against the active viewer and the live camera angle', () => {
        activeViewer = makePannellumViewer();
        const pannellumViewer = activeViewer;
        buildPopover();
        openPopover();

        expect(pannellumViewer.publicViewerLink).toHaveBeenCalledWith(
            BACKUP_PANO, expect.objectContaining({ heading: 12, pitch: -3 })
        );
    });

    it('omits the pano URL from the copied text when there is no link', () => {
        buildPopover();
        openPopover();
        popoverEl.querySelector('.pano-info-popover__clipboard').click();
        expect(clipboardText)
            .toContain(`Pano URL: https://www.google.com/maps/@?api=1&map_action=pano&pano=${GSV_PANO}`);
        closePopover();

        activeViewer = makePannellumViewer();
        openPopover();
        popoverEl.querySelector('.pano-info-popover__clipboard').click();

        expect(clipboardText).toContain(BACKUP_PANO);
        expect(clipboardText).not.toContain('Pano URL:');
    });

    it('closes on pano_changed from a viewer that only appeared after construction', () => {
        // Pannellum is built lazily, so the popover can't subscribe to it up front — it has to attach on open.
        buildPopover();
        const pannellumViewer = makePannellumViewer();
        activeViewer = pannellumViewer;
        openPopover();

        expect(pannellumViewer.addListener).toHaveBeenCalledWith('pano_changed', expect.any(Function));
        expect(popoverEl.matches(':popover-open')).toBe(true);

        // Fire the handler the popover registered; it should close itself rather than sit there showing stale values.
        const handler = pannellumViewer.addListener.mock.calls
            .find(([event]) => event === 'pano_changed')[1];
        handler();

        expect(popoverEl.matches(':popover-open')).toBe(false);
    });

    it('subscribes to each viewer only once, however many times the popover is opened', () => {
        const gsvViewer = activeViewer;
        buildPopover();
        openPopover();
        closePopover();
        openPopover();
        closePopover();

        const panoChangedSubscriptions = gsvViewer.addListener.mock.calls
            .filter(([event]) => event === 'pano_changed');
        expect(panoChangedSubscriptions).toHaveLength(1);
    });
});
