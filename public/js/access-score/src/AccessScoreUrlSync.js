/**
 * Two-way sync between the AccessScore tool's state and the page URL, so a weighting can be shared as a link
 * (#5217). Reading happens once, before the first render; writing is a debounced `history.replaceState` on every
 * change and on user-initiated map moves, with params at their defaults omitted and params this class doesn't own
 * preserved. The viewport params (`lat`, `lng`, `zoom`) are the LabelMap's, so a link's camera reads the same way
 * on both maps.
 *
 * Params: `unit` (streets|regions), `w` (per-type magnitudes, `CurbRamp:0.75,…`, present only when they differ from the
 * engine's defaults), `unaudited` (0|1), `clusters` (0|1, the evidence layer), `grade` (1 while the streets are colored
 * by slope, #5223; dropped on reading in a city whose streets have not been sampled), `sel` (selected street or region
 * id, read with `unit`), `dark` (1 for the dark basemap); and the insights dock's `dock` (0 when collapsed, 1 to open
 * it on a narrow window, where it otherwise starts collapsed) `b` (the brushed score range as `from-to` in whole
 * percent, on the histogram's 10-point bin edges) and `focus` (the region a rank-list click scoped the band to). The
 * places layer (#5311) adds `pc` (the enabled category ids, or `all`; absent when none are on, the default), and the
 * selected place as `place` (`lat,lng`) with `placeName` — the same pair the searched place will use (#5340), so a link
 * means one thing by "place". The slope settings (#5223) ride in `slope` as `key:value` tokens, each present only
 * where it differs from the engine's default: `w` (weight), `s` (statistic id), `lo` / `hi` (the thresholds, as
 * fractions), `b` (the barrier threshold, whose presence is what turns the barrier on) and `lc` (1 to admit
 * coarse-model slopes).
 */
class AccessScoreUrlSync {
  /** The `pc` value for every place category: the full list spelled out would break the moment one is added. */
  static #ALL_CATEGORIES = 'all';

  static #WRITE_DELAY_MS = 300;

  /** @type {AccessScoreModel} */
  #model;
  /** @type {mapboxgl.Map} */
  #map;
  #writeTimer = null;
  #selection = null;
  #dock = { open: true, brush: null, focus: null };
  #dark = false;
  #place = null;

  /**
   * The state a URL asks for, validated against the engine config. Unknown or malformed tokens are dropped, so a
   * link from an older build degrades to the defaults rather than failing.
   *
   * @param {AccessScoreConfig} config - The `/v3/api/accessScoreConfig` response.
   * @param {string} [search=window.location.search] - The query string to read.
   * @returns {{state: Partial<AccessScoreState>, selection: ?number, dark: boolean,
   *   dock: {open: boolean, brush: ?{from: number, to: number}, focus: ?number},
   *   place: ?{lat: number, lng: number, name: ?string}}} A partial `AccessScoreModel` state, the selected id if
   *   any, whether the dark basemap is asked for, the dock's state in bin indices, and the place the link names.
   */
  static read(config, search = window.location.search) {
    const params = new URLSearchParams(search);
    /** @type {Partial<AccessScoreState>} */
    const state = {};
    const unit = params.get('unit');
    if (unit === 'streets' || unit === 'regions') state.unit = unit;

    const w = params.get('w');
    if (w) {
      const weights = {};
      for (const token of w.split(',')) {
        const colon = token.indexOf(':');
        const type = token.slice(0, colon);
        const value = Number.parseFloat(token.slice(colon + 1));
        if (config.scored_types.includes(type) && Number.isFinite(value) && value >= 0) weights[type] = value;
      }
      if (Object.keys(weights).length > 0) state.weights = { ...config.presets.default, ...weights };
    }

    if (params.get('unaudited') === '0') state.showUnaudited = false;
    if (params.get('clusters') === '0') state.showClusters = false;
    // A partial: the model's constructor merges it over the engine's defaults, as `setState` does.
    const slope = AccessScoreUrlSync.#readSlope(config, params.get('slope'));
    if (slope) state.slope = /** @type {AccessScoreSlopeSettings} */ (slope);
    // A link from a sampled city opened in one that is not: there is no slope to color by, so the score stays.
    if (params.get('grade') === '1' && (config.gradient?.sources ?? []).length > 0) state.showGrade = true;

    // Absent means none, the default. `pc=all` is "Select all"; a list naming every category reads the same. A
    // list naming nothing the catalog knows is dropped whole, since "none" is not what it asked for either.
    const catalog = config.place_categories ?? [];
    if (params.get('pc') === AccessScoreUrlSync.#ALL_CATEGORIES) {
      state.placeCategories = null;
    } else if (params.has('pc')) {
      const asked = new Set(params.get('pc').split(',').map((token) => token.trim()));
      const enabled = catalog.filter((category) => asked.has(category));
      if (enabled.length === catalog.length && catalog.length > 0) state.placeCategories = null;
      else if (enabled.length > 0) state.placeCategories = enabled;
    }

    // A place is a position, never a query: re-running a search would cost a request and could land elsewhere.
    let place = null;
    const placeMatch = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(params.get('place') || '');
    if (placeMatch) {
      const lat = Number(placeMatch[1]);
      const lng = Number(placeMatch[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) place = { lat, lng, name: params.get('placeName') || null };
    }

    const sel = Number.parseInt(params.get('sel'), 10);

    const focus = Number.parseInt(params.get('focus'), 10);
    // Open by default on a wide window; below the drawer's breakpoint the band's four stacked panels would cover
    // the whole map, so it starts collapsed there like the drawer does, unless the link says `dock=1`.
    const narrow = typeof window.matchMedia === 'function' && window.matchMedia(MapSidebarDrawer.NARROW_QUERY).matches;
    const dock = {
      open: params.has('dock') ? params.get('dock') !== '0' : !narrow,
      brush: null,
      focus: Number.isFinite(focus) && focus > 0 ? focus : null,
    };
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
    return {
      state, selection: Number.isFinite(sel) && sel > 0 ? sel : null, dark: params.get('dark') === '1', dock, place,
    };
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
   * Records the insights dock's state for the URL's `dock` and `b` params.
   * @param {{open: boolean, brush: ?{from: number, to: number}, focus: ?number}} dock - The dock's state.
   */
  setDock(dock) {
    this.#dock = dock;
    this.scheduleWrite();
  }

  /**
   * Records whether the dark basemap is on, for the URL's `dark` param.
   * @param {boolean} dark - True for the dark basemap.
   */
  setDark(dark) {
    this.#dark = dark;
    this.scheduleWrite();
  }

  /** @param {?{lat: number, lng: number, name: ?string}} place - The selected place, or null when its card closed. */
  setPlace(place) {
    this.#place = place;
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
    const weights = this.#model.types.map((t) => `${t}:${this.#trim(state.weights[t])}`).join(',');
    set('w', weights, this.#model.weightsAreDefault);
    set('unaudited', state.showUnaudited ? '1' : '0', state.showUnaudited === defaults.showUnaudited);
    set('clusters', state.showClusters ? '1' : '0', state.showClusters === defaults.showClusters);
    set('grade', '1', state.showGrade === defaults.showGrade);
    // Empty for the defaults, and also for a barrier grade edited while the barrier is off, which a link cannot say.
    const slope = this.#slopeParam(state.slope);
    set('slope', slope, slope === '');
    const categories = state.placeCategories;
    set('pc', categories === null ? AccessScoreUrlSync.#ALL_CATEGORIES : (categories ?? []).join(','),
      categories !== null && categories.length === 0);
    set('sel', String(this.#selection), this.#selection === null);
    set('place', this.#place ? `${this.#place.lat.toFixed(5)},${this.#place.lng.toFixed(5)}` : '', !this.#place);
    set('placeName', this.#place?.name ?? '', !this.#place?.name);
    set('dark', '1', !this.#dark);
    set('dock', '0', this.#dock.open);
    const step = 100 / AccessScoreModel.HISTOGRAM_BINS;
    const brush = this.#dock.brush;
    set('b', brush ? `${brush.from * step}-${brush.to * step}` : '', brush === null);
    set('focus', String(this.#dock.focus), !this.#dock.focus);

    const center = this.#map.getCenter();
    url.searchParams.set('lat', center.lat.toFixed(5));
    url.searchParams.set('lng', center.lng.toFixed(5));
    url.searchParams.set('zoom', this.#map.getZoom().toFixed(2));
    util.url.replaceQuery(url);
  }

  /** A number as a short decimal string ("0.75", not "0.7500000000000001"). */
  /**
   * The `slope` param's tokens as a partial of the slope settings, each checked against what the config allows so a
   * stale or hand-edited link degrades to the engine's defaults token by token.
   * @param {AccessScoreConfig} config - The engine config; without its `slope` block there is nothing to set.
   * @param {?string} raw - The param's value.
   * @returns {?Partial<AccessScoreSlopeSettings>} The settings the link names, or null for none.
   */
  static #readSlope(config, raw) {
    if (!raw || !config.slope) return null;
    const { min, max } = config.slope.threshold_range;
    const grade = (text) => {
      const value = Number.parseFloat(text);
      return Number.isFinite(value) && value >= min && value <= max ? value : null;
    };
    /** @type {Partial<AccessScoreSlopeSettings>} */
    const slope = {};
    for (const token of raw.split(',')) {
      const colon = token.indexOf(':');
      const [key, text] = [token.slice(0, colon), token.slice(colon + 1)];
      if (key === 'w') {
        const weight = Number.parseFloat(text);
        if (Number.isFinite(weight) && weight >= 0) slope.weight = weight;
      } else if (key === 's' && config.slope.statistics.includes(text)) {
        slope.statistic = text;
      } else if (key === 'lo' && grade(text) !== null) {
        slope.lowThreshold = grade(text);
      } else if (key === 'hi' && grade(text) !== null) {
        slope.highThreshold = grade(text);
      } else if (key === 'b' && grade(text) !== null) {
        slope.barrierEnabled = true;
        slope.barrierThreshold = grade(text);
      } else if (key === 'lc' && text === '1') {
        slope.includeLowConfidence = true;
      }
    }
    return Object.keys(slope).length > 0 ? slope : null;
  }

  /**
   * The `slope` param for the settings in force: only the tokens that differ from the engine's defaults. A barrier
   * threshold is written only while the barrier is on, since its presence is what a reader of the link takes as "on".
   * @param {AccessScoreSlopeSettings} slope - The model's slope settings.
   * @returns {string}
   */
  #slopeParam(slope) {
    const defaults = AccessScoreModel.slopeDefaults(this.#model.config);
    const differs = (key) => Math.abs(slope[key] - defaults[key]) >= 1e-9;
    const tokens = [];
    if (differs('weight')) tokens.push(`w:${this.#trim(slope.weight)}`);
    if (slope.statistic !== defaults.statistic) tokens.push(`s:${slope.statistic}`);
    if (differs('lowThreshold')) tokens.push(`lo:${this.#trim(slope.lowThreshold)}`);
    if (differs('highThreshold')) tokens.push(`hi:${this.#trim(slope.highThreshold)}`);
    if (slope.barrierEnabled) tokens.push(`b:${this.#trim(slope.barrierThreshold)}`);
    if (slope.includeLowConfidence) tokens.push('lc:1');
    return tokens.join(',');
  }

  #trim(value) {
    return String(Math.round(value * 1000) / 1000);
  }
}
