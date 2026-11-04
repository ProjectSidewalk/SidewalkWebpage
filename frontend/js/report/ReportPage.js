/**
 * Runs what a report draws in the browser: the region map beside the street list, the worst-problems map, one section
 * per street, the fixes'
 * cards, and the sidebar's controls. It decides when each piece exists, since the page may have fifty streets and a
 * browser has room for only a few live maps.
 */

import { AccessScoreGradeRamp } from '../common/AccessScoreGradeRamp.js';
import { util } from '../common/utilities.js';
import { AccessScoreWeightsPanel } from '../access-score/AccessScoreWeightsPanel.js';
import { LabelMiniCard } from '../common/LabelMiniCard.js';
import { ReportStreetSection } from './ReportStreetSection.js';
import { reportSketch } from './reportSketch.js';
import i18next from 'i18next';

export class ReportPage {
  /** Well under the browser's limit of about 16, and more than fit on a screen. */
  static MAX_LIVE_MAPS = 4;
  // Starts a map and its cards a screen ahead, so that a reader scrolling at a normal pace doesn't see them arrive.
  static #NEAR_VIEWPORT = '100% 0px';
  static #SCROLL_KEY = 'report:scrollY';

  /** @type {Record<string, any>} */ #data;
  /** @type {any} */ #deps;
  /** @type {ReportStreetSection[]} */ #sections = [];
  /** Sections close enough to be worth a map; #assignMaps picks from these. */
  /** @type {Set<ReportStreetSection>} */ #near = new Set();
  /** @type {?Promise<GeoJSON.FeatureCollection>} */ #sidewalks = null;
  /** @type {?Promise<Record<string, any>>} */ #config = null;
  /** @type {?IntersectionObserver} */ #observer = null;
  /** @type {any} */ #regionMap = null;
  /** @type {any} */ #worstMap = null;
  /** @type {?IntersectionObserver} */ #slotObserver = null;
  /** @type {(event: string) => void} */ #log;
  /** @type {HTMLElement[]} */ #fixSlots = [];
  #fixesLoaded = false;
  /** @type {?number[]} */ #colorBreaks = null;
  // Off at first: the streets then read as AccessScore draws them, one line each.
  #sidewalksVisible = false;

  /**
   * @param {Record<string, any>} data - The page's `report-data` JSON.
   * @param {object} deps
   * @param {(container: HTMLElement, options: any) => any} deps.createMap
   * @param {(labelIds: number[]) => Promise<Map<number, Record<string, any>>>} deps.fetchCards
   * @param {(entry: Record<string, any>, log: (event: string) => void) => any} deps.buildCard
   * @param {(event: string) => void} deps.log
   * @param {(url: string) => void} [deps.navigate] - Opens the report under new weights; a test stands in for it.
   */
  constructor(data, deps) {
    this.#data = data;
    this.#deps = deps;
    this.#log = deps.log;
  }

  /** Builds everything that can be built now and watches for the rest. */
  start() {
    const { edges, cityId, streets } = this.#data;
    const sectionDeps = {
      edges,
      cityId,
      createMap: (container, options) => this.#deps.createMap(container, {
        ...options, basemap: this.#data.basemap, places: this.#data.places ?? [],
      }),
      fetchCards: this.#deps.fetchCards,
      buildCard: (entry) => this.#deps.buildCard(entry, this.#log),
      sidewalks: () => this.#fetchSidewalks(),
      fetchGrade: (edgeId) => util.fetchJson(`/v3/api/streetGrade?streetEdgeId=${edgeId}`),
      gradeBreaks: () => this.#fetchGradeBreaks(),
      log: this.#log,
    };
    for (const street of streets) {
      const selector = `.report-street[data-street="${street.id}"]`;
      const element = /** @type {?HTMLElement} */ (document.querySelector(selector));
      if (element) this.#sections.push(new ReportStreetSection(element, street, sectionDeps));
    }
    this.#startRegionMap();
    this.#startWorstMap();
    this.#watchSections();
    this.#watchFixes();
    this.#wireSidewalkToggle();
    this.#wireColorBy();
    this.#wireWeights();
    this.#restoreScroll();
  }

  /** @returns {Promise<Record<string, any>>} `/v3/api/accessScoreConfig`'s answer, fetched once. */
  #fetchConfig() {
    this.#config ??= util.fetchJson('/v3/api/accessScoreConfig');
    return this.#config;
  }

  /** @returns {Promise<?number[]>} The city's slope classes, or null where it has no gradient data. */
  async #fetchGradeBreaks() {
    const { grade } = await this.#fetchConfig();
    return grade?.sources?.length > 0 && grade.map_class_breaks?.length > 0 ? grade.map_class_breaks : null;
  }

  /**
   * The server scores the whole report, so letting go of a slider reopens it under the new weights (the tool's `w`
   * and `gs` parameters); a drag only moves the slider.
   */
  async #wireWeights() {
    const control = document.getElementById('report-weights-control');
    if (!control) return;
    let config;
    try {
      config = await this.#fetchConfig();
    } catch (err) {
      console.warn('Report weights could not load', err);
      return;
    }
    const panel = new AccessScoreWeightsPanel(control, config, { gradeRow: true });
    const { weights } = this.#data;
    panel.setWeights(weights.types, weights.grade);
    panel.setContributions(this.#data.contributions);
    if (weights.custom) panel.setOpen(true);
    panel.onChange((partial, { kind, value, final }) => {
      if (!final) return;
      this.#log(`Report_${kind}${value ? `_${value}` : ''}`);
      if (kind === 'Section') return;
      if (kind === 'Reset') panel.setWeights(config.presets.default, config.grade_scoring?.defaults.weight);
      this.#reopen(panel.isDefault ? null : panel.values);
    });
    control.hidden = false;
  }

  /**
   * Reopens the report under other weights, where the reader was on the page.
   * @param {?{weights: Record<string, number>, gradeWeight: ?number}} values - Null for the engine's own.
   */
  #reopen(values) {
    const url = new URL(window.location.href);
    // The panel sets only the grade weight, so a link's other slope settings (statistic, thresholds, barrier) stay,
    // until Reset (null values) returns everything to the engine's own.
    const replacesGrade = values !== null && values.gradeWeight !== null;
    const otherSlope = values
      ? (url.searchParams.get('gs') ?? '').split(',').filter((t) => t && !(replacesGrade && t.startsWith('w:')))
      : [];
    url.searchParams.delete('w');
    url.searchParams.delete('gs');
    if (values) {
      url.searchParams.set('w', Object.entries(values.weights).map(([type, w]) => `${type}:${w}`).join(','));
    }
    const grade = replacesGrade ? [`w:${values.gradeWeight}`] : [];
    const slope = [...grade, ...otherSlope];
    if (slope.length) url.searchParams.set('gs', slope.join(','));
    try {
      sessionStorage.setItem(ReportPage.#SCROLL_KEY, String(window.scrollY));
    } catch {
      // Without storage the report reopens at its top, which still reads correctly.
    }
    // Written as the tool writes them, so a copied link reads `w=NoCurbRamp:2` rather than `w=NoCurbRamp%3A2`.
    const href = url.toString().replace(/%3A/gi, ':').replace(/%2C/gi, ',');
    (this.#deps.navigate ?? ((target) => window.location.assign(target)))(href);
  }

  #restoreScroll() {
    let y;
    try {
      y = sessionStorage.getItem(ReportPage.#SCROLL_KEY);
      sessionStorage.removeItem(ReportPage.#SCROLL_KEY);
    } catch {
      return;
    }
    if (y !== null) window.scrollTo(0, Number(y));
  }

  /** The score-or-slope switch, which only appears where a street in the region has a grade to color by. */
  async #wireColorBy() {
    const group = document.getElementById('report-color-by');
    if (!group || !this.#data.edges.some((e) => Number.isFinite(e.grade))) return;
    let breaks = null;
    try {
      breaks = await this.#fetchGradeBreaks();
    } catch (err) {
      console.warn('Report slope classes failed to load', err);
    }
    if (!breaks) return;
    group.hidden = false;
    const legend = document.getElementById('report-slope-legend');
    const { percent } = AccessScoreGradeRamp;
    legend.replaceChildren(...AccessScoreGradeRamp.classes(breaks).map(({ from, to, color }) => {
      const row = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'report-legend__line';
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.background = color;
      let range = `${percent(from ?? 0)}–${percent(to ?? 0)}`;
      if (from === null) range = `< ${percent(to)}`;
      if (to === null) range = `≥ ${percent(from)}`;
      row.append(swatch, range);
      return row;
    }));
    group.addEventListener('change', (e) => {
      const slope = /** @type {HTMLInputElement} */ (e.target).value === 'slope';
      legend.hidden = !slope;
      this.#log(`Report_ColorBy_${slope ? 'Slope' : 'Score'}`);
      this.#regionMap?.colorBy(slope ? breaks : null);
      this.#colorBreaks = slope ? breaks : null;
      for (const section of this.#sections) section.colorBy(this.#colorBreaks);
    });
  }

  /** @returns {Promise<GeoJSON.FeatureCollection>} The region's faces, down to what the maps read. */
  #fetchSidewalks() {
    this.#sidewalks ??= util.fetchJson(`/v3/api/sidewalkPresence?regionId=${this.#data.regionId}`).then((faces) => ({
      type: 'FeatureCollection',
      features: faces.features.map((f) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          presence: f.properties.presence,
          street_side: f.properties.street_side,
          street_edge_id: f.properties.street_edge_id,
        },
      })),
    }));
    return this.#sidewalks;
  }

  /** The overview's map, linked with the list beside it. */
  #startRegionMap() {
    const host = document.getElementById('report-region-map');
    if (!host) return;
    const rows = new Map([...document.querySelectorAll('.report-rank__row')]
      .map((row) => [Number(/** @type {HTMLElement} */ (row).dataset.street), row]));
    /** @type {?Element} */ let litRow = null;
    const lightRow = (streetId) => {
      litRow?.classList.remove('is-highlighted');
      litRow = streetId === null ? null : rows.get(streetId) ?? null;
      litRow?.classList.add('is-highlighted');
    };
    /** @type {?number} */ let selected = null;
    // The list is the map's other half: a click there shows the segment's row, opening the fold that may hold it,
    // rather than leaving the overview. The row's own link is the way down to its section.
    const selectRow = (row, streetId) => {
      rows.get(selected)?.classList.remove('is-selected');
      selected = streetId;
      row.classList.add('is-selected');
      const fold = row.closest('details');
      if (fold) fold.open = true;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      row.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      row.querySelector('a')?.focus({ preventScroll: true });
      this.#regionMap?.lightStreet(streetId);
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || this.#regionMap) return;
      observer.disconnect();
      this.#regionMap = this.#deps.createMap(host, {
        basemap: this.#data.basemap,
        edges: this.#data.edges,
        places: this.#data.places ?? [],
        onStreetHover: (streetId) => {
          lightRow(streetId);
          this.#regionMap?.lightStreet(streetId ?? selected);
        },
        onStreetClick: (streetId) => {
          const row = rows.get(streetId);
          if (!row) return;
          this.#log('Report_RegionMapClick');
          selectRow(row, streetId);
        },
      });
      this.#regionMap.colorBy(this.#colorBreaks);
      this.#regionMap.setSidewalksVisible(this.#sidewalksVisible);
      const map = this.#regionMap;
      this.#fetchSidewalks().then((faces) => map.setSidewalks(faces))
        .catch(() => { /* The overview still reads without its sidewalks. */ });
    }, { rootMargin: ReportPage.#NEAR_VIEWPORT });
    observer.observe(host);
    for (const [streetId, row] of rows) {
      const on = () => this.#regionMap?.lightStreet(streetId);
      const off = () => this.#regionMap?.lightStreet(selected);
      row.addEventListener('mouseenter', on);
      row.addEventListener('mouseleave', off);
      row.addEventListener('focusin', on);
      row.addEventListener('focusout', off);
    }
  }

  /**
   * The worst-problems map, linked with the type list beside it: a type's row lights its dots, a dot lights its row,
   * and a dot opens its location's Gallery card over the map.
   */
  #startWorstMap() {
    const host = document.getElementById('report-worst-map');
    if (!host) return;
    const rows = new Map([...document.querySelectorAll('.report-worst__type')].map((row) => [
      /** @type {HTMLElement} */ (row).dataset.labelType, row,
    ]));
    // Logged once per type, so a sweep down the list isn't a flood.
    /** @type {Set<string>} */
    const hovered = new Set();
    // A row with keyboard focus stays lit when the pointer moves off, as the region map keeps its selected street.
    const focusedType = () => /** @type {?HTMLElement} */ (document.activeElement?.closest('.report-worst__type'))
      ?.dataset.labelType ?? null;
    const light = (labelType) => {
      const lit = labelType ?? focusedType();
      for (const [type, row] of rows) row.classList.toggle('is-highlighted', type === lit);
      this.#worstMap?.lightType(lit);
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || this.#worstMap) return;
      observer.disconnect();
      this.#worstMap = this.#deps.createMap(host, {
        basemap: this.#data.basemap,
        edges: this.#data.edges,
        problems: this.#data.worst ?? [],
        onProblemHover: light,
        onProblemClick: (problem) => {
          this.#log(`Report_WorstMapClick_LabelType=${problem.labelType}`);
          this.#openProblem(problem);
        },
        onProblemClose: () => this.#log('Report_WorstCardClose'),
      });
    }, { rootMargin: ReportPage.#NEAR_VIEWPORT });
    observer.observe(host);
    for (const [type, row] of rows) {
      const on = () => {
        if (!hovered.has(type)) this.#log(`Report_WorstTypeHover_LabelType=${type}`);
        hovered.add(type);
        light(type);
      };
      row.addEventListener('mouseenter', on);
      row.addEventListener('mouseleave', () => light(null));
      row.addEventListener('focusin', on);
      row.addEventListener('focusout', (e) => {
        if (!row.contains(/** @type {?Node} */ (e.relatedTarget))) light(null);
      });
    }
  }

  /**
   * Opens a location's card over the worst map, built by Gallery's own code so it reads and votes as it does there.
   * @param {{labelId: ?number, labelType: string}} problem
   * @returns {Promise<void>} Resolves once the card is drawn, or has failed to be.
   */
  async #openProblem(problem) {
    const content = document.createElement('div');
    content.className = 'report-problem';
    content.textContent = i18next.t('report:worst.loading');
    const popup = this.#worstMap.openProblem(problem, content);
    const say = (key) => {
      content.textContent = i18next.t(key);
      this.#worstMap.refitProblem();
    };
    if (problem.labelId === null) {
      say('report:worst.rejected');
      return;
    }
    try {
      const entry = (await this.#deps.fetchCards([problem.labelId])).get(problem.labelId) ?? null;
      if (!popup.isOpen()) return;
      if (!entry) {
        say('report:worst.unavailable');
        return;
      }
      content.replaceChildren();
      const card = this.#deps.buildCard(entry, this.#log);
      card.render(content);
      card.refitTags?.();
      this.#worstMap.refitProblem();
      await card.loadImage?.();
      if (popup.isOpen()) this.#worstMap.refitProblem();
    } catch (err) {
      console.error(err);
      if (popup.isOpen()) say('report:worst.unavailable');
    }
  }

  /** Brings sections up as they near the viewport, and gives maps to whichever of those are closest to it. */
  #watchSections() {
    /** @type {Map<Element, ReportStreetSection>} */
    const byElement = new Map(this.#sections.map((s) => [s.element, s]));
    this.#observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const section = byElement.get(entry.target);
        if (entry.isIntersecting) {
          this.#near.add(section);
          section.loadCards();
          section.loadProfile();
        } else {
          this.#near.delete(section);
        }
      }
      this.#assignMaps();
    }, { rootMargin: ReportPage.#NEAR_VIEWPORT });
    for (const section of this.#sections) this.#observer.observe(section.element);

    // Short streets can leave more sections near than there are maps, and then scrolling alone changes who's closest,
    // with no section crossing the observer's line to say so.
    let scheduled = false;
    window.addEventListener('scroll', () => {
      if (scheduled || this.#near.size <= ReportPage.MAX_LIVE_MAPS) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        this.#assignMaps();
      });
    }, { passive: true });
  }

  /**
   * Re-decides who has a map from where things stand now, rather than evicting the oldest as sections arrive. Sections
   * start short and grow as their cards land, so a section can lose its map to one that's soon pushed far away, and
   * nothing would tell it to come back: it never left.
   */
  #assignMaps() {
    const middle = window.innerHeight / 2;
    const distance = (section) => {
      const { top, bottom } = section.element.getBoundingClientRect();
      return Math.max(top - middle, middle - bottom, 0);
    };
    const wanted = [...this.#near].sort((a, b) => distance(a) - distance(b)).slice(0, ReportPage.MAX_LIVE_MAPS);
    for (const section of this.#sections) {
      if (section.hasMap && !wanted.includes(section)) section.unmountMap();
    }
    for (const section of wanted) section.mountMap();
  }

  /** The fixes' cards, drawn once they near the viewport. */
  #watchFixes() {
    const items = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.report-fix')]);
    if (items.length === 0) return;
    this.#slotObserver = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      this.#slotObserver.disconnect();
      this.loadFixes(items);
    }, { rootMargin: ReportPage.#NEAR_VIEWPORT });
    for (const item of items) this.#slotObserver.observe(item);
    this.#fixSlots = items;
  }

  /**
   * Fills each fix's two panes: a sketch of the spot at once, then its photo, then its map as a still picture.
   * @param {HTMLElement[]} [items] - The `.report-fix` cards.
   * @returns {Promise<void>} Resolves once every pane is as finished as it will get.
   */
  async loadFixes(items = this.#fixSlots) {
    if (this.#fixesLoaded) return;
    this.#fixesLoaded = true;
    const fixes = new Map((this.#data.fixes ?? []).map((f) => [f.labelId, f]));
    const pairs = items.map((item) => [item, fixes.get(Number(item.dataset.labelId))]).filter(([, fix]) => fix);
    for (const [item, fix] of pairs) this.#sketchFix(item, fix);

    let answers = new Map();
    try {
      answers = await this.#deps.fetchCards(pairs.map(([, fix]) => fix.labelId));
    } catch (err) {
      console.error(err);
    }
    await Promise.allSettled(pairs.map(([item, fix]) => this.#showFixPhoto(item, fix, answers.get(fix.labelId))));
    // One at a time, so these never add more than one WebGL context to the street maps' budget.
    for (const [item, fix] of pairs) await this.#stillFixMap(item, fix);
  }

  /**
   * Draws the street and the spot with no basemap: what shows until the map is ready, and if it never is.
   * @param {HTMLElement} item
   * @param {Record<string, any>} fix
   */
  #sketchFix(item, fix) {
    const focus = new Set(fix.edgeIds);
    const pane = item.querySelector('[data-fix-map]');
    pane.insertAdjacentHTML('afterbegin', reportSketch(
      this.#data.edges.filter((e) => focus.has(e.id)).map((e) => e.coordinates),
      fix.locations.map((l) => ({
        lng: l.lng, lat: l.lat, iconUrl: util.misc.getIconImagePaths(l.labelType).iconImagePath,
      })),
    ));
  }

  /**
   * Uses the small thumbnail, never the billable Street View still a Gallery card falls back to; with no crop the pane
   * gets Gallery's own placeholder.
   * @param {HTMLElement} item
   * @param {Record<string, any>} fix
   * @param {?Record<string, any>} entry - The Gallery endpoint's answer for the fix's label, if it had one.
   * @returns {Promise<void>} Resolves once the photo has loaded or given up.
   */
  async #showFixPhoto(item, fix, entry) {
    const pane = item.querySelector('[data-fix-photo]');
    const url = entry?.thumbnailUrl ?? entry?.cropUrl;
    const placeholder = () => {
      pane.replaceChildren(LabelMiniCard.placeholder(fix.locations[0].labelType, 'unavailable'));
    };
    if (!url) {
      placeholder();
      return;
    }
    const image = document.createElement('img');
    image.alt = '';
    image.src = url;
    pane.replaceChildren(image, ReportPage.#photoMarker(fix.locations[0].labelType, entry));
    await /** @type {Promise<void>} */ (new Promise((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => {
        placeholder();
        resolve();
      };
    }));
  }

  /**
   * The label's icon where it sits in the photo, as Gallery's card places it: the crop's recorded position, or the
   * label's own on the labeling canvas, re-expressed for the square pane the photo is cover-fitted into.
   * @param {string} labelType
   * @param {Record<string, any>} entry - The Gallery endpoint's answer for the fix's label.
   * @returns {HTMLElement} The marker.
   */
  static #photoMarker(labelType, entry) {
    const label = entry.label ?? {};
    const { x, y } = util.misc.labelMarkerFraction('crop', entry.cropMarker ?? null,
      label.original_canvas_x, label.original_canvas_y, {
        canvasWidth: label.original_canvas_width, canvasHeight: label.original_canvas_height, boxAspect: 1,
      });
    const marker = document.createElement('span');
    marker.className = 'report-fix__marker';
    marker.style.setProperty('--report-marker-x', String(x));
    marker.style.setProperty('--report-marker-y', String(y));
    const icon = document.createElement('img');
    icon.src = util.misc.getIconImagePaths(labelType).iconImagePath;
    icon.alt = '';
    marker.append(icon);
    return marker;
  }

  /**
   * Draws the fix's map once, keeps the picture, and frees the map.
   * @param {HTMLElement} item
   * @param {Record<string, any>} fix
   * @returns {Promise<void>}
   */
  async #stillFixMap(item, fix) {
    const pane = item.querySelector('[data-fix-map]');
    const host = document.createElement('div');
    host.className = 'report-fix__live';
    pane.append(host);
    let map = null;
    try {
      const [first] = fix.locations;
      map = this.#deps.createMap(host, {
        basemap: this.#data.basemap,
        edges: this.#data.edges,
        focusEdgeIds: fix.edgeIds,
        locations: fix.locations,
        center: [first.lng, first.lat],
        places: this.#data.places ?? [],
        still: true,
      });
      map.colorBy(this.#colorBreaks);
      const picture = await map.snapshot();
      if (!picture) return;
      const image = document.createElement('img');
      image.className = 'report-fix__still';
      image.alt = '';
      image.src = picture;
      pane.querySelector('.report-map__sketch')?.remove();
      pane.prepend(image);
      if (this.#data.basemap.tilesUrl) {
        pane.insertAdjacentHTML('beforeend', '<span class="report-fix__credit">© OpenStreetMap</span>');
      }
    } catch (err) {
      // The sketch stays; a card without its map still reads.
      console.warn('Fix map could not be drawn', err);
    } finally {
      map?.destroy();
      host.remove();
    }
  }

  /** The sidebar's sidewalk switch, which also carries the legend. */
  #wireSidewalkToggle() {
    const controls = document.getElementById('report-map-controls');
    if (!controls) return;
    const toggle = /** @type {HTMLInputElement} */ (document.getElementById('report-sidewalks-toggle'));
    const legend = document.getElementById('report-sidewalk-legend');
    controls.hidden = false;
    toggle.addEventListener('change', () => {
      legend.hidden = !toggle.checked;
      this.#log(`Report_SidewalksToggle_Shown=${toggle.checked}`);
      this.#sidewalksVisible = toggle.checked;
      this.#regionMap?.setSidewalksVisible(toggle.checked);
      for (const section of this.#sections) section.setSidewalksVisible(toggle.checked);
    });
  }

  /**
   * Draws what a printout needs that may not have been reached yet. A browser prints what it has.
   * @returns {Promise<void>}
   */
  async prepareForPrint() {
    await Promise.allSettled([this.loadFixes(), ...this.#sections.map((s) => s.loadCards())]);
  }
}
