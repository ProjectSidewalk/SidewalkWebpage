/**
 * Runs what a report draws in the browser: the region map beside the street list, one section per street, the fixes'
 * cards, and the sidebar's controls. It decides when each piece exists, since the page may have fifty streets and a
 * browser has room for only a few live maps.
 */

import { AccessScoreGradeRamp } from '../common/AccessScoreGradeRamp.js';
import { util } from '../common/utilities.js';
import { crossingsBbox, ReportRescorer } from './ReportRescorer.js';
import { ReportStreetSection } from './ReportStreetSection.js';
import { ReportWeights } from './ReportWeights.js';

export class ReportPage {
  /** Well under the browser's limit of about 16, and more than fit on a screen. */
  static MAX_LIVE_MAPS = 4;
  // Starts a map and its cards a screen ahead, so that a reader scrolling at a normal pace doesn't see them arrive.
  static #NEAR_VIEWPORT = '100% 0px';

  /** @type {Record<string, any>} */ #data;
  /** @type {any} */ #deps;
  /** @type {ReportStreetSection[]} */ #sections = [];
  /** Sections close enough to be worth a map; #assignMaps picks from these. */
  /** @type {Set<ReportStreetSection>} */ #near = new Set();
  /** @type {?Promise<GeoJSON.FeatureCollection>} */ #sidewalks = null;
  /** @type {?Promise<Record<string, any>>} */ #config = null;
  /** @type {?IntersectionObserver} */ #observer = null;
  /** @type {any} */ #regionMap = null;
  /** @type {?IntersectionObserver} */ #slotObserver = null;
  /** @type {(event: string) => void} */ #log;
  /** @type {HTMLElement[]} */ #fixSlots = [];
  #fixesLoaded = false;
  /** @type {?number[]} */ #colorBreaks = null;

  /**
   * @param {Record<string, any>} data - The page's `report-data` JSON.
   * @param {object} deps
   * @param {(container: HTMLElement, options: any) => any} deps.createMap
   * @param {(labelIds: number[]) => Promise<Map<number, Record<string, any>>>} deps.fetchCards
   * @param {(entry: Record<string, any>, log: (event: string) => void) => any} deps.buildCard
   * @param {(event: string) => void} deps.log
   * @param {(config: any, streets: any, intersections: any, regions: any) => any} deps.createModel
   * @param {(config: any, regionId: number) => Promise<any[]>} deps.loadClusters
   * @param {(config: any) => ?Partial<import('./ReportWeights.js').ReportWeightValues>} deps.linkedWeights - What a
   *   link's address asks for, or null.
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
      createMap: (container, options) => this.#deps.createMap(container, { ...options, basemap: this.#data.basemap }),
      fetchCards: this.#deps.fetchCards,
      buildCard: (entry) => this.#deps.buildCard(entry, this.#log),
      sidewalks: () => this.#fetchSidewalks(),
      fetchGrade: (edgeId) => util.fetchJson(`/v3/api/streetGrade?streetEdgeId=${edgeId}`),
      gradeBreaks: () => this.#fetchGradeBreaks(),
      log: this.#log,
    };
    for (const street of streets) {
      const selector = `.report-street[data-street="${street.wayId}"]`;
      const element = /** @type {?HTMLElement} */ (document.querySelector(selector));
      if (element) this.#sections.push(new ReportStreetSection(element, street, sectionDeps));
    }
    this.#startRegionMap();
    this.#watchSections();
    this.#watchFixes();
    this.#wireFilter();
    this.#wireSidewalkToggle();
    this.#wireColorBy();
    this.#wireWeights();
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

  /** The sidebar's weights, which appear once the config says what there is to weigh. */
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
    const { regionId } = this.#data;
    const rescorer = new ReportRescorer(this.#data, {
      loadModel: async () => {
        const streets = await util.fetchJson(`/v3/api/accessScoreStreets?regionId=${regionId}`);
        const [intersections, completion] = await Promise.all([
          util.fetchJson(`/v3/api/accessScoreIntersections?bbox=${crossingsBbox(streets)}`),
          util.fetchJson('/regions/completionRates'),
        ]);
        return this.#deps.createModel(config, streets, intersections, completion);
      },
      loadClusters: () => this.#deps.loadClusters(config, regionId),
      sections: () => this.#sections,
      regionMap: () => this.#regionMap,
    });
    const weights = new ReportWeights(control, config, (values, { kind, value, final }) => {
      if (final) this.#log(`Report_${kind}${value ? `_${value}` : ''}`);
      rescorer.apply(values, { isDefault: weights.isDefault, final });
    });
    document.getElementById('report-custom-reset')?.addEventListener('click', () => {
      document.getElementById('report-weights-reset').click();
    });
    control.hidden = false;

    const linked = this.#deps.linkedWeights(config);
    if (linked) {
      weights.show(linked);
      rescorer.apply(weights.values, { isDefault: weights.isDefault, final: true });
    }
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
        properties: { presence: f.properties.presence, street_side: f.properties.street_side },
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
    const lightRow = (wayId) => {
      litRow?.classList.remove('is-highlighted');
      litRow = wayId === null ? null : rows.get(wayId) ?? null;
      litRow?.classList.add('is-highlighted');
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || this.#regionMap) return;
      observer.disconnect();
      this.#regionMap = this.#deps.createMap(host, {
        basemap: this.#data.basemap,
        edges: this.#data.edges,
        onStreetHover: lightRow,
        onStreetClick: (wayId) => {
          if (!rows.has(wayId)) return;
          this.#log('Report_RegionMapClick');
          window.location.hash = `street-${wayId}`;
        },
      });
      this.#regionMap.colorBy(this.#colorBreaks);
    }, { rootMargin: ReportPage.#NEAR_VIEWPORT });
    observer.observe(host);
    for (const [wayId, row] of rows) {
      const on = () => this.#regionMap?.lightStreet(wayId);
      const off = () => this.#regionMap?.lightStreet(null);
      row.addEventListener('mouseenter', on);
      row.addEventListener('mouseleave', off);
      row.addEventListener('focusin', on);
      row.addEventListener('focusout', off);
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
    const slots = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.report-card-slot')]);
    if (slots.length === 0) return;
    this.#slotObserver = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      this.#slotObserver.disconnect();
      this.loadFixes(slots);
    }, { rootMargin: ReportPage.#NEAR_VIEWPORT });
    for (const slot of slots) this.#slotObserver.observe(slot);
    this.#fixSlots = slots;
  }

  /**
   * @param {HTMLElement[]} [slots]
   * @returns {Promise<void>} Resolves once the cards are drawn and their images have settled.
   */
  async loadFixes(slots = this.#fixSlots) {
    if (this.#fixesLoaded) return;
    this.#fixesLoaded = true;
    let answers;
    try {
      answers = await this.#deps.fetchCards(slots.map((s) => Number(s.dataset.labelId)));
    } catch (err) {
      console.error(err);
      return;
    }
    const cards = [];
    for (const slot of slots) {
      const answer = answers.get(Number(slot.dataset.labelId));
      if (!answer) continue;
      const card = this.#deps.buildCard(answer, this.#log);
      card.render(slot);
      card.refitTags();
      cards.push(card);
    }
    await Promise.allSettled(cards.map((c) => c.loadImage()));
  }

  /** The sidebar's type chips: one filter over every map and every card at once. */
  #wireFilter() {
    const group = document.getElementById('report-type-filter');
    if (!group) return;
    const chips = /** @type {HTMLButtonElement[]} */ ([...group.querySelectorAll('.report-chip')]);
    group.hidden = false;
    group.addEventListener('click', (e) => {
      const chip = /** @type {Element} */ (e.target).closest('.report-chip');
      if (!chip) return;
      const pressed = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(pressed));
      this.#log(`Report_FilterType_Type=${/** @type {HTMLElement} */ (chip).dataset.labelType}_Shown=${pressed}`);
      const types = new Set(chips.filter((c) => c.getAttribute('aria-pressed') === 'true')
        .map((c) => c.dataset.labelType));
      for (const section of this.#sections) section.setVisibleTypes(types);
    });
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
