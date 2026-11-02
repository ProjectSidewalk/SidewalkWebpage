/**
 * Re-scores a report under a reader's own weights, through the same model the AccessScore tool runs, and keeps the page
 * honest about it: while the weights aren't the engine's, a stamp says so, on paper too, the link carries them, and the
 * numbers that only the server can compute step aside rather than sit beside ones they no longer match.
 *
 * Nothing is fetched until a slider moves or a link asks, since most readers never touch them.
 */

import i18next from 'i18next';
import { ScoreRamp } from '../common/scoreRamp.js';
import { regionScore, rankWays, stretchScore } from './stretchRollup.js';

/**
 * Where to ask for a region's crossings. Not `regionId`: a street on the region's edge counts the crossing at its far
 * end, which belongs to the neighbor, so filtering by region would quietly change that street's score from the
 * server's.
 * @param {GeoJSON.FeatureCollection} streets - The region's streets.
 * @returns {string} The bbox to ask for, about 50 m wider than the lines: a crossing's point needn't be a street's end.
 */
export function crossingsBbox(streets) {
  const PAD_DEGREES = 0.0005;
  const points = streets.features.flatMap((f) => /** @type {GeoJSON.LineString} */ (f.geometry).coordinates);
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [
    Math.min(...lngs) - PAD_DEGREES, Math.min(...lats) - PAD_DEGREES,
    Math.max(...lngs) + PAD_DEGREES, Math.max(...lats) + PAD_DEGREES,
  ].join(',');
}

export class ReportRescorer {
  /** @type {Record<string, any>} */ #data;
  /** @type {any} */ #deps;
  /** @type {?Promise<any>} */ #modelPromise = null;
  /** @type {?Promise<Map<number, Record<string, any>>>} */ #clusters = null;
  /** What the server said, to go back to exactly rather than to our recomputation of it. */
  /** @type {Map<Element, string>} */ #originalText = new Map();
  /** @type {Map<number, ?number>} */ #originalEdgeScores;
  /** @type {?number[]} */ #currentOrder = null;
  #custom = false;
  // Only the newest slider position may land, so a Reset can't be overtaken by a move still waiting on the model.
  #latest = 0;

  /**
   * @param {Record<string, any>} data - The page's `report-data` JSON; its edges' scores are updated in place, so a map
   *   built later draws the numbers now in force.
   * @param {object} deps
   * @param {() => Promise<any>} deps.loadModel - Builds an `AccessScoreModel` over this region.
   * @param {() => Promise<any[]>} deps.loadClusters - `AccessScoreClusterFeed.regionClusters` for this region.
   * @param {() => import('./ReportStreetSection.js').ReportStreetSection[]} deps.sections
   * @param {() => any} deps.regionMap - The overview's map, if it's up.
   */
  constructor(data, deps) {
    this.#data = data;
    this.#deps = deps;
    this.#originalEdgeScores = new Map(data.edges.map((e) => [e.id, e.score]));
  }

  /** @returns {boolean} Whether the page is showing a reader's weights rather than the engine's. */
  get isCustom() {
    return this.#custom;
  }

  /** @returns {Promise<any>} The model, built once. A failure isn't kept, so the next slider retries. */
  #loadModel() {
    this.#modelPromise ??= this.#deps.loadModel().catch((err) => {
      this.#modelPromise = null;
      throw err;
    });
    return this.#modelPromise;
  }

  /**
   * Applies the sliders.
   * @param {import('./ReportWeights.js').ReportWeightValues} values - What they say.
   * @param {{isDefault: boolean, final: boolean}} state - Whether they're on the engine's defaults, and whether the
   *   gesture is over. Reordering waits for that: a list that rearranges under a dragging hand can't be read.
   * @returns {Promise<void>}
   */
  async apply(values, { isDefault, final }) {
    this.#latest += 1;
    const turn = this.#latest;
    if (isDefault) {
      this.#restore();
      this.#writeUrl(null);
      return;
    }
    let model;
    try {
      model = await this.#loadModel();
    } catch (err) {
      console.error('Report weights could not load', err);
      return;
    }
    if (turn !== this.#latest) return;
    model.setState({ weights: values.weights, slope: { weight: values.slopeWeight } });
    this.#setCustom(true);
    const scores = this.#scoresFrom(model);
    this.#paintNumbers(scores);
    this.#deps.regionMap()?.refreshStreets();
    for (const section of this.#deps.sections()) section.refreshStreets();
    if (final) {
      this.#reorder(rankWays(this.#data.streets.map(({ wayId }) => ({ wayId, score: scores.get(wayId) ?? null }))));
      this.#writeUrl(values);
      this.#sortCards(model);
    }
  }

  /**
   * Updates each edge's score in place, and rolls them up per street as the server did.
   * @param {any} model
   * @returns {Map<number, ?number>} Each street's score, by way.
   */
  #scoresFrom(model) {
    const explained = new Map(this.#data.edges.map((e) => [e.id, model.explainStreet(e.id)]));
    for (const edge of this.#data.edges) edge.score = explained.get(edge.id)?.score ?? null;
    const scored = (ids) => ids.flatMap((id) => {
      const street = explained.get(id);
      return street?.audited && Number.isFinite(street.score) ? [{ score: street.score, length: street.lengthM }] : [];
    });
    const hero = regionScore(scored(this.#data.edges.map((e) => e.id)));
    this.#writeNumber(document.querySelector('.report-score__value'), hero);
    return new Map(this.#data.streets.map(({ wayId, edgeIds }) => [wayId, stretchScore(scored(edgeIds))]));
  }

  /** @param {Map<number, ?number>} scores - Each street's score, by way. */
  #paintNumbers(scores) {
    for (const [wayId, score] of scores) {
      this.#paintColors(wayId, score);
      this.#writeNumber(document.querySelector(`.report-rank__row[data-street="${wayId}"] .report-rank__score`), score);
      this.#writeNumber(document.querySelector(`.report-street[data-street="${wayId}"] .report-street__score`), score);
    }
  }

  /**
   * @param {number} wayId
   * @param {?number} score
   */
  #paintColors(wayId, score) {
    if (score === null) return;
    const color = ScoreRamp.at(score);
    const bar = /** @type {?HTMLElement} */ (
      document.querySelector(`.report-rank__row[data-street="${wayId}"] .report-rank__bar`));
    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(1, score)) * 100}%`;
      bar.style.background = color;
    }
    const dot = /** @type {?HTMLElement} */ (document.querySelector(`a[data-street="${wayId}"] .report-toc__dot`));
    if (dot) dot.style.background = color;
  }

  /**
   * Swaps the number inside a sentence the server translated, keeping the sentence.
   * @param {?Element} [element]
   * @param {?number} [score] - On the 0 to 1 scale.
   */
  #writeNumber(element, score) {
    if (!element || score === null || score === undefined) return;
    if (!this.#originalText.has(element)) this.#originalText.set(element, element.textContent);
    const text = (score * 100).toLocaleString(i18next.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    element.textContent = this.#originalText.get(element).replace(/\d[\d.,]*/, text);
  }

  /**
   * Puts the list, the sections and the contents into a new order, and renumbers them.
   * @param {number[]} ways - Lowest score first.
   */
  #reorder(ways) {
    if (this.#currentOrder && ways.every((way, i) => way === this.#currentOrder[i])) return;
    this.#currentOrder = ways;
    const lists = [
      ['.report-rank__row', '.report-rank__position'],
      ['.report-street', '.report-street__rank'],
      ['.report-toc a', null],
    ];
    for (const [selector, numberSelector] of lists) {
      const items = ways
        .map((way) => document.querySelector(`${selector}[data-street="${way}"]`)?.closest('li'))
        .filter(Boolean);
      if (items.length === 0) continue;
      // A marker holds the streets' place, since the contents list carries other entries after them.
      const marker = document.createComment('');
      items[0].before(marker);
      items.forEach((item, index) => {
        marker.before(item);
        const number = numberSelector ? item.querySelector(numberSelector) : null;
        if (number) number.textContent = String(index + 1);
      });
      marker.remove();
    }
  }

  /** @param {any} model - Orders each street's cards by what they now cost it. */
  async #sortCards(model) {
    let clusters;
    try {
      this.#clusters ??= this.#deps.loadClusters()
        .then((rows) => new Map(rows.map((row) => [row.label_cluster_id, row])));
      clusters = await this.#clusters;
    } catch (err) {
      // The cards stay in the order they were; a number that couldn't be computed isn't guessed at.
      console.warn('Report clusters could not load', err);
      this.#clusters = null;
      return;
    }
    if (!this.#custom) return;
    for (const section of this.#deps.sections()) {
      section.setCardWeigher((card) => {
        const cluster = clusters.get(card.clusterId);
        const street = cluster ? model.explainStreet(cluster.street_edge_id) : null;
        const term = street ? model.clusterTerm(cluster, street)?.term : null;
        return Math.abs(term ?? 0);
      });
    }
  }

  /** Goes back to exactly what the server said. */
  #restore() {
    this.#setCustom(false);
    for (const edge of this.#data.edges) edge.score = this.#originalEdgeScores.get(edge.id);
    for (const [element, text] of this.#originalText) element.textContent = text;
    for (const { wayId, score } of this.#data.streets) this.#paintColors(wayId, score);
    this.#deps.regionMap()?.refreshStreets();
    for (const section of this.#deps.sections()) {
      section.refreshStreets();
      section.setCardWeigher(null);
    }
    this.#reorder(this.#data.streets.map((s) => s.wayId));
  }

  /** @param {boolean} custom */
  #setCustom(custom) {
    if (custom === this.#custom) return;
    this.#custom = custom;
    document.getElementById('report-shell')?.classList.toggle('is-custom-weights', custom);
    const stamp = document.getElementById('report-custom-stamp');
    if (stamp) stamp.hidden = !custom;
  }

  /**
   * Keeps the weights in the address, in the tool's own format, so a copied link reopens the same numbers and says so.
   * @param {?import('./ReportWeights.js').ReportWeightValues} values - Null for the engine's own.
   */
  #writeUrl(values) {
    const url = new URL(window.location.href);
    url.searchParams.delete('w');
    url.searchParams.delete('gs');
    if (values) {
      url.searchParams.set('w', Object.entries(values.weights).map(([type, w]) => `${type}:${w}`).join(','));
      url.searchParams.set('gs', `w:${values.slopeWeight}`);
    }
    window.history.replaceState(window.history.state, '', url);
  }
}
