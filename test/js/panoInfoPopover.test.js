/**
 * Tests for the pano details popover (frontend/js/common/pano-viewer/PanoInfoPopover.js) beyond its view-in-pano link,
 * which panoInfoViewLink.test.js covers: the values it shows, the label rows only the label card and Validate fill,
 * how it opens, closes and places itself over its button, and the text its copy button puts on the clipboard. (#5840)
 */

import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key) => key, language: 'en-US' } }));

/** What the copy button last copied, and from which button. */
let copied;
mockModule('frontend/js/common/copyToClipboard.js', () => ({
  copyToClipboard: (button, text) => { copied = { button, text }; },
}));

const { PanoInfoPopover } = await loadModules('frontend/js/common/pano-viewer/PanoInfoPopover.js');

// app/views/common/panoInfoPopover.scala.html, without its icons and translation attributes.
const POPOVER_MARKUP = `
<div id="pano-info-popover" class="pano-info-popover" popover="manual">
  <header>
    <button type="button" class="pano-info-popover__clipboard"></button>
    <button type="button" class="pano-info-popover__close"></button>
  </header>
  <dl>
    <div><dt>Image ID</dt><dd data-field="image-id">-</dd></div>
    <div><dt>Latitude</dt><dd data-field="latitude">-</dd></div>
    <div><dt>Longitude</dt><dd data-field="longitude">-</dd></div>
    <div class="pano-info-popover__row--hidden" data-optional-row="label-id">
      <dt>Label ID</dt><dd data-field="label-id">-</dd>
    </div>
    <div><dt>Street ID</dt><dd data-field="street-id">-</dd></div>
    <div><dt>Region ID</dt><dd data-field="region-id">-</dd></div>
    <div class="pano-info-popover__row--hidden" data-optional-row="label-date">
      <dt>Labeled</dt><dd data-field="label-date">-</dd>
    </div>
  </dl>
  <a class="pano-info-popover__view-link" href="#" target="_blank" rel="noopener noreferrer">-</a>
</div>`;

const MAPILLARY_LINK = { url: 'https://www.mapillary.com/app/?pKey=pano1&focus=photo', i18nKey: 'view-in-mapillary' };

describe('PanoInfoPopover', () => {
  let popoverEl;
  let viewer;
  /** The values the accessors hand back, replaced per test. */
  let state;
  let logs;

  beforeEach(() => {
    document.body.innerHTML = `<span id="host"></span><p id="elsewhere">page</p>${POPOVER_MARKUP}`;
    popoverEl = document.getElementById('pano-info-popover');
    // jsdom has neither the Popover API nor :popover-open, so both stand on an open flag.
    let open = false;
    popoverEl.showPopover = () => { open = true; };
    popoverEl.hidePopover = () => { open = false; };
    const domMatches = popoverEl.matches.bind(popoverEl);
    popoverEl.matches = (sel) => (sel === ':popover-open' ? open : domMatches(sel));

    viewer = {
      currPanoData: { getPanoId: () => 'pano1' },
      publicViewerLink: vi.fn(() => ({ ...MAPILLARY_LINK })),
      addListener: vi.fn(),
      currCenter: [0.25, 0.5],
    };
    state = {
      viewer,
      coords: { lat: 47.6062095, lng: -122.3320708 },
      panoId: 'pano1',
      streetEdgeId: 1234,
      regionId: 56,
      panoDate: new Date(2021, 6, 15),
      address: '400 Broad St',
      pov: { heading: 90, pitch: -10 },
      labelId: 789,
      labelDate: new Date(2024, 2, 1, 14, 30),
    };
    logs = { info: vi.fn(), clipboard: vi.fn(), viewPano: vi.fn() };
    copied = null;
    window.cityName = 'Seattle';
  });

  /**
   * Builds a popover the way the pages do; Explore passes no label accessors, Validate and the label card do.
   * @param {{whiteIcon?: boolean, withLabel?: boolean}} [options]
   * @returns {PanoInfoPopover} The popover.
   */
  function build({ whiteIcon = true, withLabel = true } = {}) {
    return new PanoInfoPopover(document.getElementById('host'), () => state.viewer, () => state.coords,
      () => state.panoId, () => state.streetEdgeId, () => state.regionId, () => state.panoDate, () => state.address,
      () => state.pov, whiteIcon, logs.info, logs.clipboard, logs.viewPano,
      withLabel ? () => state.labelId : undefined, withLabel ? () => state.labelDate : undefined);
  }

  const button = () => document.getElementById('pano-info-button');
  const field = (name) => popoverEl.querySelector(`[data-field="${name}"]`).textContent;
  const row = (name) => popoverEl.querySelector(`[data-optional-row="${name}"]`);
  const isOpen = () => popoverEl.matches(':popover-open');
  const viewLink = () => popoverEl.querySelector('.pano-info-popover__view-link');

  /** Clicks the copy button and returns what it copied. */
  function copy() {
    popoverEl.querySelector('.pano-info-popover__clipboard').click();
    return copied.text;
  }

  describe('the info button', () => {
    it('comes in white for a dark pano toolbar and blue for the light label card', () => {
      build({ whiteIcon: true });
      expect(button().getAttribute('src')).toContain('images/icons/info-button-white.svg');
      expect(button().alt).toBe('common:pano-info.details-title');

      document.getElementById('host').replaceChildren();
      build({ whiteIcon: false });
      expect(button().getAttribute('src')).toMatch(/images\/icons\/info-button\.svg$/);
    });

    it('opens the popover and logs the click, then closes it on a second click without logging again', () => {
      build();
      button().click();
      expect(isOpen()).toBe(true);
      expect(logs.info).toHaveBeenCalledTimes(1);

      button().click();
      expect(isOpen()).toBe(false);
      expect(logs.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('closing', () => {
    beforeEach(() => {
      build();
      button().click();
    });

    it('closes from its own close button', () => {
      popoverEl.querySelector('.pano-info-popover__close').click();
      expect(isOpen()).toBe(false);
    });

    it('closes on a click elsewhere on the page, but not on a click inside it', () => {
      popoverEl.querySelector('dl').click();
      expect(isOpen()).toBe(true);

      document.getElementById('elsewhere').click();
      expect(isOpen()).toBe(false);
    });

    it('closes when the viewer moves to another pano, and a move while closed leaves it closed', () => {
      const onPanoChanged = viewer.addListener.mock.calls.find(([event]) => event === 'pano_changed')[1];
      onPanoChanged();
      expect(isOpen()).toBe(false);

      onPanoChanged();
      expect(isOpen()).toBe(false);
    });
  });

  describe('the values', () => {
    it('shows the pano, its position to eight places, and the street and region', () => {
      build();
      button().click();

      expect(field('image-id')).toBe('pano1');
      expect(field('latitude')).toBe('47.60620950°');
      expect(field('longitude')).toBe('-122.33207080°');
      expect(field('street-id')).toBe('1234');
      expect(field('region-id')).toBe('56');
    });

    it('says it has no info for whatever the page does not know yet', () => {
      // The label card before its first label: no metadata, so every accessor answers null.
      Object.assign(state, { coords: null, panoId: null, streetEdgeId: null, regionId: null });
      build();
      button().click();

      for (const name of ['image-id', 'latitude', 'longitude', 'street-id', 'region-id']) {
        expect(field(name)).toBe('common:pano-info.no-info');
      }
    });

    it('shows the label rows only on pages that pass the label in', () => {
      build({ withLabel: false });
      expect(row('label-id').classList).toContain('pano-info-popover__row--hidden');
      expect(row('label-date').classList).toContain('pano-info-popover__row--hidden');

      document.getElementById('host').replaceChildren();
      build();
      button().click();
      expect(row('label-id').classList).not.toContain('pano-info-popover__row--hidden');
      expect(field('label-id')).toBe('789');
      const labeled = state.labelDate.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
      expect(field('label-date')).toBe(labeled);
    });

    it('leaves the label rows alone for a label time it cannot read, or no label yet', () => {
      state.labelDate = new Date('not a date');
      state.labelId = undefined;
      build();
      button().click();

      expect(field('label-id')).toBe('-');
      expect(field('label-date')).toBe('-');
    });
  });

  describe('placement over the button', () => {
    /**
     * Opens the popover with the button and popover at the given boxes.
     * @param {number} buttonLeft - The button's left edge, in px.
     */
    function openAt(buttonLeft) {
      build();
      vi.spyOn(button(), 'getBoundingClientRect')
        .mockReturnValue({ left: buttonLeft, top: 500, width: 20, height: 20 });
      vi.spyOn(popoverEl, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 300, height: 200 });
      button().click();
    }

    afterEach(() => {
      document.documentElement.style.removeProperty('--ui-scale');
    });

    it('centers itself above the button, clearing the arrow and a gap, with the arrow on the button', () => {
      openAt(400);

      // 410 is the button's center; the 200px popover sits above its 9px arrow and 4px gap.
      expect(popoverEl.style.left).toBe('260px');
      expect(popoverEl.style.top).toBe(`${500 - 200 - 9 - 4}px`);
      expect(popoverEl.style.getPropertyValue('--pano-info-arrow-left')).toBe('150px');
    });

    it('stays on screen near the left edge, moving its arrow to keep pointing at the button', () => {
      openAt(10);

      expect(popoverEl.style.left).toBe('8px');
      // The button's center is 12px into the popover, but the arrow keeps clear of the rounded corner.
      expect(popoverEl.style.getPropertyValue('--pano-info-arrow-left')).toBe('20px');
    });

    it('scales its arrow and gap with the tool UI', () => {
      document.documentElement.style.setProperty('--ui-scale', '0.5');
      openAt(400);

      expect(popoverEl.style.top).toBe(`${Math.round(500 - 200 - 4.5 - 2)}px`);
    });
  });

  describe('the copy button', () => {
    it('copies every value, the label and the provider link, and logs the click', () => {
      build();
      button().click();
      const text = copy();
      const panoDate = state.panoDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      expect(logs.clipboard).toHaveBeenCalledTimes(1);
      expect(copied.button).toBe(popoverEl.querySelector('.pano-info-popover__clipboard'));
      expect(text).toBe([
        'common:pano-info.pano-address: 400 Broad St',
        'common:pano-info.city: Seattle',
        'common:pano-info.latitude: 47.60620950°',
        'common:pano-info.longitude: -122.33207080°',
        'common:pano-info.image-id: pano1',
        'common:pano-info.street-id: 1234',
        'common:pano-info.region-id: 56',
        `common:pano-info.pano-date: ${panoDate}`,
        'common:pano-info.label-id: 789',
        `common:pano-info.label-date: ${field('label-date')}`,
        `common:pano-info.pano-url: ${MAPILLARY_LINK.url}`,
      ].join('\n'));
    });

    it('leaves out the address and label lines it has nothing for, and says it has no info for the rest', () => {
      Object.assign(state, { address: null, coords: null, panoDate: new Date('not a date') });
      build({ withLabel: false });
      button().click();
      const text = copy();

      expect(text).not.toContain('pano-address');
      expect(text).not.toContain('label-id');
      expect(text).not.toContain('label-date');
      expect(text).toContain('common:pano-info.latitude: common:pano-info.no-info\n');
      expect(text).toContain('common:pano-info.pano-date: common:pano-info.no-info\n');
      expect(text).not.toContain('Invalid Date');
      expect(text).not.toContain('null');
    });

    it('copies the values as of the latest opening', () => {
      build();
      button().click();
      button().click();
      state.panoId = 'pano2';
      viewer.currPanoData = { getPanoId: () => 'pano2' };
      button().click();

      expect(copy()).toContain('common:pano-info.image-id: pano2');
    });
  });

  describe('the view-in-pano link', () => {
    it('opens the provider at the live camera angle, and logs the click', () => {
      build();
      button().click();

      expect(viewer.publicViewerLink).toHaveBeenCalledWith('pano1', { heading: 90, pitch: -10, center: [0.25, 0.5] });
      expect(viewLink().getAttribute('href')).toBe(MAPILLARY_LINK.url);
      expect(viewLink().textContent).toBe('view-in-mapillary common:opens-new-tab');
      viewLink().dispatchEvent(new MouseEvent('click', { cancelable: true }));
      expect(logs.viewPano).toHaveBeenCalledTimes(1);
    });

    it('is hidden while the label card has not built a viewer yet', () => {
      state.viewer = undefined;
      build();
      button().click();

      expect(viewLink().hidden).toBe(true);
      expect(copy()).not.toContain('pano-url');
    });
  });
});
