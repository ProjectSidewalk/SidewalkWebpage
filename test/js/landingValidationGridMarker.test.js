/**
 * The landing page's validation grid (frontend/js/LandingValidationGrid.js): where it draws its label marker (#2660),
 * and how it fills, votes, swaps cards and explains label types (#5840).
 *
 * A card shows a crop or the Street View still it falls back to, and the label is in a different place in each: only
 * a crop's `label_crop` row says where a job-cut window put it, while the still reproduces the Explore frame. These
 * pin that `cropMarker` is used for the crop and only for the crop, and that the validation the card submits reports
 * the same position it drew.
 */

import { loadModules, mockModule, useUtil } from './loader.js';

/** Locale strings the i18next stand-in answers with by key; anything else comes back as its key. */
const translations = {};
mockModule('i18next', () => ({ default: { t: (key) => translations[key] ?? key } }));

/** What the source-logo and licence-line stand-ins were last told: a card owes a credit on a crop and nothing else. */
const credit = { logo: null, attribution: null };

mockModule('frontend/js/common/pano-viewer/PanoViewerLogo.js', () => ({
  createPanoViewerLogo: () => ({
    showSourceLogo: () => { credit.logo = 'shown'; },
    hide: () => { credit.logo = 'hidden'; },
  }),
}));
mockModule('frontend/js/common/pano-viewer/PanoAttribution.js', () => ({
  createPanoAttribution: () => ({
    show: () => { credit.attribution = 'shown'; },
    hide: () => { credit.attribution = 'hidden'; },
  }),
}));

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
  let LandingValidationGrid;
  let lazyIdentityFetch;

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
    credit.logo = null;
    credit.attribution = null;
    document.body.innerHTML = `
            <section id="landing-validation-container" hidden>
              <div id="landing-validation-grid"></div>
            </section>`;
    window.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ labelsOfType: [gridEntry] }),
    }));
    // Votes go through the anonymous-session wrapper, not bare fetch; the grid's start is held for the test to run.
    lazyIdentityFetch = vi.fn(() => Promise.resolve({ ok: true }));
    let start;
    useUtil({ lazyIdentityFetch, onFirstInteractionOrIdle: (fn) => { start = fn; } });
    // The tests read the DOM the grid builds, not the instance.
    const grid = new LandingValidationGrid(document.getElementById('landing-validation-container'));
    expect(grid).toBeInstanceOf(LandingValidationGrid);
    await start();
  }

  beforeAll(async () => {
    window.logWebpageActivity = vi.fn();
    // jsdom has no layout, so it has no matchMedia; the grid asks it how many slots this width shows.
    window.matchMedia = () => ({ matches: false });
    ({ LandingValidationGrid } = await loadModules('frontend/js/LandingValidationGrid.js'));
  });

  it('draws the marker where the crop says its label is', async () => {
    await renderGrid(entry());

    expect(markerPercents()).toEqual({ left: 50, top: 62 });
    expect(credit).toEqual({ logo: 'shown', attribution: 'shown' }); // Our own cut of the panorama owes a credit.
  });

  it('falls back to the canvas fraction for a crop nothing has recorded yet', async () => {
    await renderGrid(entry({ cropMarker: null }));

    expect(markerPercents()).toEqual({ left: 25, top: 75 });
  });

  it('uses the canvas fraction on the Street View still, which reproduces the Explore frame', async () => {
    await renderGrid(entry({ cropUrl: null, cropMarker: null }));

    expect(markerPercents()).toEqual({ left: 25, top: 75 });
    // Google bakes its logo and copyright into the still; a second logo on top printed the name twice.
    expect(credit).toEqual({ logo: 'hidden', attribution: 'hidden' });
  });

  it('moves the marker to the canvas fraction when the crop fails and the still takes its place', async () => {
    await renderGrid(entry());
    expect(markerPercents()).toEqual({ left: 50, top: 62 });

    const img = document.querySelector('.lvg-card-photo');
    img.dispatchEvent(new Event('error')); // The crop 404s; the card retries with the still.

    expect(document.querySelector('.lvg-card').dataset.imageSource).toBe('api');
    expect(markerPercents()).toEqual({ left: 25, top: 75 });
    expect(credit).toEqual({ logo: 'hidden', attribution: 'hidden' }); // The still brands itself.
  });

  // With `return_error_code` on the still (#5327) an expired pano 404s instead of answering with a grey "no
  // imagery" card, so a card that has lost its crop as well is dead weight, and the grid swaps in the next label.
  it('swaps the card for a fresh label when the still fails after the crop', async () => {
    await renderGrid(entry());
    const card = document.querySelector('.lvg-card');
    const img = card.querySelector('.lvg-card-photo');
    // The pool is empty after the first render, so the swap refills it; the refill returns the next label.
    window.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ labelsOfType: [entry({
        label: { ...entry().label, label_id: 2 }, cropUrl: '/cropImage/CurbRamp/2',
      })] }),
    }));

    img.dispatchEvent(new Event('error')); // The crop 404s; the card retries with the still.
    img.dispatchEvent(new Event('error')); // The still 404s too.
    await new Promise((resolve) => setTimeout(resolve, 0)); // The refill's fetch and json both settle.

    expect(document.contains(card)).toBe(false);
    const cards = document.querySelectorAll('.lvg-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector('.lvg-card-photo').src).toContain('/cropImage/CurbRamp/2');
    expect(cards[0].dataset.imageSource).toBe('crop');
    // The refill asks for labels the page has not shown, so the same expired one cannot come straight back.
    expect(JSON.parse(window.fetch.mock.calls[0][1].body).loaded_labels).toEqual([1]);
    expect(document.getElementById('landing-validation-container').hidden).toBe(false);
  });

  it('reports the position it drew, not the canvas fraction, with the validation', async () => {
    await renderGrid(entry());
    const img = document.querySelector('.lvg-card-photo');
    Object.defineProperty(img, 'clientWidth', { value: 300 });
    Object.defineProperty(img, 'clientHeight', { value: 200 });

    document.querySelector('.lvg-btn-agree').click();
    await Promise.resolve();

    const validate = lazyIdentityFetch.mock.calls.find(([url]) => url === '/labelmap/validate');
    expect(validate).toBeDefined();
    const payload = JSON.parse(validate[1].body);
    expect([payload.canvas_x, payload.canvas_y]).toEqual([150, 124]); // 0.5 x 300, 0.62 x 200.
  });
});

describe('filling the grid, voting, and swapping cards', () => {
  let LandingValidationGrid;
  let lazyIdentityFetch;
  /** Each /label/labels answer still to give, in order; an empty queue answers with no labels. */
  let batches;
  /** The /label/labels request bodies, in order. */
  let requests;
  let logged;
  let narrow;
  let saveData;

  const section = () => document.getElementById('landing-validation-container');
  const cards = () => [...document.querySelectorAll('.lvg-card')];

  /**
   * A label in its own card-sized batch entry.
   * @param {number} id - The label id.
   * @param {object} [overrides] - Entry fields to replace; `label` merges into the label.
   * @returns {object} The entry.
   */
  const labelEntry = (id, { label = {}, ...rest } = {}) => entry({
    label: { ...entry().label, label_id: id, ...label }, cropUrl: `/cropImage/CurbRamp/${id}`, ...rest,
  });

  /**
   * Builds the grid and runs its first fill, answering /label/labels from `batches`.
   * @returns {Promise<void>}
   */
  async function renderGrid() {
    document.body.innerHTML = `
      <section id="landing-validation-container" hidden><div id="landing-validation-grid"></div></section>`;
    window.fetch = vi.fn(async (url, options) => {
      requests.push(JSON.parse(options.body));
      const next = batches.length ? batches.shift() : { labelsOfType: [] };
      if (typeof next === 'function') return next();
      return { ok: true, json: async () => next };
    });
    let start;
    useUtil({
      lazyIdentityFetch, onFirstInteractionOrIdle: (fn) => { start = fn; }, saveDataEnabled: () => saveData,
    });
    expect(new LandingValidationGrid(section())).toBeInstanceOf(LandingValidationGrid);
    // Skeletons hold the space until the first fill.
    expect(document.querySelectorAll('.lvg-card-skeleton')).toHaveLength(6);
    expect(section().hidden).toBe(false);
    await start();
  }

  /** Lets queued fetch and timer callbacks settle. */
  const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

  beforeEach(async () => {
    batches = [];
    requests = [];
    logged = [];
    narrow = false;
    saveData = false;
    for (const key of Object.keys(translations)) delete translations[key];
    translations['validate:top-ui.title.curb-ramp'] = 'Is this a <b>curb ramp</b>?';
    translations['common:mission-start-tutorial.curb-ramp.slide-1.description'] = 'A <b>ramp</b> down to the street.';
    window.logWebpageActivity = (activity) => logged.push(activity);
    window.matchMedia = (query) => ({ matches: query === '(width <= 650px)' && narrow });
    lazyIdentityFetch = vi.fn(async () => ({ ok: true }));
    ({ LandingValidationGrid } = await loadModules('frontend/js/LandingValidationGrid.js'));
  });

  test('asks for recent labels needing validation, from static imagery, and logs how many it showed', async () => {
    batches = [{ labelsOfType: [labelEntry(1), labelEntry(2)] }];
    await renderGrid();

    expect(requests[0]).toEqual({
      n: 12,
      loaded_labels: [],
      validation_options: ['unvalidated', 'unsure'],
      sort: 'recent',
      static_imagery_only: true,
    });
    expect(cards()).toHaveLength(2);
    // Skeletons past the labels there are go away.
    expect(document.querySelectorAll('.lvg-card-skeleton')).toHaveLength(0);
    expect(logged).toEqual(['View_module=LandingValidationGrid_labelCount=2']);
  });

  test('skips the visitor\'s own labels, ones they already voted on, and ones with no image', async () => {
    batches = [{
      labelsOfType: [
        labelEntry(1, { label: { from_current_user: true } }),
        labelEntry(2, { label: { user_validation: 'Agree' } }),
        labelEntry(3, { cropUrl: null, gsvImageUrl: null }),
      ],
    }];
    await renderGrid();

    expect(section().hidden).toBe(true);
    expect(logged).toEqual(['View_module=LandingValidationGrid_labelCount=0']);
  });

  test('a city with nothing to validate hides the section', async () => {
    batches = [{}];
    await renderGrid();
    expect(cards()).toEqual([]);
    expect(section().hidden).toBe(true);
  });

  test('a failed label request is reported and leaves the section hidden', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    batches = [() => ({ ok: false, status: 500 })];
    await renderGrid();
    expect(error).toHaveBeenCalledWith('Failed to load labels for the validation grid', expect.any(Error));
    expect(section().hidden).toBe(true);
  });

  test('crop cards come first, and only crops in slots this width shows load eagerly', async () => {
    const still = (id) => labelEntry(id, { cropUrl: null, cropMarker: null });
    batches = [{ labelsOfType: [still(1), labelEntry(2), labelEntry(3), labelEntry(4), labelEntry(5), still(6)] }];
    narrow = true;
    await renderGrid();

    expect(cards().map((card) => card.dataset.imageSource)).toEqual(['crop', 'crop', 'crop', 'crop', 'api', 'api']);
    // Narrow screens show three cards; a Street View still is billed per image, so it never loads early.
    expect(cards().map((card) => card.querySelector('.lvg-card-photo').loading))
      .toEqual(['eager', 'eager', 'eager', 'lazy', 'lazy', 'lazy']);
  });

  test('a visitor saving data gets every image lazily', async () => {
    saveData = true;
    batches = [{ labelsOfType: [labelEntry(1)] }];
    await renderGrid();
    expect(cards()[0].querySelector('.lvg-card-photo').loading).toBe('lazy');
  });

  test('a label type with no icon gets no marker, even after falling back to the still', async () => {
    batches = [{ labelsOfType: [labelEntry(1, { label: { label_type: 'Mystery' } })] }];
    await renderGrid();
    expect(cards()[0].querySelector('.lvg-card-marker')).toBeNull();
    cards()[0].querySelector('.lvg-card-photo').dispatchEvent(new Event('error'));
    expect(cards()[0].dataset.imageSource).toBe('api');
    expect(cards()[0].querySelector('.lvg-card-marker')).toBeNull();
  });

  test('a crop that fails with no still to fall back on swaps the card straight away', async () => {
    batches = [{ labelsOfType: [labelEntry(1, { gsvImageUrl: null })] }, { labelsOfType: [labelEntry(2)] }];
    await renderGrid();
    cards()[0].querySelector('.lvg-card-photo').dispatchEvent(new Event('error'));
    await settle();
    expect(cards()[0].querySelector('.lvg-card-photo').src).toContain('/cropImage/CurbRamp/2');
  });

  test('a signed crop that fails is re-signed once before the billed still is tried (#5861)', async () => {
    batches = [{ labelsOfType: [labelEntry(1, { cropUrl: '/cropImage/CurbRamp/1?exp=1&sig=old' })] }];
    await renderGrid();
    const fresh = '/cropImage/CurbRamp/1?exp=2&sig=new';
    window.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ image_url: fresh }) }));
    const photo = cards()[0].querySelector('.lvg-card-photo');

    photo.dispatchEvent(new Event('error'));
    await settle();
    expect(window.fetch).toHaveBeenCalledWith('/cropImage/CurbRamp/1/metadata');
    expect(photo.getAttribute('src')).toBe(fresh);
    expect(cards()[0].dataset.imageSource).toBe('crop');

    photo.dispatchEvent(new Event('error')); // The fresh URL fails too: on to the still.
    expect(cards()[0].dataset.imageSource).toBe('api');
  });

  test('the share chip logs which label was shared', async () => {
    batches = [{ labelsOfType: [labelEntry(7)] }];
    await renderGrid();
    const trigger = cards()[0].querySelector('.lvg-share .label-detail__share-trigger');
    trigger.click();
    expect(logged).toContain('Click_module=LandingValidationGridShare_labelId=7');
    // Closed again once its page-wide Escape handler is on, or that handler would swallow later tests' keys.
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  describe('the label-type tooltip', () => {
    /** @returns {{term: HTMLElement, tip: HTMLElement, row: HTMLElement}} The first card's tooltip parts. */
    const parts = () => {
      const row = cards()[0].querySelector('.lvg-card-question-row');
      return { row, term: row.querySelector('.lvg-type-term'), tip: row.querySelector('.lvg-type-tip') };
    };

    beforeEach(async () => {
      batches = [{ labelsOfType: [labelEntry(1)] }];
      await renderGrid();
      logged = [];
    });

    test('hovering the bolded type shows its explanation, logged once, and leaving hides it after a beat', () => {
      vi.useFakeTimers();
      const { term, tip } = parts();
      expect(term.textContent).toBe('curb ramp');
      expect(term.getAttribute('aria-describedby')).toBe(tip.id);
      expect(tip.innerHTML).toBe('A <b>ramp</b> down to the street.');
      expect(tip.hidden).toBe(true);

      term.dispatchEvent(new MouseEvent('mouseenter'));
      expect(tip.hidden).toBe(false);
      term.dispatchEvent(new MouseEvent('mouseleave'));
      // On its way into the tooltip, the pointer cancels the hide.
      tip.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(300);
      expect(tip.hidden).toBe(false);
      tip.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(300);
      expect(tip.hidden).toBe(true);

      term.dispatchEvent(new MouseEvent('mouseenter'));
      expect(logged).toEqual(['Click_module=LandingValidationGridInfo_labelType=CurbRamp']);
    });

    test('keyboard focus shows it, Escape hides it, and moving focus away hides it', () => {
      vi.useFakeTimers();
      const { term, tip, row } = parts();
      term.focus();
      expect(tip.hidden).toBe(false);
      // The pointer leaving doesn't hide it while focus is still on the term.
      term.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(300);
      expect(tip.hidden).toBe(false);

      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(tip.hidden).toBe(true);
      // Escape with it already hidden, or any other key, changes nothing.
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      expect(tip.hidden).toBe(true);

      term.dispatchEvent(new MouseEvent('mouseenter'));
      term.blur();
      expect(tip.hidden).toBe(true);
    });

    test('a click pins it open through pointer and focus leaving, and a second click unpins it', () => {
      vi.useFakeTimers();
      const { term, tip } = parts();
      term.click();
      expect(tip.hidden).toBe(false);
      term.dispatchEvent(new MouseEvent('mouseleave'));
      term.focus();
      term.blur();
      vi.advanceTimersByTime(300);
      expect(tip.hidden).toBe(false);

      term.click();
      expect(tip.hidden).toBe(true);
    });
  });

  test('a translation without an emphasized type name goes without the tooltip', async () => {
    translations['validate:top-ui.title.curb-ramp'] = 'Is this a curb ramp?';
    batches = [{ labelsOfType: [labelEntry(1)] }];
    await renderGrid();
    expect(cards()[0].querySelector('.lvg-type-tip')).toBeNull();
  });

  test('a vote is sent from the still as a Street View vote, thanks the visitor, then swaps in a pooled label',
    async () => {
      const still = (id) => labelEntry(id, { cropUrl: null, cropMarker: null });
      batches = [{ labelsOfType: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(still) }];
      await renderGrid();
      const card = cards()[0];
      vi.useFakeTimers();

      const disagree = card.querySelector('.lvg-btn-disagree');
      disagree.focus();
      disagree.click();
      expect([...card.querySelectorAll('.lvg-btn')].every((button) => button.disabled)).toBe(true);
      await vi.advanceTimersByTimeAsync(0);

      const payload = JSON.parse(lazyIdentityFetch.mock.calls[0][1].body);
      expect(payload).toMatchObject({
        label_id: 1, validation_result: 'Disagree', source: 'LandingPage', viewer_type: 'StaticApi',
      });
      expect(logged).toContain('Click_module=LandingValidationGrid_result=Disagree_labelId=1');
      expect(disagree.classList.contains('lvg-btn-chosen')).toBe(true);
      expect(card.querySelector('.lvg-card-thanks').textContent).toBe('common:map.thanks');

      // Plenty left in the pool, so no refill is needed.
      const sent = requests.length;
      await vi.advanceTimersByTimeAsync(1200);
      expect(document.contains(card)).toBe(false);
      expect(requests).toHaveLength(sent);
      // Keyboard focus follows into the fresh card rather than dropping to the page.
      expect(document.activeElement.classList.contains('lvg-btn')).toBe(true);
      expect(cards()).toHaveLength(6);
    });

  test('a vote the server refuses is reported and the buttons come back', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    lazyIdentityFetch = vi.fn(async () => ({ ok: false, status: 403 }));
    batches = [{ labelsOfType: [labelEntry(1)] }];
    await renderGrid();
    cards()[0].querySelector('.lvg-btn-unsure').click();
    await settle();

    expect(error).toHaveBeenCalledWith('Failed to submit validation', expect.any(Error));
    expect([...cards()[0].querySelectorAll('.lvg-btn')].some((button) => button.disabled)).toBe(false);
    expect(cards()[0].querySelector('.lvg-card-thanks')).toBeNull();
  });

  test('with the pool running low the next card comes from the pool while a refill runs, only one at a time',
    async () => {
      batches = [{ labelsOfType: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => labelEntry(id)) }];
      await renderGrid();
      let answerRefill;
      batches = [() => new Promise((resolve) => { answerRefill = resolve; })];
      const [first, second] = cards();

      first.querySelector('.lvg-card-photo').dispatchEvent(new Event('error'));
      first.querySelector('.lvg-card-photo').dispatchEvent(new Event('error'));
      second.querySelector('.lvg-card-photo').dispatchEvent(new Event('error'));
      second.querySelector('.lvg-card-photo').dispatchEvent(new Event('error'));
      await settle();

      // Both swaps drew from the pool; the second found the refill already under way and didn't start another.
      expect(requests).toHaveLength(2);
      expect(requests[1]).toMatchObject({ n: 6, loaded_labels: [1, 2, 3, 4, 5, 6, 7, 8] });
      expect(cards().map((card) => card.querySelector('.lvg-card-photo').src.split('/').pop()))
        .toEqual(['7', '8', '3', '4', '5', '6']);
      answerRefill({ ok: true, json: async () => ({ labelsOfType: [] }) });
      await settle();
    });

  test('with nothing left to show, a finished card is removed, and the last one hides the section', async () => {
    batches = [{ labelsOfType: [labelEntry(1)] }];
    await renderGrid();
    const img = cards()[0].querySelector('.lvg-card-photo');
    img.dispatchEvent(new Event('error'));
    img.dispatchEvent(new Event('error'));
    await settle();
    expect(cards()).toEqual([]);
    expect(section().hidden).toBe(true);
  });

  test('a card removed while others remain leaves the section showing', async () => {
    batches = [{ labelsOfType: [labelEntry(1), labelEntry(2)] }];
    await renderGrid();
    const img = cards()[0].querySelector('.lvg-card-photo');
    img.dispatchEvent(new Event('error'));
    img.dispatchEvent(new Event('error'));
    await settle();
    expect(cards()).toHaveLength(1);
    expect(section().hidden).toBe(false);
  });
});
