/**
 * One street's section: where things are, on a map, beside what they look like, on Gallery cards. Pointing at either
 * lights the other, and a lit card also shows on the map where its photo was taken from, so the map answers "where?"
 * and the picture answers "what?" about the same thing.
 *
 * The cards are only fetched as the section nears the viewport, and the map only lives while it's near: a browser
 * allows about 16 WebGL contexts and a region can have fifty streets. A sketch sits behind the map until then, and for
 * print.
 */

import i18next from 'i18next';
import { util } from '../common/utilities.js';
import '../common/utilitiesSidewalk.js';
import '../common/pano-viewer/panoUtilities.js';
import { reportSketch } from './reportSketch.js';
import { viewpointOf } from './viewWedge.js';

/**
 * @typedef {object} ReportCardData
 * @property {number} clusterId
 * @property {number} labelId
 * @property {string} labelType
 * @property {?number} severity
 * @property {number} lat
 * @property {number} lng
 * @property {number[]} labelIds
 * @property {boolean} atCrossing
 * @property {number} costPoints
 * @property {number} poolSize
 *
 * @typedef {object} ReportStreetData
 * @property {number} wayId
 * @property {number} score
 * @property {number[]} edgeIds
 * @property {ReportCardData[]} cards
 *
 * @typedef {object} ReportSectionDeps
 * @property {import('./ReportMap.js').ReportMapEdge[]} edges - Every street edge in the region.
 * @property {string} cityId
 * @property {(container: HTMLElement, options: Omit<import('./ReportMap.js').ReportMapOptions, 'basemap'>) => any}
 *   createMap
 * @property {(labelIds: number[]) => Promise<Map<number, Record<string, any>>>} fetchCards
 * @property {(entry: Record<string, any>) => any} buildCard
 * @property {() => Promise<GeoJSON.FeatureCollection>} sidewalks - The region's faces, fetched once however many ask.
 * @property {(event: string) => void} log
 */

export class ReportStreetSection {
  /** Enough to fill the view beside the map; the rest are a click away and still on the map. */
  static PAGE_SIZE = 12;
  // Under a point says more about the sigmoid than the street: at the bottom of the scale one problem moves little.
  static #MIN_STATED_COST = 1;

  /** @type {HTMLElement} */ #element;
  /** @type {ReportStreetData} */ #street;
  /** @type {ReportSectionDeps} */ #deps;
  /** @type {HTMLElement} */ #mapHost;
  /** @type {HTMLElement} */ #list;
  /** @type {HTMLButtonElement} */ #more;
  /** @type {any} */ #map = null;
  /** @type {Map<number, {data: ReportCardData, item: ?HTMLElement, label: ?Record<string, any>, card: any}>} */
  #entries = new Map();
  #limit = ReportStreetSection.PAGE_SIZE;
  /** @type {Set<string>} */ #visibleTypes;
  #sidewalksVisible = true;
  /** @type {?number} */ #lit = null;
  #hoverLogged = false;
  /** @type {?ResizeObserver} */ #resize = null;

  /**
   * @param {HTMLElement} element - The section: `[data-street-map]`, `[data-street-cards]`, `[data-street-more]`.
   * @param {ReportStreetData} street
   * @param {ReportSectionDeps} deps
   */
  constructor(element, street, deps) {
    this.#element = element;
    this.#street = street;
    this.#deps = deps;
    this.#mapHost = element.querySelector('[data-street-map]');
    this.#list = element.querySelector('[data-street-cards]');
    this.#more = element.querySelector('[data-street-more]');
    this.#visibleTypes = new Set(street.cards.map((c) => c.labelType));
    for (const data of street.cards) {
      this.#entries.set(data.clusterId, { data, item: null, label: null, card: null });
    }

    const focus = new Set(street.edgeIds);
    this.#mapHost.innerHTML = reportSketch(
      deps.edges.filter((e) => focus.has(e.id)).map((e) => e.coordinates),
      street.cards.map((c) => ({
        lng: c.lng, lat: c.lat, iconUrl: util.misc.getIconImagePaths(c.labelType).iconImagePath,
      })),
    );

    this.#more.addEventListener('click', () => {
      this.#limit += ReportStreetSection.PAGE_SIZE;
      this.#deps.log('Report_ShowMoreCards');
      this.loadCards();
    });
    this.#list.addEventListener('click', (e) => this.#openLabel(e));
    if (typeof ResizeObserver === 'function') {
      this.#resize = new ResizeObserver(() => {
        for (const { card } of this.#entries.values()) card?.refitTags();
      });
      this.#resize.observe(this.#list);
    }
  }

  /** @returns {HTMLElement} The section. */
  get element() {
    return this.#element;
  }

  /** Builds the map, if it isn't up. */
  mountMap() {
    if (this.#map) return;
    this.#map = this.#deps.createMap(this.#mapHost, {
      edges: this.#deps.edges,
      focusEdgeIds: this.#street.edgeIds,
      locations: this.#street.cards,
      onLocationHover: (id) => this.#light(id),
      onLocationClick: (id) => this.#reveal(id),
    });
    this.#map.setVisibleTypes(this.#visibleTypes);
    this.#map.setSidewalksVisible(this.#sidewalksVisible);
    const map = this.#map;
    this.#deps.sidewalks().then((faces) => {
      if (this.#map === map) map.setSidewalks(faces);
    }).catch(() => { /* The street still reads without its sidewalks. */ });
  }

  /** Frees the map's WebGL context; the sketch shows through until the reader comes back. */
  unmountMap() {
    this.#map?.destroy();
    this.#map = null;
  }

  /** @returns {boolean} Whether the map is up. */
  get hasMap() {
    return this.#map !== null;
  }

  /** @returns {ReportCardData[]} The locations the filter allows, in the order they're shown. */
  #visible() {
    return this.#street.cards.filter((c) => this.#visibleTypes.has(c.labelType));
  }

  /**
   * Fetches and draws the cards within the current limit that aren't yet.
   * @returns {Promise<void>} Resolves once they're drawn and their images have settled.
   */
  async loadCards() {
    const shown = this.#visible().slice(0, this.#limit);
    const missing = shown.filter((c) => !this.#entries.get(c.clusterId).item);
    let answers = new Map();
    if (missing.length) {
      try {
        answers = await this.#deps.fetchCards(missing.map((c) => c.labelId));
      } catch (err) {
        console.error(err);
      }
    }
    for (const data of missing) {
      const answer = answers.get(data.labelId);
      // Two callers can be waiting on the same card: the section coming into view and a click on its icon.
      if (answer && !this.#entries.get(data.clusterId).item) this.#buildItem(data, answer);
    }
    this.#arrange();
    await Promise.allSettled(shown.map((c) => this.#entries.get(c.clusterId).card?.loadImage()));
  }

  /**
   * @param {ReportCardData} data
   * @param {Record<string, any>} answer - The endpoint's entry for its label.
   */
  #buildItem(data, answer) {
    const entry = this.#entries.get(data.clusterId);
    const item = document.createElement('li');
    item.className = 'report-card';
    item.dataset.clusterId = String(data.clusterId);
    entry.item = item;
    entry.label = answer.label;
    entry.card = this.#deps.buildCard(answer);
    item.addEventListener('mouseenter', () => this.#light(data.clusterId));
    item.addEventListener('mouseleave', () => this.#light(null));
    item.addEventListener('focusin', () => this.#light(data.clusterId));
    item.addEventListener('focusout', () => this.#light(null));
    entry.card.render(item);
    item.append(this.#hostStrip(data));
    // In the DOM first: the card fits its tags to its measured width.
    this.#list.append(item);
    entry.card.refitTags();
  }

  /**
   * What only the report knows about a card: what it costs the street, how many labels stand behind it, and a way to
   * the label itself that doesn't depend on a pointer.
   * @param {ReportCardData} data
   * @returns {HTMLElement}
   */
  #hostStrip(data) {
    const strip = document.createElement('div');
    strip.className = 'report-card__host';
    if (data.costPoints >= ReportStreetSection.#MIN_STATED_COST) {
      const cost = document.createElement('span');
      cost.className = 'report-card__cost';
      const points = data.costPoints.toLocaleString(i18next.language, {
        minimumFractionDigits: 1, maximumFractionDigits: 1,
      });
      cost.textContent = data.poolSize > 1
        ? i18next.t('report:card.cost-shared', { points, others: data.poolSize - 1 })
        : i18next.t('report:card.cost', { points });
      strip.append(cost);
    }
    if (data.labelIds.length > 1) {
      const all = document.createElement('a');
      all.href = `/gallery?labelIds=${data.labelIds.join(',')}`;
      all.dataset.reportEvent = 'Report_OpenGallery';
      all.textContent = i18next.t('report:card.labels', { count: data.labelIds.length });
      strip.append(all);
    }
    const reference = document.createElement('a');
    reference.href = `/label/${data.labelId}`;
    reference.dataset.reportEvent = 'Report_OpenLabel';
    reference.textContent = `${this.#deps.cityId}:${data.labelId}`;
    strip.append(reference);
    return strip;
  }

  /** Puts the built cards in order, hides what the filter or the limit leaves out, and words the "more" button. */
  #arrange() {
    const visible = this.#visible();
    const shown = new Set(visible.slice(0, this.#limit).map((c) => c.clusterId));
    for (const data of this.#street.cards) {
      const { item } = this.#entries.get(data.clusterId);
      if (!item) continue;
      item.hidden = !shown.has(data.clusterId);
      this.#list.append(item);
    }
    const remaining = visible.length - shown.size;
    this.#more.hidden = remaining <= 0;
    if (remaining > 0) this.#more.textContent = i18next.t('report:card.more', { count: remaining });
  }

  /**
   * The one source of what's lit, whichever side the pointer is on.
   * @param {?number} clusterId
   */
  #light(clusterId) {
    if (clusterId === this.#lit) return;
    if (this.#lit !== null) this.#entries.get(this.#lit)?.item?.classList.remove('is-lit');
    this.#lit = clusterId;
    const entry = clusterId === null ? null : this.#entries.get(clusterId);
    entry?.item?.classList.add('is-lit');
    this.#map?.lightLocation(clusterId);
    if (this.#map) {
      const viewpoint = entry?.label
        ? viewpointOf(entry.label, util.pano.zoomToFov(entry.label.zoom), this.#map.viewpointMinRadiusMeters())
        : null;
      this.#map.showViewpoint(viewpoint);
    }
    if (clusterId !== null && !this.#hoverLogged) {
      // Once per section: how many readers find the link at all, not how far the pointer wandered.
      this.#hoverLogged = true;
      this.#deps.log('Report_LinkedHover');
    }
  }

  /**
   * Answers a click on the map: brings that location's card into view, drawing it first if it's past the limit.
   * @param {number} clusterId
   * @returns {Promise<void>}
   */
  async #reveal(clusterId) {
    this.#deps.log('Report_MapLocationClick');
    const index = this.#visible().findIndex((c) => c.clusterId === clusterId);
    if (index < 0) return;
    if (index >= this.#limit) this.#limit = index + 1;
    await this.loadCards();
    const item = this.#entries.get(clusterId)?.item;
    if (!item) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    item.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    this.#light(clusterId);
  }

  /**
   * A click on a card's picture opens the label, as it opens the expanded view in the Gallery.
   * @param {MouseEvent} e
   */
  #openLabel(e) {
    const picture = /** @type {Element} */ (e.target).closest('.static-gallery-image, .gallery-image-placeholder');
    if (!picture) return;
    const clusterId = Number(/** @type {HTMLElement} */ (picture.closest('.report-card')).dataset.clusterId);
    const labelId = this.#entries.get(clusterId)?.data.labelId;
    if (!labelId) return;
    this.#deps.log('Report_OpenLabel');
    const url = `/label/${labelId}`;
    if (e.ctrlKey || e.metaKey) window.open(url, '_blank', 'noopener');
    else window.location.assign(url);
  }

  /** @param {Set<string>} types - The label types the sidebar allows. */
  setVisibleTypes(types) {
    this.#visibleTypes = types;
    this.#map?.setVisibleTypes(types);
    if (this.#list.childElementCount > 0) this.loadCards();
  }

  /** @param {boolean} visible */
  setSidewalksVisible(visible) {
    this.#sidewalksVisible = visible;
    this.#map?.setSidewalksVisible(visible);
  }
}
