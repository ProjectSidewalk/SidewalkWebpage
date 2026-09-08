/**
 * Two-way sync between the AccessScore tool's state and the page URL, so a weighting can be shared as a link
 * (#5217). Reading happens once, before the first render; writing is a debounced `history.replaceState` on every
 * change and on user-initiated map moves, with params at their defaults omitted and params this class doesn't own
 * preserved. The viewport params (`lat`, `lng`, `zoom`) are the LabelMap's, so a link's camera reads the same way
 * on both maps.
 *
 * Params: `unit` (streets|regions), `preset`, `w` (per-type magnitudes, `CurbRamp:0.75,…`), `sev` (severity
 * emphasis 0–1), `tags` (0|1), `agg` (length|mean), `minc` (completion floor, percent), `unaudited` (0|1),
 * `clusters` (0|1, the evidence layer), `sel` (selected street or region id, read with `unit`); and the insights
 * dock's `dock` (0 when collapsed), `scope` (viewport|selection), and `b` (the brushed score range as `from-to` in
 * whole percent, on the histogram's 5-point bin edges).
 */
class AccessScoreUrlSync {
  static #WRITE_DELAY_MS = 300;

  #model;
  #map;
  #writeTimer = null;
  #selection = null;
  #dock = { open: true, scope: 'city', brush: null };

  /**
   * The state a URL asks for, validated against the engine config. Unknown or malformed tokens are dropped, so a
   * link from an older build degrades to the defaults rather than failing.
   *
   * @param {object} config - The `/v3/api/accessScoreConfig` response.
   * @param {string} [search=window.location.search] - The query string to read.
   * @returns {{state: object, selection: ?number, dock: {open: boolean, scope: string, brush: ?object}}} A partial
   *   `AccessScoreModel` state, the selected id if any, and the dock's state (`brush` as `{from, to}` bin indices).
   */
  static read(config, search = window.location.search) {
    const params = new URLSearchParams(search);
    const state = {};
    const unit = params.get('unit');
    if (unit === 'streets' || unit === 'regions') state.unit = unit;

    const preset = params.get('preset');
    if (preset && config.presets[preset]) state.preset = preset;

    const w = params.get('w');
    if (w) {
      const weights = {};
      for (const token of w.split(',')) {
        const colon = token.indexOf(':');
        const type = token.slice(0, colon);
        const value = Number.parseFloat(token.slice(colon + 1));
        if (config.scored_types.includes(type) && Number.isFinite(value) && value >= 0) weights[type] = value;
      }
      if (Object.keys(weights).length > 0) {
        state.weights = { ...config.presets.default, ...weights };
        state.preset = 'custom';
      }
    }

    const sev = Number.parseFloat(params.get('sev'));
    if (Number.isFinite(sev) && sev >= 0 && sev <= 1) state.severityEmphasis = sev;
    if (params.get('tags') === '0') state.tagsEnabled = false;
    const agg = params.get('agg');
    if (agg === 'length' || agg === 'mean') state.aggregation = agg;
    const minc = Number.parseFloat(params.get('minc'));
    if (Number.isFinite(minc) && minc >= 0 && minc <= 100) state.minCompletion = minc / 100;
    if (params.get('unaudited') === '0') state.showUnaudited = false;
    if (params.get('clusters') === '0') state.showClusters = false;

    const sel = Number.parseInt(params.get('sel'), 10);

    const dock = { open: params.get('dock') !== '0', scope: 'city', brush: null };
    const scope = params.get('scope');
    if (scope === 'viewport' || scope === 'selection') dock.scope = scope;
    // A brush is only meaningful on the bin edges; anything else is dropped whole rather than rounded to a range
    // the link's author never picked.
    const b = /^(\d{1,3})-(\d{1,3})$/.exec(params.get('b') || '');
    if (b) {
      const step = 100 / AccessScoreModel.HISTOGRAM_BINS;
      const from = Number(b[1]);
      const to = Number(b[2]);
      if (from < to && to <= 100 && from % step === 0 && to % step === 0) {
        dock.brush = { from: from / step, to: to / step };
      }
    }
    return { state, selection: Number.isFinite(sel) && sel > 0 ? sel : null, dock };
  }

  /**
   * @param {AccessScoreModel} model - The model whose state is written.
   * @param {mapboxgl.Map} map - The map, for the viewport params.
   */
  constructor(model, map) {
    this.#model = model;
    this.#map = map;
    // Only user-initiated moves (originalEvent present) write the URL — programmatic moves (the sidebar padding
    // ease, a fly-to from the rankings) would otherwise stamp viewport params on page load.
    this.#map.on('moveend', (event) => {
      if (event.originalEvent) this.scheduleWrite();
    });
  }

  /**
   * Records the selected feature id for the URL's `sel` param.
   * @param {?number} id - The selected street or region id, or null.
   */
  setSelection(id) {
    this.#selection = id;
    this.scheduleWrite();
  }

  /**
   * Records the insights dock's state for the URL's `dock`, `scope`, and `b` params.
   * @param {{open: boolean, scope: string, brush: ?{from: number, to: number}}} dock - The dock's state.
   */
  setDock(dock) {
    this.#dock = dock;
    this.scheduleWrite();
  }

  /** Debounces URL writes so a slider drag or a continuous pan produces one replaceState. */
  scheduleWrite() {
    if (this.#writeTimer) clearTimeout(this.#writeTimer);
    this.#writeTimer = setTimeout(() => this.writeNow(), AccessScoreUrlSync.#WRITE_DELAY_MS);
  }

  /** Rewrites the URL from the current state and viewport, omitting params at their defaults. */
  writeNow() {
    if (this.#writeTimer) {
      clearTimeout(this.#writeTimer);
      this.#writeTimer = null;
    }
    const url = new URL(window.location.href);
    const state = this.#model.state;
    const defaults = AccessScoreModel.DEFAULT_STATE;
    const set = (name, value, isDefault) => {
      if (isDefault) url.searchParams.delete(name);
      else url.searchParams.set(name, value);
    };

    set('unit', state.unit, state.unit === defaults.unit);
    set('preset', state.preset, state.preset === defaults.preset || state.preset === 'custom');
    const weights = this.#model.types.map((t) => `${t}:${this.#trim(state.weights[t])}`).join(',');
    set('w', weights, state.preset !== 'custom');
    set('sev', this.#trim(state.severityEmphasis), state.severityEmphasis === defaults.severityEmphasis);
    set('tags', state.tagsEnabled ? '1' : '0', state.tagsEnabled === defaults.tagsEnabled);
    set('agg', state.aggregation, state.aggregation === defaults.aggregation);
    set('minc', String(Math.round(state.minCompletion * 100)), state.minCompletion === defaults.minCompletion);
    set('unaudited', state.showUnaudited ? '1' : '0', state.showUnaudited === defaults.showUnaudited);
    set('clusters', state.showClusters ? '1' : '0', state.showClusters === defaults.showClusters);
    set('sel', String(this.#selection), this.#selection === null);
    set('dock', '0', this.#dock.open);
    set('scope', this.#dock.scope, this.#dock.scope === 'city');
    const step = 100 / AccessScoreModel.HISTOGRAM_BINS;
    const brush = this.#dock.brush;
    set('b', brush ? `${brush.from * step}-${brush.to * step}` : '', brush === null);

    const center = this.#map.getCenter();
    url.searchParams.set('lat', center.lat.toFixed(5));
    url.searchParams.set('lng', center.lng.toFixed(5));
    url.searchParams.set('zoom', this.#map.getZoom().toFixed(2));
    util.url.replaceQuery(url);
  }

  /** A number as a short decimal string ("0.75", not "0.7500000000000001"). */
  #trim(value) {
    return String(Math.round(value * 1000) / 1000);
  }
}
