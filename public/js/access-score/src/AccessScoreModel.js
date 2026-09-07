/**
 * The AccessScore tool's scoring model: the engine's math, re-run in the browser (#5217).
 *
 * Holds one city's streets as the count-based inputs `/v3/api/accessScoreStreets` publishes (`severity_counts`,
 * `tag_adjustments`, `audit_count`, `length_meters`, `region_id`) plus the engine constants from
 * `/v3/api/accessScoreConfig`, and rebuilds every street's score under whatever weights the user picks:
 *
 *   term(type)  = weight(type) × units(type) + tagAdjustment(type)
 *   score       = sigmoid(Σ terms)                       (audited streets only; unaudited have no score)
 *
 * where `units` is the rating-weighted cluster count for per-cluster types (`Σ_bucket count × multiplier`), the
 * count itself for presence-only types, and the saturating extent `min(1, n / saturation)` for a street-condition
 * type. With the engine's own weights this reproduces the API's `score` and `sub_scores` exactly — the committed
 * fixture `test/fixtures/accessScoreParity.json` holds both sides to that (test/js/accessScoreModel.test.js and
 * test/service/AccessScoreParitySpec.scala).
 *
 * No DOM, no Mapbox: inputs in, typed arrays out, so a slider move costs one pass over the arrays (~28k streets
 * in Seattle, about a millisecond) and the map/chart adapters read the results.
 */
class AccessScoreModel {
  /** The state a fresh page starts in; `weights` null means the engine's default preset. */
  static DEFAULT_STATE = Object.freeze({
    unit: 'streets',
    preset: 'default',
    weights: null,
    severityEmphasis: 1,
    tagsEnabled: true,
    aggregation: 'length',
    minCompletion: 0.5,
    showUnaudited: true,
    showLabels: true,
  });

  /** Histogram resolution over the 0–1 score range. */
  static HISTOGRAM_BINS = 20;

  #config;
  #types;
  #buckets;
  /** Per type: +1 for a feature type, −1 for a problem type (the engine's base-weight sign). */
  #signs;
  #scoring;
  #saturation;

  // Per-street inputs, laid out type-major so a street's T values sit together: index i * T + t.
  #n = 0;
  #ids;
  #regionIds;
  #lengths;
  #audited;
  /** Cluster counts per (street, type, bucket): index (i * T + t) * B + b. */
  #counts;
  /** Cluster counts per (street, type). */
  #clusterCounts;
  #tagAdjustments;
  #indexById = new Map();

  #regions = [];
  #regionIndexById = new Map();

  #state;
  // Derived per pass.
  #units;
  #terms;
  #scores;
  #regionStats = [];
  #cityContributions = null;

  /**
   * @param {object} config - The `/v3/api/accessScoreConfig` response.
   * @param {object} streets - The `/v3/api/accessScoreStreets` GeoJSON FeatureCollection (properties are read;
   *                           geometry is left to the map).
   * @param {Array<object>} regions - `/neighborhoods/completionRate` rows: `region_id`, `name`, `rate`,
   *                                  `total_distance_m`, `completed_distance_m`.
   * @param {object} [initialState] - Overrides of `DEFAULT_STATE` (e.g. from the URL).
   */
  constructor(config, streets, regions, initialState = {}) {
    this.#config = config;
    this.#types = config.scored_types;
    this.#buckets = config.severity_buckets;
    this.#saturation = config.street_condition_saturation_count;
    this.#signs = this.#types.map((t) => (config.type_weights[t].base_weight < 0 ? -1 : 1));
    this.#scoring = this.#types.map((t) => config.type_weights[t].scoring);

    this.#loadStreets(streets.features || []);
    this.#loadRegions(regions || []);

    this.#state = { ...AccessScoreModel.DEFAULT_STATE, ...initialState };
    if (!this.#state.weights) this.#state.weights = { ...config.presets[this.#state.preset] || config.presets.default };
    this.#units = new Float64Array(this.#n * this.#types.length);
    this.#terms = new Float64Array(this.#n * this.#types.length);
    this.#scores = new Float64Array(this.#n);
    this.#recomputeUnits();
    this.#recompute();
  }

  /** The engine configuration the model was built from. */
  get config() {
    return this.#config;
  }

  /** The scored label types, in the engine's order. */
  get types() {
    return this.#types;
  }

  /** A copy of the current state. */
  get state() {
    return { ...this.#state, weights: { ...this.#state.weights } };
  }

  /** Number of streets loaded. */
  get streetCount() {
    return this.#n;
  }

  /**
   * Street scores by position (see `streetIds`); NaN for an unaudited street.
   * @returns {Float64Array} The scores, in [0, 1].
   */
  get streetScores() {
    return this.#scores;
  }

  /** Street ids by position, parallel to `streetScores`. */
  get streetIds() {
    return this.#ids;
  }

  /** Whether each street (by position) has at least one completed audit. */
  get streetAudited() {
    return this.#audited;
  }

  /**
   * Per-region roll-ups under the current state, in the order the regions were given.
   * @returns {Array<{regionId: number, name: string, completion: number, score: ?number, belowFloor: boolean,
   *   streetCount: number, auditedStreetCount: number, totalLengthM: number, auditedLengthM: number}>}
   */
  get regionStats() {
    return this.#regionStats;
  }

  /**
   * Applies a partial state and recomputes. A preset id sets the weights; a weights change on its own flips the
   * preset to 'custom' unless it matches a preset exactly.
   *
   * @param {object} partial - Any of the `DEFAULT_STATE` keys.
   * @returns {object} The resulting state (a copy).
   */
  setState(partial) {
    const next = { ...this.#state, ...partial };
    if (partial.preset && partial.preset !== 'custom' && this.#config.presets[partial.preset] && !partial.weights) {
      next.weights = { ...this.#config.presets[partial.preset] };
    } else if (partial.weights) {
      next.weights = { ...this.#state.weights, ...partial.weights };
      next.preset = this.#matchingPreset(next.weights) ?? 'custom';
    }
    const unitsChanged = next.severityEmphasis !== this.#state.severityEmphasis;
    this.#state = next;
    if (unitsChanged) this.#recomputeUnits();
    this.#recompute();
    return this.state;
  }

  /**
   * The signed base weight the engine would use for a type under the current state.
   * @param {string} type - A scored label type.
   * @returns {number} Sign from the engine, magnitude from the state.
   */
  signedWeight(type) {
    const t = this.#types.indexOf(type);
    return this.#signs[t] * Math.abs(this.#state.weights[type] ?? 0);
  }

  /**
   * How a street's score comes about under the current state, for the "why this score" panel.
   *
   * @param {number} streetId - The street's `street_edge_id`.
   * @returns {?object} `{streetId, regionId, lengthM, audited, score, preSigmoid, terms}` where `terms` maps each
   *   scored type to `{clusterCount, buckets, units, weight, weighted, tagAdjustment, term}`; null for an unknown id.
   */
  explainStreet(streetId) {
    const i = this.#indexById.get(streetId);
    if (i === undefined) return null;
    const T = this.#types.length;
    const B = this.#buckets.length;
    const terms = {};
    let preSigmoid = 0;
    this.#types.forEach((type, t) => {
      const base = i * T + t;
      const buckets = {};
      this.#buckets.forEach((b, k) => {
        buckets[b] = this.#counts[base * B + k];
      });
      const weight = this.signedWeight(type);
      const weighted = weight * this.#units[base];
      const tagAdjustment = this.#state.tagsEnabled ? this.#tagAdjustments[base] : 0;
      const term = this.#clusterCounts[base] > 0 ? weighted + tagAdjustment : 0;
      preSigmoid += term;
      terms[type] = {
        clusterCount: this.#clusterCounts[base], buckets, units: this.#units[base], weight, weighted, tagAdjustment,
        term,
      };
    });
    return {
      streetId,
      regionId: this.#regionIds[i],
      lengthM: this.#lengths[i],
      audited: this.#audited[i] === 1,
      score: this.#audited[i] === 1 ? this.#scores[i] : null,
      preSigmoid,
      terms,
    };
  }

  /**
   * One region's roll-up under the current state.
   * @param {number} regionId - The region's id.
   * @returns {?object} The entry of `regionStats`, or null for an unknown id.
   */
  explainRegion(regionId) {
    const r = this.#regionIndexById.get(regionId);
    return r === undefined ? null : this.#regionStats[r];
  }

  /**
   * The audited streets of a region with their scores, best first.
   * @param {number} regionId - The region's id.
   * @returns {Array<{streetId: number, score: number, lengthM: number}>} Scored streets, descending by score.
   */
  regionStreets(regionId) {
    const out = [];
    for (let i = 0; i < this.#n; i++) {
      if (this.#regionIds[i] === regionId && this.#audited[i] === 1) {
        out.push({ streetId: this.#ids[i], score: this.#scores[i], lengthM: this.#lengths[i] });
      }
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /**
   * The score distribution in the current unit.
   *
   * Streets are weighted by length (a kilometre of sidewalk at a score counts a kilometre, not a segment count that
   * short blocks would dominate); regions count one each. Regions below the completion floor are left out, as are
   * unaudited streets.
   *
   * @param {object} [options] - Scope.
   * @param {Set<number>} [options.streetIds] - Restrict streets to these ids (e.g. the ones in the viewport).
   * @returns {{bins: Array<{from: number, to: number, value: number}>, total: number, unit: string}} Bin values are
   *   kilometres (streets) or counts (regions); `total` is their sum.
   */
  histogram({ streetIds } = {}) {
    const N = AccessScoreModel.HISTOGRAM_BINS;
    const values = new Float64Array(N);
    if (this.#state.unit === 'regions') {
      for (const r of this.#regionStats) {
        if (r.score === null || r.belowFloor) continue;
        values[AccessScoreModel.#bin(r.score, N)] += 1;
      }
    } else {
      for (let i = 0; i < this.#n; i++) {
        if (this.#audited[i] !== 1) continue;
        if (streetIds && !streetIds.has(this.#ids[i])) continue;
        values[AccessScoreModel.#bin(this.#scores[i], N)] += this.#lengths[i] / 1000;
      }
    }
    const bins = Array.from(values, (value, k) => ({ from: k / N, to: (k + 1) / N, value }));
    return { bins, total: values.reduce((a, b) => a + b, 0), unit: this.#state.unit };
  }

  /**
   * The best and worst scored regions, floor applied.
   * @param {number} [n=5] - How many of each.
   * @returns {{top: Array<object>, bottom: Array<object>}} Entries of `regionStats`; `top` best first, `bottom`
   *   worst first.
   */
  ranked(n = 5) {
    const scored = this.#regionStats.filter((r) => r.score !== null && !r.belowFloor)
      .sort((a, b) => b.score - a.score || b.auditedLengthM - a.auditedLengthM);
    return { top: scored.slice(0, n), bottom: scored.slice(-n).reverse() };
  }

  /**
   * Each type's mean contribution per audited street under the current state — what is driving the scores — and
   * its mean cluster count, for the same streets.
   * @param {object} [options] - Scope.
   * @param {Set<number>} [options.streetIds] - Restrict to these street ids.
   * @returns {{means: Object<string, number>, clusterMeans: Object<string, number>, streets: number}} Mean term and
   *   mean cluster count per type, and the street count behind them.
   */
  contributions({ streetIds } = {}) {
    const T = this.#types.length;
    const sums = new Float64Array(T);
    const counts = new Float64Array(T);
    let streets = 0;
    for (let i = 0; i < this.#n; i++) {
      if (this.#audited[i] !== 1) continue;
      if (streetIds && !streetIds.has(this.#ids[i])) continue;
      streets += 1;
      for (let t = 0; t < T; t++) {
        sums[t] += this.#terms[i * T + t];
        counts[t] += this.#clusterCounts[i * T + t];
      }
    }
    const means = {};
    const clusterMeans = {};
    this.#types.forEach((type, t) => {
      means[type] = streets ? sums[t] / streets : 0;
      clusterMeans[type] = streets ? counts[t] / streets : 0;
    });
    return { means, clusterMeans, streets };
  }

  /**
   * Headline numbers for the KPI strip.
   * @returns {{cityScore: ?number, auditedStreets: number, streets: number, auditedKm: number, totalKm: number,
   *   regionsScored: number, regions: number, problemClusters: number}} The city-wide score is the
   *   length-weighted mean over audited streets (null with none).
   */
  kpis() {
    const T = this.#types.length;
    let weighted = 0;
    let length = 0;
    let auditedStreets = 0;
    let problemClusters = 0;
    for (let i = 0; i < this.#n; i++) {
      for (let t = 0; t < T; t++) if (this.#signs[t] < 0) problemClusters += this.#clusterCounts[i * T + t];
      if (this.#audited[i] !== 1) continue;
      auditedStreets += 1;
      weighted += this.#scores[i] * this.#lengths[i];
      length += this.#lengths[i];
    }
    let totalKm = 0;
    let auditedKm = 0;
    for (const r of this.#regions) {
      totalKm += (r.total_distance_m || 0) / 1000;
      auditedKm += (r.completed_distance_m || 0) / 1000;
    }
    return {
      cityScore: length > 0 ? weighted / length : null,
      auditedStreets,
      streets: this.#n,
      auditedKm,
      totalKm,
      regionsScored: this.#regionStats.filter((r) => r.score !== null && !r.belowFloor).length,
      regions: this.#regions.length,
      problemClusters,
    };
  }

  /**
   * What stands out about a street's or a neighborhood's score, for the hover tooltip: the type pushing it up
   * the most, the type dragging it down the most, and — for a neighborhood — the type on which it differs most
   * from the city-wide average per audited street.
   *
   * @param {string} unit - 'streets' or 'regions'.
   * @param {number} id - The street or region id.
   * @returns {?{helped: ?{type: string, value: number}, hurt: ?{type: string, value: number},
   *   standout: ?{type: string, value: number, cityValue: number, better: boolean}}} Null for an unknown id or
   *   an unscored feature; each part is null when nothing qualifies (e.g. no problems on the street).
   */
  notable(unit, id) {
    let terms;
    let standout = null;
    if (unit === 'streets') {
      const s = this.explainStreet(id);
      if (!s || !s.audited) return null;
      terms = Object.fromEntries(this.#types.map((t) => [t, s.terms[t].term]));
    } else {
      const r = this.explainRegion(id);
      if (!r || r.score === null || r.belowFloor) return null;
      const ids = new Set(this.regionStreets(id).map((st) => st.streetId));
      terms = this.contributions({ streetIds: ids }).means;
      const city = this.#cityContributions.means;
      // The type whose per-street effect here is furthest from the city's, in absolute terms, if it is at all
      // noticeable — a tenth of a logit per street is the floor below which it is noise.
      let best = 0.1;
      for (const t of this.#types) {
        const diff = terms[t] - city[t];
        if (Math.abs(diff) > best) {
          best = Math.abs(diff);
          standout = { type: t, value: terms[t], cityValue: city[t], better: diff > 0 };
        }
      }
    }
    const pick = (sign) => {
      let bestType = null;
      let bestValue = 0;
      for (const t of this.#types) {
        const v = terms[t];
        if (Math.sign(v) === sign && Math.abs(v) > Math.abs(bestValue)) {
          bestType = t;
          bestValue = v;
        }
      }
      return bestType ? { type: bestType, value: bestValue } : null;
    };
    return { helped: pick(1), hurt: pick(-1), standout };
  }

  /**
   * The engine's region roll-up: the street-length-weighted mean of audited streets' scores.
   * @param {Array<[number, number]>} pairs - `[score, lengthMeters]` per audited street.
   * @returns {?number} The mean, or null with no streets / zero total length.
   */
  static lengthWeightedMean(pairs) {
    let total = 0;
    let weighted = 0;
    for (const [score, length] of pairs) {
      total += length;
      weighted += score * length;
    }
    return total > 0 ? weighted / total : null;
  }

  /** Bin index of a score in [0, 1], the top edge folding into the last bin. */
  static #bin(score, n) {
    return Math.min(n - 1, Math.max(0, Math.floor(score * n)));
  }

  /** Unpacks the API features into the typed arrays. */
  #loadStreets(features) {
    const T = this.#types.length;
    const B = this.#buckets.length;
    this.#n = features.length;
    this.#ids = new Int32Array(this.#n);
    this.#regionIds = new Int32Array(this.#n);
    this.#lengths = new Float64Array(this.#n);
    this.#audited = new Uint8Array(this.#n);
    this.#counts = new Int32Array(this.#n * T * B);
    this.#clusterCounts = new Int32Array(this.#n * T);
    this.#tagAdjustments = new Float64Array(this.#n * T);
    features.forEach((f, i) => {
      const p = f.properties;
      this.#ids[i] = p.street_edge_id;
      this.#regionIds[i] = p.region_id;
      this.#lengths[i] = p.length_meters || 0;
      this.#audited[i] = p.audit_count > 0 ? 1 : 0;
      this.#indexById.set(p.street_edge_id, i);
      this.#types.forEach((type, t) => {
        const base = i * T + t;
        const byBucket = (p.severity_counts && p.severity_counts[type]) || {};
        let n = 0;
        this.#buckets.forEach((b, k) => {
          const c = byBucket[b] || 0;
          this.#counts[base * B + k] = c;
          n += c;
        });
        this.#clusterCounts[base] = n;
        this.#tagAdjustments[base] = (p.tag_adjustments && p.tag_adjustments[type]) || 0;
      });
    });
  }

  /** Keeps the region rows and indexes them by id. */
  #loadRegions(rows) {
    this.#regions = rows;
    rows.forEach((r, k) => this.#regionIndexById.set(r.region_id, k));
  }

  /**
   * The multiplier a cluster in `bucket` carries for a scoring mode, with the severity-emphasis slider applied:
   * `1 + e × (m − 1)` pulls every rating multiplier toward 1, so 0 counts clusters and 1 is the engine's curve.
   */
  #multiplier(scoring, bucket) {
    const table = scoring === 'positive_quality'
      ? this.#config.quality_multiplier
      : scoring === 'negative_severity' ? this.#config.severity_multiplier : null;
    if (!table) return 1;
    const m = table[bucket] ?? table[this.#config.severity_buckets[this.#config.severity_buckets.length - 1]];
    return 1 + this.#state.severityEmphasis * (m - 1);
  }

  /** Rebuilds the rating-weighted cluster counts; only the emphasis slider changes them. */
  #recomputeUnits() {
    const T = this.#types.length;
    const B = this.#buckets.length;
    const multipliers = this.#scoring.map((s) => this.#buckets.map((b) => this.#multiplier(s, b)));
    for (let i = 0; i < this.#n; i++) {
      for (let t = 0; t < T; t++) {
        const base = i * T + t;
        if (this.#scoring[t] === 'street_condition') {
          this.#units[base] = Math.min(1, this.#clusterCounts[base] / this.#saturation);
        } else {
          let u = 0;
          for (let k = 0; k < B; k++) u += this.#counts[base * B + k] * multipliers[t][k];
          this.#units[base] = u;
        }
      }
    }
  }

  /** One pass over the streets, then the region roll-up. */
  #recompute() {
    const T = this.#types.length;
    const weights = this.#types.map((type) => this.signedWeight(type));
    const tags = this.#state.tagsEnabled ? 1 : 0;
    for (let i = 0; i < this.#n; i++) {
      let x = 0;
      for (let t = 0; t < T; t++) {
        const base = i * T + t;
        const term = this.#clusterCounts[base] > 0
          ? weights[t] * this.#units[base] + tags * this.#tagAdjustments[base]
          : 0;
        this.#terms[base] = term;
        x += term;
      }
      this.#scores[i] = this.#audited[i] === 1 ? 1 / (1 + Math.exp(-x)) : NaN;
    }
    this.#rollUpRegions();
    this.#cityContributions = this.contributions();
  }

  /** Aggregates audited street scores per region under the current aggregation and completion floor. */
  #rollUpRegions() {
    const byRegion = new Map();
    for (let i = 0; i < this.#n; i++) {
      let acc = byRegion.get(this.#regionIds[i]);
      if (!acc) {
        acc = { streets: 0, audited: 0, length: 0, weighted: 0, sum: 0 };
        byRegion.set(this.#regionIds[i], acc);
      }
      acc.streets += 1;
      if (this.#audited[i] !== 1) continue;
      acc.audited += 1;
      acc.length += this.#lengths[i];
      acc.weighted += this.#scores[i] * this.#lengths[i];
      acc.sum += this.#scores[i];
    }
    this.#regionStats = this.#regions.map((r) => {
      const acc = byRegion.get(r.region_id) || { streets: 0, audited: 0, length: 0, weighted: 0, sum: 0 };
      let score = null;
      if (this.#state.aggregation === 'mean') score = acc.audited > 0 ? acc.sum / acc.audited : null;
      else score = acc.length > 0 ? acc.weighted / acc.length : null;
      const completion = Math.min(1, r.rate || 0);
      return {
        regionId: r.region_id,
        name: r.name,
        completion,
        score,
        belowFloor: completion < this.#state.minCompletion,
        streetCount: acc.streets,
        auditedStreetCount: acc.audited,
        totalLengthM: r.total_distance_m || 0,
        auditedLengthM: r.completed_distance_m || 0,
      };
    });
  }

  /** The preset id whose magnitudes equal `weights`, if any. */
  #matchingPreset(weights) {
    for (const [id, preset] of Object.entries(this.#config.presets)) {
      if (this.#types.every((t) => Math.abs((preset[t] ?? 0) - Math.abs(weights[t] ?? 0)) < 1e-9)) return id;
    }
    return null;
  }
}
