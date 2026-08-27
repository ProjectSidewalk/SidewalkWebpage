/**
 * Renders the admin "Across Cities" page (#4329): a cross-deployment overview of every Project Sidewalk city across
 * four lenses — coverage (how much is left), activity (what's happening and when), data patterns (the label-type mix,
 * city vs city), and data quality (how trustworthy the data is). Adds a "Today & this week" band (#4758) of
 * current-activity tiles (with week-over-week deltas) and rolling-7-day bar charts, a "needs attention" panel from
 * server-computed anomaly flags, and an over-time section (#4686): weekly line charts (labels / validations / active
 * users, summed across cities) and cumulative all-time totals.
 *
 * Plain HTML/CSS plus the shared MiniLineChart for the over-time charts and small inline-SVG sparklines for the
 * per-city activity trend. Owner-only; driven entirely from /adminapi/cityScorecards.
 */
class AcrossCitiesPage {
  /** Human-friendly label + severity for each data-quality anomaly flag key the endpoint can emit. */
  static #ANOMALY = {
    high_disagreement: { label: 'High disagreement', sev: 'warn' },
  };

  /**
   * Lifecycle/health states (#4329): label, badge tone, and whether the state warrants attention. `tone` maps to a
   * `.ac-badge--<tone>` CSS class. Ordered active → wrapped_up → stalled → low_traction for the Status sort.
   */
  static #LIFECYCLE = {
    active:       { label: 'Active',       tone: 'ok',    rank: 0, attention: false },
    wrapped_up:   { label: 'Wrapped up',   tone: 'good',  rank: 1, attention: false },
    stalled:      { label: 'Stalled',      tone: 'warn',  rank: 2, attention: true },
    low_traction: { label: 'Low traction', tone: 'bad',   rank: 3, attention: true },
  };

  /** How many cities the "Most active cities" table shows; the full list lives in the Activity section below it. */
  static #TOP_CITIES_LIMIT = 5;

  /** Canonical label-type order + short display names for the data-patterns bars. */
  static #LABEL_TYPES = [
    ['CurbRamp', 'Curb ramp'], ['NoCurbRamp', 'Missing curb ramp'], ['Obstacle', 'Obstacle'],
    ['SurfaceProblem', 'Surface problem'], ['NoSidewalk', 'No sidewalk'], ['Crosswalk', 'Crosswalk'],
    ['Signal', 'Signal'], ['Occlusion', 'Occlusion'], ['Other', 'Other'],
  ];

  /** Lifecycle → map circle color (matches the badge tones). */
  static #LIFECYCLE_COLOR = {
    active: '#4a90d9', wrapped_up: '#1f7a4d', stalled: '#e0a800', low_traction: '#c0392b',
  };

  /**
   * Display names for the funnel steps, keyed by the backend step keys (each funnel's `steps` array is the source of
   * truth for the set and order; this map only supplies presentational labels). `full` is for the bar rows; `short`
   * for the comparison-table column headers. Covers both the mapping and contribution funnels.
   */
  static #FUNNEL_STEP_LABELS = {
    visited:                { full: 'Visited site',                     short: 'Visited' },
    tutorial_started:       { full: 'Started tutorial',                short: 'Tutorial start' },
    tutorial_finished:      { full: 'Finished or skipped tutorial',    short: 'Tutorial done' },
    took_step:              { full: 'Took a step',                     short: 'Took a step' },
    labeled:                { full: 'Placed a label',                  short: 'Labeled' },
    mission_completed:      { full: 'Completed a mapping mission',     short: 'Mission done' },
    contributed:            { full: 'Labeled or validated',           short: 'Contributed' },
    contribution_completed: { full: 'Completed a labeling/validation mission', short: 'Mission done' },
  };

  /** Title + one-line description for each funnel, shown above its table/bars. Keyed by funnel type. */
  static #FUNNEL_META = {
    mapping:      { title: 'Mapping funnel',
      desc: 'The Explore onboarding flow: tutorial, then walking, labeling, and completing an audit mission.' },
    contribution: { title: 'Contribution funnel',
      desc: 'The broad view: any contribution (labeling or validation) and finishing a mission.' },
  };

  /** Funnel display order on the page. The endpoint may include any subset of these. */
  static #FUNNEL_ORDER = ['mapping', 'contribution'];

  /** Which segment keys (matching the endpoint's per-city objects) each breakdown dimension shows, with labels. */
  static #FUNNEL_DIMS = {
    all:    [{ key: 'all',        label: 'All users' }],
    role:   [{ key: 'registered', label: 'Registered' }, { key: 'anonymous', label: 'Anonymous' }],
    device: [{ key: 'desktop',    label: 'Desktop' }, { key: 'mobile', label: 'Mobile' },
      { key: 'device_unknown', label: 'Unknown' }],
  };

  /** Bar colors per segment, by position within the active dimension. */
  static #FUNNEL_SEG_COLORS = ['#4a90d9', '#e0a800', '#b3b3b3'];

  #scorecardsUrl;
  #citiesUrl;
  #mapboxToken;
  #map = null;           // Mapbox map instance for the deployment-cities map.
  #cities = [];          // The latest scorecard rows, as returned by the endpoint.
  #summary = {};         // The summary block (thresholds + cross-city median + hero totals).
  #allTimeTrend = [];    // Cross-city weekly series for the full project history (the "All time" toggle).
  #dailyTrend = [];      // Cross-city daily series for the trailing 7 days (the "this week" bar charts, #4686).
  #dayTipCards = new Map(); // day → its built hover card, shared by all three per-day charts (#4931).
  #windowSummary = null; // Rolling 7d-vs-prior-7d totals for the "Today & this week" tiles (#4758).
  #windowByCity = {};    // The same rolling windows per city id, for the "Most active cities" table (#4758).
  #trendSeries = {};     // { recent: [...], all: [...] } weekly aggregates for the over-time charts.
  #trendRange = 'recent';// Which over-time range is shown: 'recent' (12 wks) | 'all'.

  /** Sort state per sortable table, keyed by table element id; each entry is `{ key, dir }` with dir 'asc' | 'desc'. */
  #sortState = {
    'ac-table': { key: 'coverage', dir: 'desc' },
    'ac-top-table': { key: 'activity_7d', dir: 'desc' },
    'ac-activity-table': { key: 'days_since_activity', dir: 'asc' },
  };

  #funnelsUrl;
  #funnels = {};         // { mapping: {steps, cities}, contribution: {steps, cities} } for the current window.
  #funnelWindow = '30d'; // '30d' | '90d' | 'all'.
  #funnelDim = 'all';    // 'all' | 'role' | 'device'.

  /** @param {{scorecardsUrl: string, citiesUrl?: string, mapboxToken?: string, funnelsUrl?: string}} opts */
  constructor(opts = {}) {
    this.#scorecardsUrl = opts.scorecardsUrl;
    this.#citiesUrl = opts.citiesUrl;
    this.#mapboxToken = opts.mapboxToken;
    this.#funnelsUrl = opts.funnelsUrl;
  }

  async init() {
    try {
      // Scorecards are required; the cities geo (for the map) is an enhancement, so it degrades gracefully.
      const [data, citiesGeo] = await Promise.all([
        this.#fetchJson(this.#scorecardsUrl),
        this.#citiesUrl ? this.#fetchJson(this.#citiesUrl).catch(() => null) : Promise.resolve(null),
      ]);
      this.#cities = (data && data.cities) || [];
      this.#summary = (data && data.summary) || {};
      this.#allTimeTrend = (data && data.over_time_all_time) || [];
      this.#dailyTrend = (data && data.over_time_daily) || [];
      this.#dayTipCards.clear(); // Cards are keyed by day, and a reload can bring new numbers for the same day.
      this.#windowSummary = (data && data.window_summary) || null;
      this.#windowByCity = (data && data.window_by_city) || {};
      this.#joinActivityWindows();
      this.#renderHero();
      this.#renderNow();
      this.#renderMap(citiesGeo);
      this.#renderPulse();
      this.#renderAttention();
      this.#renderTrends();
      this.#wireSorting('ac-table', () => this.#renderTable());
      this.#wireSorting('ac-top-table', () => this.#renderTopCities());
      this.#wireSorting('ac-activity-table', () => this.#renderActivity());
      this.#renderTable();
      this.#renderCoverage();
      this.#renderTopCities();
      this.#renderActivity();
      this.#renderEffort();
      this.#renderPatterns();
      this.#renderQuality();
      // Funnel data comes from its own endpoint and is refetched on window change, so load it separately; its
      // internal error handling keeps a funnel failure from blanking the rest of the page.
      if (this.#funnelsUrl) {
        this.#wireFunnelControls();
        await this.#loadFunnels();
      }
    } catch (err) {
      console.error('Across Cities page failed to load:', err);
      this.#setText('ac-pulse', 'Could not load city data. Please try again.');
      this.#setText('ac-status', 'Could not load city data. Please try again.');
    }
  }

  async #fetchJson(url) {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`Request failed (${resp.status}): ${url}`);
    return resp.json();
  }

  // --- Pulse ------------------------------------------------------------------------------------------------------

  /** One-line summary: how many cities, broken down by lifecycle state. */
  #renderPulse() {
    const n = this.#cities.length;
    const counts = {};
    for (const c of this.#cities) counts[c.lifecycle] = (counts[c.lifecycle] || 0) + 1;
    const order = ['active', 'wrapped_up', 'stalled', 'low_traction'];
    const parts = order.filter((k) => counts[k]).map((k) =>
      `<strong>${counts[k]}</strong> ${AcrossCitiesPage.#LIFECYCLE[k].label.toLowerCase()}`);
    const breakdown = parts.length ? ` · ${parts.join(' · ')}` : '';
    this.#setHtml('ac-pulse', `Comparing <strong>${n}</strong> ${n === 1 ? 'city' : 'cities'}${breakdown}.`);
  }

  // --- Hero stats -------------------------------------------------------------------------------------------------

  /** Fills the project-wide "hero" stat band from the summary block. */
  #renderHero() {
    const s = this.#summary;
    this.#setText('hero-cities', this.#num(s.num_cities));
    this.#setText('hero-countries', this.#num(s.num_countries));
    this.#setText('hero-languages', this.#num(s.num_languages));
    this.#setText('hero-users', this.#compact(s.total_users));
    this.#setText('hero-distance', `${this.#num(Math.round(s.total_km || 0))} km`);
    this.#setText('hero-labels', this.#compact(s.total_labels));
    this.#setText('hero-validations', this.#compact(s.total_validations));
    this.#setText('hero-datapoints', this.#compact(s.total_datapoints));
    this.#setText('hero-agreement', s.global_agreement ? this.#pct(s.global_agreement) : '—');
  }

  /**
   * Attaches each city's rolling 7d-vs-prior-7d window to its scorecard row, plus the `activity_7d` total that ranks
   * the "Most active cities" table.
   *
   * The window is nested under `activity_window` rather than merged flat because the scorecard row already carries
   * labels_7d / validations_7d counted on a slightly different basis (the scorecard joins through audit_task and drops
   * the tutorial street). Keeping them apart is what stops a table from pairing one basis's level with the other's
   * delta. Cities the endpoint has no window for (a failed schema read) get zeros, so they simply rank last.
   *
   * `activity_7d` counts what people did, since it decides which cities the table calls the busiest — ranking by a
   * total that included AI output would put the pipeline's target city on top of a list about communities (#4931).
   */
  #joinActivityWindows() {
    for (const c of this.#cities) {
      const w = this.#windowByCity[c.city_id] || null;
      c.activity_window = w;
      c.activity_7d = w ? (w.labels_7d || 0) + (w.validations_7d || 0) : 0;
    }
  }

  // --- Today & this week ------------------------------------------------------------------------------------------

  /**
   * Fills the "Today & this week" tiles (#4758): today from the daily series' last (partial) point, the 7-day window
   * values and week-over-week deltas from the endpoint's window_summary, the cities-active / top-city tiles from the
   * per-city rolling windows, and the new-contributor tile from the all-time weekly series.
   *
   * Every count here is what people did. AI-role output is real work the project depends on, but pooling it with the
   * community's would let one pipeline account decide what the whole band says, so it is reported on its own line
   * under the count it accompanies (#4931).
   */
  #renderNow() {
    // Today (so far): the last point of the zero-filled daily series is today, partial. No delta on these tiles —
    // comparing a partial today against a full yesterday would nearly always read as a drop.
    const today = this.#dailyTrend.length ? this.#dailyTrend[this.#dailyTrend.length - 1] : null;
    if (today) {
      this.#setText('now-labels-today', this.#num(today.labels));
      this.#setText('now-validations-today', this.#num(today.validations));
      this.#setText('now-contributors-today', this.#num(today.contributors));
      this.#renderAiNote('now-labels-today-ai', today.ai_labels, today.labels, 'labels', 'today');
      this.#renderAiNote('now-validations-today-ai', today.ai_validations, today.validations, 'validations', 'today');
      this.#renderAnonNote('now-contributors-today-anon', today.anon_sessions, 'today');
      this.#renderAgentNote('now-contributors-today-ai', today.ai_agents, 'today');
    }

    // Past 7 days: values AND deltas from window_summary so both share the same exact rolling-window basis (summing
    // the calendar-day series would disagree with the delta, and per-day distinct users can't be summed).
    const ws = this.#windowSummary;
    if (ws) {
      this.#setText('now-labels-7d', this.#num(ws.labels_7d));
      this.#setText('now-validations-7d', this.#num(ws.validations_7d));
      this.#setText('now-contributors-7d', this.#num(ws.contributors_7d));
      this.#renderDelta('now-labels-7d-delta', ws.labels_7d, ws.labels_prior_7d);
      this.#renderDelta('now-validations-7d-delta', ws.validations_7d, ws.validations_prior_7d);
      this.#renderDelta('now-contributors-7d-delta', ws.contributors_7d, ws.contributors_prior_7d);
      const period = 'in the last 7 days';
      this.#renderAiNote('now-labels-7d-ai', ws.ai_labels_7d, ws.labels_7d, 'labels', period);
      this.#renderAiNote('now-validations-7d-ai', ws.ai_validations_7d, ws.validations_7d, 'validations', period);
      this.#renderAnonNote('now-contributors-7d-anon', ws.anon_sessions_7d, period);
      this.#renderAgentNote('now-contributors-7d-ai', ws.ai_agents_7d, period);
    }

    // Cities active / top city, from the same per-city rolling windows as the "Most active cities" table below, so
    // these tiles can never disagree with the table's rows or its row-count status line (the scorecard's own 7d
    // fields sit on a slightly different basis — see #joinActivityWindows).
    const activeCount = this.#cities.filter((c) => c.activity_7d > 0).length;
    this.#setText('now-cities-active', `${this.#num(activeCount)} of ${this.#num(this.#cities.length)}`);
    const top = this.#cities.reduce((best, c) =>
      ((c.activity_window?.labels_7d ?? 0) > (best?.activity_window?.labels_7d ?? 0) ? c : best), null);
    if ((top?.activity_window?.labels_7d ?? 0) > 0) {
      this.#setText('now-top-city', top.city_name || top.city_id);
      this.#setText('now-top-city-count', `${this.#num(top.activity_window.labels_7d)} labels`);
    }

    // New contributors: the all-time weekly series' last point is the current (partial) Pacific calendar week — the
    // only series that knows each person's true first-activity week, hence the calendar-week (not rolling) basis.
    const week = this.#allTimeTrend.length ? this.#allTimeTrend[this.#allTimeTrend.length - 1] : null;
    if (week) this.#setText('now-new-contributors', this.#num(week.new_users));
  }

  /**
   * Reports the AI output beside a tile's human count, or clears the line when no AI account contributed.
   *
   * @param {string} id - Element id of the tile's AI line.
   * @param {number} aiCount - What AI-role accounts produced in the period.
   * @param {number} humanCount - What people produced in the same period, for the tooltip's share.
   * @param {string} noun - What is being counted: 'labels' or 'validations'.
   * @param {string} period - Phrase naming the period, e.g. 'today' or 'in the last 7 days'.
   */
  #renderAiNote(id, aiCount, humanCount, noun, period) {
    const el = document.getElementById(id);
    if (!el) return;
    const ai = aiCount || 0;
    const people = humanCount || 0;
    el.textContent = ai ? `+ ${this.#num(ai)} by AI` : '';
    if (ai) {
      el.setAttribute('data-ps-tooltip', AcrossCitiesPage.#esc(`People made ${this.#num(people)} of the `
        + `${this.#num(people + ai)} ${noun} ${period}; ${this.#num(ai)} came from AI accounts.`));
    } else {
      el.removeAttribute('data-ps-tooltip');
    }
  }

  /**
   * Reports the anonymous sessions beside a tile's contributor count, or clears the line when there were none.
   *
   * Kept out of the contributor count rather than folded in: an anonymous account is minted per browser cookie, so one
   * person who visits from two browsers — or clears their cookies — is several of these. Counting them as contributors
   * would inflate a headline that reads as a headcount, and the work itself is already in the label and validation
   * totals either way.
   *
   * @param {string} id - Element id of the tile's anonymous line.
   * @param {number} anonCount - Distinct anonymous identities active in the period.
   * @param {string} period - Phrase naming the period, e.g. 'today' or 'in the last 7 days'.
   */
  #renderAnonNote(id, anonCount, period) {
    const el = document.getElementById(id);
    if (!el) return;
    const anon = anonCount || 0;
    el.textContent = anon ? `+ ${this.#num(anon)} anonymous ${anon === 1 ? 'session' : 'sessions'}` : '';
    if (anon) {
      el.setAttribute('data-ps-tooltip', AcrossCitiesPage.#esc('The contributor count is registered accounts. '
        + `${this.#num(anon)} anonymous ${anon === 1 ? 'session' : 'sessions'} also contributed ${period}; each is a `
        + 'browser cookie rather than a known person, so they are counted separately.'));
    } else {
      el.removeAttribute('data-ps-tooltip');
    }
  }

  /**
   * Reports the AI accounts active alongside a tile's contributor count, or clears the line when there were none.
   *
   * @param {string} id - Element id of the tile's AI line.
   * @param {number} agentCount - Distinct AI-role accounts active in the period, across all cities.
   * @param {string} period - Phrase naming the period, e.g. 'today' or 'in the last 7 days'.
   */
  #renderAgentNote(id, agentCount, period) {
    const el = document.getElementById(id);
    if (!el) return;
    const agents = agentCount || 0;
    el.textContent = agents ? `+ ${this.#num(agents)} AI ${agents === 1 ? 'account' : 'accounts'}` : '';
    if (agents) {
      el.setAttribute('data-ps-tooltip', AcrossCitiesPage.#esc(`The contributor count is people. `
        + `${this.#num(agents)} AI ${agents === 1 ? 'account was' : 'accounts were'} also active ${period}.`));
    } else {
      el.removeAttribute('data-ps-tooltip');
    }
  }

  /**
   * Computes the week-over-week change between a rolling 7-day count and the 7 days before it. Changes under ±1% read
   * as flat, so ordinary noise doesn't render as a trend.
   *
   * @param {number} current - Trailing-7-day count.
   * @param {number} prior - Count for the 7 days before that; 0 degrades the wording (a percentage is undefined).
   * @returns {{dir: string, short: string, long: string, title: string}} Direction ('up' | 'down' | 'flat'), a compact
   *   arrow+percent for table cells, a full phrase for the tiles, and the raw-count tooltip.
   */
  #deltaParts(current, prior) {
    const title = `${this.#num(current)} in the last 7 days vs ${this.#num(prior)} in the 7 days before`;
    if (!prior) {
      const dir = current > 0 ? 'up' : 'flat';
      return {
        dir,
        short: current > 0 ? '▲ new' : '→',
        long: current > 0 ? '▲ up from 0 the week before' : '→ no recent activity',
        title,
      };
    }
    const frac = (current - prior) / prior;
    const dir = Math.abs(frac) < 0.01 ? 'flat' : (frac > 0 ? 'up' : 'down');
    const arrow = dir === 'up' ? '▲' : (dir === 'down' ? '▼' : '→');
    const pct = this.#pct(Math.abs(frac));
    // A flat cell shows the arrow alone: "→ 0%" next to a count reads like a second statistic rather than "unchanged".
    return { dir, short: dir === 'flat' ? arrow : `${arrow} ${pct}`, long: `${arrow} ${pct} vs prior 7 days`, title };
  }

  /**
   * Sets a tile's week-over-week delta line, direction-colored, with the raw counts in the tooltip.
   *
   * @param {string} id - Element id of the tile's `.ac-hero-delta` span.
   * @param {number} current - Trailing-7-day count.
   * @param {number} prior - Count for the 7 days before that.
   */
  #renderDelta(id, current, prior) {
    const el = document.getElementById(id);
    if (!el) return;
    const d = this.#deltaParts(current, prior);
    el.className = `ac-hero-delta ac-hero-delta--${d.dir}`;
    el.textContent = d.long;
    el.title = d.title;
  }

  /**
   * Pulls one metric's current, prior, and AI counts out of a city's rolling window.
   *
   * @param {object} w - The city's `activity_window`.
   * @param {string} metric - 'activity' | 'labels' | 'validations' | 'contributors'.
   * @returns {{current: number, prior: number, ai: number}} What people did in each window, and what AI produced in
   *   the current one (for contributors, the AI figure is accounts rather than output).
   */
  #metricCounts(w, metric) {
    switch (metric) {
      case 'labels':
        return { current: w.labels_7d || 0, prior: w.labels_prior_7d || 0, ai: w.ai_labels_7d || 0 };
      case 'validations':
        return { current: w.validations_7d || 0, prior: w.validations_prior_7d || 0, ai: w.ai_validations_7d || 0 };
      case 'contributors':
        return { current: w.contributors_7d || 0, prior: w.contributors_prior_7d || 0, ai: w.ai_agents_7d || 0 };
      default: // 'activity' — labels and validations together, the column the table ranks on.
        return {
          current: (w.labels_7d || 0) + (w.validations_7d || 0),
          prior: (w.labels_prior_7d || 0) + (w.validations_prior_7d || 0),
          ai: (w.ai_labels_7d || 0) + (w.ai_validations_7d || 0),
        };
    }
  }

  /**
   * A "Most active cities" cell: what people did, the week-over-week chip qualifying it, the AI output alongside, and
   * a hover card naming the contributors behind the number.
   *
   * The chip carries no `title` of its own — the raw counts it would have shown are in the card, and a native tooltip
   * would open on top of it. The cell takes `tabindex` so the card is reachable by keyboard, since psTooltip opens on
   * focus too.
   *
   * @param {object} city - The scorecard row, carrying `activity_window`.
   * @param {string} metric - 'activity' | 'labels' | 'validations' | 'contributors'.
   * @param {boolean} [showDelta=true] - False on the Activity column, where three chipped neighbors are enough.
   * @returns {string} The cell's markup.
   */
  #weekCell(city, metric, showDelta = true) {
    const { current, prior, ai } = this.#metricCounts(city.activity_window || {}, metric);
    // A city with no activity in either window gets the bare count, since "→ 0%" is noise.
    const d = showDelta && (current || prior) ? this.#deltaParts(current, prior) : null;
    const delta = d ? `<span class="ac-cell-delta ac-cell-delta--${d.dir}">${d.short}</span>` : '';
    const aiChip = ai ? `<span class="ac-cell-ai">+${this.#compact(ai)} AI</span>` : '';
    return `<td class="ac-num" tabindex="0" data-ps-tooltip="`
      + `${AcrossCitiesPage.#esc(this.#cityTipHtml(city, metric))}">${this.#num(current)}${delta}${aiChip}</td>`;
  }

  // --- Deployment cities map --------------------------------------------------------------------------------------

  /**
   * Renders the deployment-cities Mapbox map: one circle per city, area ∝ label count, colored by lifecycle, with a
   * stats popup. Joins the cities geo (lat/lng from /v3/api/cities) to the scorecards by city_id. Degrades to a note
   * if Mapbox, the token, or the geo are unavailable.
   *
   * @param {?object} citiesGeo - The /v3/api/cities response, or null.
   */
  #renderMap(citiesGeo) {
    const host = document.getElementById('ac-cities-map');
    if (!host) return;
    if (typeof mapboxgl === 'undefined' || !this.#mapboxToken || !citiesGeo || !Array.isArray(citiesGeo.cities)) {
      this.#setText('ac-map-status', 'Map unavailable.');
      host.style.display = 'none';
      return;
    }

    const byId = new Map(this.#cities.map((c) => [c.city_id, c]));
    const features = [];
    let maxLabels = 1;
    for (const geo of citiesGeo.cities) {
      if (geo.center_lat === null || geo.center_lat === undefined) continue;
      if (geo.center_lng === null || geo.center_lng === undefined) continue;
      const sc = byId.get(geo.city_id);
      const labelCount = sc ? (sc.total_labels || 0) : 0;
      maxLabels = Math.max(maxLabels, labelCount);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [geo.center_lng, geo.center_lat] },
        properties: {
          name: geo.city_name_formatted || geo.city_name_short || geo.city_id,
          url: geo.url || (sc && sc.url) || '',
          lifecycle: sc ? sc.lifecycle : null,
          color: AcrossCitiesPage.#LIFECYCLE_COLOR[sc && sc.lifecycle] || '#9aa7b0',
          visibility: geo.visibility || (sc && sc.visibility) || 'public',
          labelCount,
          popup: this.#mapPopupHtml(geo, sc),
        },
      });
    }
    if (!features.length) {
      this.#setText('ac-map-status', 'No city locations available.');
      host.style.display = 'none';
      return;
    }
    // sqrt scaling so circle AREA (not radius) tracks label count — perceptually honest.
    for (const f of features) {
      const n = f.properties.labelCount;
      f.properties.radius = n > 0 ? 5 + (Math.sqrt(n) / Math.sqrt(maxLabels)) * 19 : 5;
    }

    mapboxgl.accessToken = this.#mapboxToken;
    this.#map = new mapboxgl.Map({
      container: 'ac-cities-map',
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-30, 28],
      zoom: 1.2,
      minZoom: 1,
      projection: 'mercator',
    });
    this.#map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'coverage-popup' });

    this.#map.on('load', () => {
      this.#map.addSource('ac-cities', { type: 'geojson', data: { type: 'FeatureCollection', features } });
      this.#map.addLayer({
        id: 'ac-cities-circles',
        type: 'circle',
        source: 'ac-cities',
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.75,
          // Private deployments get a thicker dark ring; public get a thin white stroke.
          'circle-stroke-width': ['case', ['==', ['get', 'visibility'], 'public'], 1, 3],
          'circle-stroke-color': ['case', ['==', ['get', 'visibility'], 'public'], '#ffffff', '#33373a'],
        },
      });
      const showPopup = (e) => {
        const f = e.features[0];
        this.#map.getCanvas().style.cursor = 'pointer';
        popup.setLngLat(f.geometry.coordinates).setHTML(f.properties.popup).addTo(this.#map);
      };
      this.#map.on('mouseenter', 'ac-cities-circles', showPopup);
      this.#map.on('mousemove', 'ac-cities-circles', showPopup);
      this.#map.on('mouseleave', 'ac-cities-circles', () => {
        this.#map.getCanvas().style.cursor = '';
        popup.remove();
      });
      this.#map.on('click', 'ac-cities-circles', (e) => {
        const url = e.features[0].properties.url;
        if (url) window.open(url, '_blank', 'noopener');
      });
    });
  }

  /** Popup HTML for one city on the map. */
  #mapPopupHtml(geo, sc) {
    const name = AcrossCitiesPage.#esc(geo.city_name_formatted || geo.city_name_short || geo.city_id);
    if (!sc) {
      return `<div class="coverage-popup-name">${name}</div><div>No stats available.</div>`;
    }
    const lc = AcrossCitiesPage.#LIFECYCLE[sc.lifecycle];
    const rows = [
      ['Status', lc ? lc.label : '—'],
      ['Coverage', this.#pct(sc.coverage)],
      ['Labels', this.#num(sc.total_labels)],
      ['Validations', this.#num(sc.total_validations)],
      ['Contributors', this.#num(sc.active_contributors)],
      ['Last activity', sc.last_activity ? AdminShell.relativeTime(sc.last_activity) : 'never'],
    ].map(([k, v]) => `<tr><td>${k}</td><td>${AcrossCitiesPage.#esc(v)}</td></tr>`).join('');
    return `<div class="coverage-popup-name">${name}</div>`
      + `<table class="coverage-popup-dl">${rows}</table>`;
  }

  // --- Needs attention --------------------------------------------------------------------------------------------

  /**
   * Builds the attention panel: cities whose lifecycle warrants attention (stalled / low traction) plus any
   * data-quality anomaly (high disagreement). "Wrapped up" cities are deliberately NOT flagged — they succeeded.
   * Shows an "all clear" note when nothing needs attention.
   */
  #renderAttention() {
    const el = document.getElementById('ac-attention');
    if (!el) return;

    const items = [];
    for (const c of this.#cities) {
      const lc = AcrossCitiesPage.#LIFECYCLE[c.lifecycle];
      if (lc && lc.attention) {
        items.push({ sev: c.lifecycle === 'low_traction' ? 'bad' : 'warn', city: c,
          label: lc.label, reason: this.#lifecycleReason(c) });
      }
      for (const flag of (c.anomalies || [])) {
        const meta = AcrossCitiesPage.#ANOMALY[flag] || { label: flag, sev: 'info' };
        items.push({ sev: meta.sev, city: c, label: meta.label, reason: this.#anomalyReason(flag, c) });
      }
    }
    const order = { bad: 0, warn: 1, info: 2 };
    items.sort((a, b) => (order[a.sev] - order[b.sev]));

    if (!items.length) {
      el.innerHTML = '<p class="ov-attention-clear">All clear — no city needs attention right now. ✅</p>';
      return;
    }
    el.innerHTML = items.map((it) => {
      const name = AcrossCitiesPage.#esc(it.city.city_name || it.city.city_id);
      const href = it.city.url ? AcrossCitiesPage.#esc(it.city.url) : '#';
      return [
        `<a class="ov-attention-item ov-attention--${it.sev === 'bad' ? 'warn' : it.sev}" href="${href}"`,
        it.city.url ? ' target="_blank" rel="noopener">' : '>',
        '<span class="ov-attention-dot" aria-hidden="true"></span>',
        `<span class="ov-attention-text"><strong>${name}</strong> — ${AcrossCitiesPage.#esc(it.reason)}</span>`,
        `<span class="ov-attention-go">${AcrossCitiesPage.#esc(it.label)} →</span>`,
        '</a>',
      ].join('');
    }).join('');
  }

  /** Explanation for a lifecycle state that needs attention, using the city's own numbers. */
  #lifecycleReason(c) {
    const quiet = c.days_since_activity === null || c.days_since_activity === undefined
      ? 'no recorded activity'
      : `quiet for ${c.days_since_activity} days`;
    if (c.lifecycle === 'low_traction') {
      return `never took off — ${quiet}, ${this.#pct(c.coverage)} coverage, `
        + `${this.#num(c.active_contributors)} contributors`;
    }
    // Stalled: had a community, lost momentum before finishing.
    return `stalled at ${this.#pct(c.coverage)} coverage — ${quiet} `
      + `(${this.#num(c.active_contributors)} contributors)`;
  }

  /** Human-readable explanation for one data-quality anomaly flag on one city, using the city's own numbers. */
  #anomalyReason(flag, c) {
    switch (flag) {
      case 'high_disagreement':
        return `${this.#pct(c.validation_disagreement_rate)} of human validations disagree `
          + `(median ${this.#pct(this.#summary.median_disagreement_rate)})`;
      default:
        return flag;
    }
  }

  /** A colored lifecycle badge. */
  #lifecycleBadge(state) {
    const lc = AcrossCitiesPage.#LIFECYCLE[state] || { label: state, tone: 'ok' };
    return `<span class="ac-badge ac-badge--${lc.tone}">${AcrossCitiesPage.#esc(lc.label)}</span>`;
  }

  // --- Over-time charts -------------------------------------------------------------------------------------------

  /**
   * Prepares the two over-time datasets (last 12 weeks, summed from each city's trend; and all-time, from the
   * server-aggregated series), wires the range toggle, and draws the current range. Also draws the toggle-independent
   * cumulative charts (#4686) and the "Today & this week" section's daily bar charts, all static once loaded.
   */
  #renderTrends() {
    this.#trendSeries = {
      recent: this.#aggregateWeekly(this.#cities.flatMap((c) => c.weekly_trend || [])),
      all: this.#allTimeTrend.slice(),
    };

    const toggle = document.getElementById('ac-trend-toggle');
    if (toggle) {
      toggle.querySelectorAll('.ac-toggle-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.#trendRange = btn.dataset.range;
          toggle.querySelectorAll('.ac-toggle-btn').forEach((b) => b.classList.toggle('active', b === btn));
          this.#drawTrends();
        });
      });
    }
    this.#drawTrends();
    this.#drawCumulative();
    this.#drawWeekBars();
  }

  /** Sums a flat list of weekly points into one cross-city series, ascending by week. */
  #aggregateWeekly(points) {
    const m = new Map();
    for (const w of points) {
      const e = m.get(w.week_start) || { week_start: w.week_start, labels: 0, validations: 0, active_users: 0 };
      e.labels += w.labels || 0;
      e.validations += w.validations || 0;
      e.active_users += w.active_users || 0;
      m.set(w.week_start, e);
    }
    return [...m.values()].sort((a, b) => (a.week_start < b.week_start ? -1 : a.week_start > b.week_start ? 1 : 0));
  }

  /** Draws the three over-time line charts for the currently selected range. */
  #drawTrends() {
    const series = this.#trendSeries[this.#trendRange] || [];
    // Multi-year x-axes carry the year; within 12 weeks "Jun 9" is unambiguous.
    const fmt = this.#trendRange === 'all' ? AcrossCitiesPage.#shortDateYear : AcrossCitiesPage.#shortDate;
    const cats = series.map((w) => fmt(w.week_start));
    // Small dots on the short (12-week) view where they aid hover tooltips; none on the dense all-time view, where
    // hundreds of points would just be noise.
    const dotRadius = series.length > 30 ? 0 : 2;
    const draw = (id, key, name, values) => {
      const host = document.getElementById(id);
      if (host) MiniLineChart.renderInto(host, cats, [{ name, key, values }], { ariaLabel: name, dotRadius });
    };
    draw('ac-chart-labels', 'aclabels', 'Labels', series.map((w) => w.labels));
    draw('ac-chart-validations', 'acvals', 'Validations', series.map((w) => w.validations));
    draw('ac-chart-users', 'acusers', 'Active users', series.map((w) => w.active_users));
  }

  /**
   * Draws the cumulative all-time line charts (#4686) by prefix-summing the server's all-time weekly series. Labels
   * and validations accumulate their weekly counts; users accumulate new_users (each person's first-activity week),
   * since summing weekly active_users would re-count returning contributors.
   */
  #drawCumulative() {
    const series = this.#allTimeTrend;
    const cats = series.map((w) => AcrossCitiesPage.#shortDateYear(w.week_start));
    const cumulative = (key) => {
      let total = 0;
      return series.map((w) => (total += w[key] || 0));
    };
    const draw = (id, key, name, values) => {
      const host = document.getElementById(id);
      if (host) MiniLineChart.renderInto(host, cats, [{ name, key, values }], { ariaLabel: name, dotRadius: 0 });
    };
    draw('ac-chart-cum-labels', 'aclabels', 'Total labels', cumulative('labels'));
    draw('ac-chart-cum-validations', 'acvals', 'Total validations', cumulative('validations'));
    draw('ac-chart-cum-users', 'acusers', 'Total users', cumulative('new_users'));
  }

  /**
   * Draws the "Today & this week" section's rolling-7-day bar charts (#4686) from the server's zero-filled daily
   * series. A rolling 7-day window holds exactly one of each weekday, so short weekday names are unambiguous x
   * labels; the hover card carries the full date.
   *
   * All three charts share one card per day (#4931): the three volumes move together, so someone asking why Tuesday's
   * labels spiked wants that day's validations, cities, and people in the same breath — not three separate hovers.
   * Each chart leans on its own line so the shared card still answers the bar under the cursor first.
   */
  #drawWeekBars() {
    const series = this.#dailyTrend;
    const cats = series.map((d) => AcrossCitiesPage.#weekday(d.day));
    const draw = (id, key, jsonKey, name) => {
      const host = document.getElementById(id);
      if (!host) return;
      const values = series.map((d) => d[jsonKey] || 0);
      const tooltipsHtml = series.map((d) => this.#dayTipHtml(d, jsonKey));
      const tooltips = series.map((d, i) => `${AcrossCitiesPage.#shortDate(d.day)} · ${name}: ${this.#num(values[i])}`);
      // Compact value labels above each bar (exact counts stay in the cards); the last bar is today, still
      // filling in, so it gets the emphasis treatment.
      MiniLineChart.renderInto(host, cats, [{ name, key, values, tooltips, tooltipsHtml }],
        { ariaLabel: name, kind: 'bar', maxXLabels: 7, barValues: true, valueFormat: (v) => this.#compact(v),
          emphasisIndex: series.length - 1 });
    };
    draw('ac-chart-week-labels', 'aclabels', 'labels', 'Labels');
    draw('ac-chart-week-validations', 'acvals', 'validations', 'Validations');
    draw('ac-chart-week-users', 'acusers', 'contributors', 'Contributors');
  }

  // --- Scorecard table --------------------------------------------------------------------------------------------

  /**
   * Wires click-to-sort onto one table's `th[data-sort]` headers. Clicking the active column flips direction;
   * switching columns starts descending (biggest first) except for the city name, which reads naturally A→Z.
   *
   * @param {string} tableId - Element id of the table; must have an entry in `#sortState`.
   * @param {Function} render - Re-renders that table's body from the updated sort state.
   */
  #wireSorting(tableId, render) {
    const state = this.#sortState[tableId];
    if (!state) return;
    document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');
        if (state.key === key) {
          state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.key = key;
          state.dir = key === 'city_name' ? 'asc' : 'desc';
        }
        render();
      });
      // Headers are interactive, so they need to be reachable and operable from the keyboard (WCAG 2.1.1).
      th.setAttribute('tabindex', '0');
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          th.click();
        }
      });
    });
  }

  #renderTable() {
    const tbody = document.getElementById('ac-tbody');
    if (!tbody) return;
    if (!this.#cities.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="dq-empty">No cities to show.</td></tr>';
      this.#setText('ac-status', '');
      return;
    }
    const state = this.#sortState['ac-table'];
    const rows = this.#sortedCities(state.key, state.dir);
    tbody.innerHTML = rows.map((c) => {
      const lc = AcrossCitiesPage.#LIFECYCLE[c.lifecycle];
      const needsAttention = (lc && lc.attention) || (c.anomalies || []).length > 0;
      const chips = (c.anomalies || []).map((f) => {
        const meta = AcrossCitiesPage.#ANOMALY[f] || { label: f, sev: 'info' };
        return `<span class="ac-chip ac-chip--${meta.sev}">${AcrossCitiesPage.#esc(meta.label)}</span>`;
      }).join('');
      const chipsHtml = chips ? ` <span class="ac-chips">${chips}</span>` : '';
      const lastActivity = c.last_activity
        ? AcrossCitiesPage.#esc(AdminShell.relativeTime(c.last_activity))
        : '<span class="ac-muted">never</span>';
      return `
        <tr class="${needsAttention ? 'ac-row--flagged' : ''}">
          <td class="ac-td-city">${this.#cityLink(c)}${chipsHtml}</td>
          <td>${this.#lifecycleBadge(c.lifecycle)}</td>
          <td>${this.#coverageBar(c.coverage)}</td>
          <td class="ac-num" title="${this.#num(c.total_labels)}">${this.#compact(c.total_labels)}</td>
          <td class="ac-num" title="${this.#num(c.total_validations)}"> ${this.#compact(c.total_validations)}</td>
          <td class="ac-num" title="${this.#num(c.active_contributors)}"> ${this.#compact(c.active_contributors)}</td>
          <td class="ac-num">${this.#pct(c.ai_label_share)}</td>
          <td class="ac-num">${lastActivity}</td>
        </tr>`;
    }).join('');
    this.#markSortedHeader('ac-table');
    this.#setText('ac-status', `${rows.length} ${rows.length === 1 ? 'city' : 'cities'}.`);
  }

  /**
   * Sorts cities by one column.
   *
   * @param {string} key - Sort key. A dotted key reads into the nested rolling window, e.g.
   *   `activity_window.labels_7d`.
   * @param {string} dirStr - 'asc' or 'desc'.
   * @param {Array} [list] - Rows to sort; defaults to every city.
   * @returns {Array} A new sorted array; the input is not mutated.
   */
  #sortedCities(key, dirStr, list) {
    const dir = dirStr === 'asc' ? 1 : -1;
    const val = (c) => {
      if (key === 'city_name') return (c.city_name || c.city_id || '').toLowerCase();
      if (key === 'lifecycle') {
        const lc = AcrossCitiesPage.#LIFECYCLE[c.lifecycle];
        return lc ? lc.rank : 99;
      }
      // Never-active cities sort last under "most recent first" rather than reading as maximally fresh.
      if (key === 'days_since_activity') return c.days_since_activity ?? Number.MAX_SAFE_INTEGER;
      if (key.includes('.')) {
        const [outer, inner] = key.split('.');
        return (c[outer] && c[outer][inner]) ?? 0;
      }
      return c[key] ?? 0;
    };
    return (list || this.#cities).slice().sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

  /**
   * Marks the active sort column on one table for both sighted users (the `ac-sorted` arrow) and assistive tech
   * (`aria-sort`).
   *
   * @param {string} tableId - Element id of the table.
   */
  #markSortedHeader(tableId) {
    const state = this.#sortState[tableId];
    if (!state) return;
    document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach((th) => {
      const key = th.getAttribute('data-sort');
      th.classList.toggle('ac-sorted', key === state.key);
      if (key === state.key) {
        th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
        th.dataset.dir = state.dir;
      } else {
        th.removeAttribute('aria-sort');
        delete th.dataset.dir;
      }
    });
  }

  // --- Coverage section -------------------------------------------------------------------------------------------

  #renderCoverage() {
    const tbody = document.getElementById('ac-coverage-tbody');
    if (!tbody) return;
    const rows = this.#sortedCities('coverage', 'desc');
    tbody.innerHTML = rows.map((c) => `
      <tr class="${(c.lifecycle === 'stalled' || c.lifecycle === 'low_traction') ? 'ac-row--flagged' : ''}">
        <td class="ac-td-city">${this.#cityLink(c)}</td>
        <td>${this.#coverageBar(c.coverage)}</td>
        <td class="ac-num" title="${this.#num(c.audited_streets)} of ${this.#num(c.total_streets)}">
          ${this.#compact(c.audited_streets)} / ${this.#compact(c.total_streets)}</td>
        <td class="ac-num" title="${this.#num(c.streets_remaining)}"> ${this.#compact(c.streets_remaining)}</td>
        <td class="ac-num">${this.#km(c.audited_km)} / ${this.#km(c.total_km)}</td>
        <td class="ac-num">${this.#km(c.km_remaining)}</td>
      </tr>`,
    ).join('');
  }

  // --- Most active cities -----------------------------------------------------------------------------------------

  /**
   * Fills the "Most active cities" table (#4758): the busiest handful of the past 7 days, with each count's
   * week-over-week change.
   *
   * The table re-ranks on whatever numeric column is sorted rather than reordering a fixed five, so sorting by
   * contributors answers "who had the most contributors this week" instead of "which of the five busiest had the
   * most". Sorting by City instead keeps the five busiest and orders them by name — an alphabetical five isn't a
   * ranking. Counts come from the rolling windows (`activity_window`), never the scorecard's own 7d fields, so a
   * level and its delta always share one basis. Cities with no activity at all are excluded, so a quiet week yields
   * a short table, not five rows of zeros.
   */
  #renderTopCities() {
    const tbody = document.getElementById('ac-top-tbody');
    if (!tbody) return;
    const active = this.#cities.filter((c) => c.activity_7d > 0);
    if (!active.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="dq-empty">No city recorded activity in the past 7 days.</td></tr>';
      this.#setText('ac-top-status', '');
      return;
    }
    const state = this.#sortState['ac-top-table'];
    // A name sort keeps the five busiest and merely orders them; only numeric columns re-rank which five appear.
    const ranked = state.key === 'city_name'
      ? this.#sortedCities('activity_7d', 'desc', active)
      : this.#sortedCities(state.key, state.dir, active);
    let rows = ranked.slice(0, AcrossCitiesPage.#TOP_CITIES_LIMIT);
    if (state.key === 'city_name') rows = this.#sortedCities(state.key, state.dir, rows);
    tbody.innerHTML = rows.map((c) => `
        <tr>
          <td class="ac-td-city">${this.#cityLink(c)}</td>
          ${this.#weekCell(c, 'activity', false)}
          ${this.#weekCell(c, 'labels')}
          ${this.#weekCell(c, 'validations')}
          ${this.#weekCell(c, 'contributors')}
          <td class="ac-num">${this.#num(c.audits_7d)}</td>
          <td class="ac-spark-cell">${this.#sparkline((c.weekly_trend || []).map((wk) => wk.labels || 0))}</td>
        </tr>`).join('');
    this.#markSortedHeader('ac-top-table');
    this.#setText('ac-top-status', active.length > rows.length
      ? `Top ${rows.length} of ${this.#num(active.length)} cities active in the past 7 days.`
      : `${this.#num(active.length)} ${active.length === 1 ? 'city' : 'cities'} active in the past 7 days.`);
  }

  // --- Activity section -------------------------------------------------------------------------------------------

  #renderActivity() {
    const tbody = document.getElementById('ac-activity-tbody');
    if (!tbody) return;
    const state = this.#sortState['ac-activity-table'];
    const rows = this.#sortedCities(state.key, state.dir);
    tbody.innerHTML = rows.map((c) => {
      const last = c.last_activity
        ? AcrossCitiesPage.#esc(AdminShell.relativeTime(c.last_activity))
        : '<span class="ac-muted">never</span>';
      const spark = this.#sparkline((c.weekly_trend || []).map((w) => w.labels || 0));
      const flagged = c.lifecycle === 'stalled' || c.lifecycle === 'low_traction';
      return `
        <tr class="${flagged ? 'ac-row--flagged' : ''}">
          <td class="ac-td-city">${this.#cityLink(c)}</td>
          <td class="ac-num">${this.#num(c.labels_7d)} / ${this.#num(c.labels_30d)}</td>
          <td class="ac-num">${this.#num(c.validations_7d)} / ${this.#num(c.validations_30d)}</td>
          <td class="ac-num">${this.#num(c.audits_7d)} / ${this.#num(c.audits_30d)}</td>
          <td class="ac-num">${last}</td>
          <td class="ac-spark-cell">${spark}</td>
        </tr>`;
    }).join('');
    this.#markSortedHeader('ac-activity-table');
  }

  // --- Contributors & effort section ------------------------------------------------------------------------------

  #renderEffort() {
    const tbody = document.getElementById('ac-effort-tbody');
    if (!tbody) return;
    const rows = this.#cities.slice().sort((a, b) => (b.num_labelers || 0) - (a.num_labelers || 0));
    tbody.innerHTML = rows.map((c) => {
      const out = (med, p90) => `${this.#num(Math.round(med || 0))} `
        + `<span class="ac-muted">· ${this.#num(Math.round(p90 || 0))}</span>`;
      const v10 = c.seconds_to_validate_10 > 0
        ? this.#duration(c.seconds_to_validate_10)
        : '<span class="ac-muted">—</span>';
      const l100 = c.seconds_per_100m !== null && c.seconds_per_100m !== undefined
        ? this.#duration(c.seconds_per_100m)
        : '<span class="ac-muted">—</span>';
      return `
        <tr>
          <td class="ac-td-city">${this.#cityLink(c)}</td>
          <td class="ac-num">${this.#num(c.num_labelers)}</td>
          <td class="ac-num">${out(c.labels_per_user_median, c.labels_per_user_p90)}</td>
          <td class="ac-num">${this.#num(c.num_validators)}</td>
          <td class="ac-num">${out(c.validations_per_user_median, c.validations_per_user_p90)}</td>
          <td class="ac-num">${v10}</td>
          <td class="ac-num">${l100}</td>
        </tr>`;
    }).join('');
  }

  // --- Data patterns section --------------------------------------------------------------------------------------

  /** Renders the label-type legend + one normalized stacked bar per city, so problem mixes compare directly. */
  #renderPatterns() {
    const host = document.getElementById('ac-patterns');
    const legendEl = document.getElementById('ac-patterns-legend');
    if (!host) return;

    // Only show label types that actually appear in at least one city, in canonical order.
    const present = AcrossCitiesPage.#LABEL_TYPES.filter(([key]) =>
      this.#cities.some((c) => c.by_label_type && c.by_label_type[key] && c.by_label_type[key].labels > 0));

    if (legendEl) {
      legendEl.innerHTML = present.map(([key, name]) => `
        <span class="ac-legend-item">
          <span class="ac-legend-swatch" style="background:${this.#color(key)}"></span>
          ${AcrossCitiesPage.#esc(name)}
        </span>`).join('');
    }

    const rows = this.#cities.slice().sort((a, b) => (b.total_labels || 0) - (a.total_labels || 0));
    host.innerHTML = rows.map((c) => {
      const total = present.reduce((sum, [key]) =>
        sum + ((c.by_label_type && c.by_label_type[key] && c.by_label_type[key].labels) || 0), 0);
      let segments;
      if (total === 0) {
        segments = '<span class="ac-stack-empty">no labels</span>';
      } else {
        segments = present.map(([key, name]) => {
          const n = (c.by_label_type && c.by_label_type[key] && c.by_label_type[key].labels) || 0;
          if (n === 0) return '';
          const share = n / total;
          const tip = `${name}: ${this.#num(n)} (${this.#pct(share)})`;
          return `<span class="ac-stack-seg" title="${AcrossCitiesPage.#esc(tip)}"
            style="width:${(share * 100).toFixed(2)}%;background:${this.#color(key)}"></span>`;
        }).join('');
      }
      return `
        <div class="ac-pattern-row">
          <div class="ac-pattern-city">
            ${this.#cityLink(c)} <span class="ac-muted">${this.#compact(c.total_labels)}</span>
          </div>
          <div class="ac-stack">${segments}</div>
        </div>`;
    }).join('');
  }

  // --- Data quality section ---------------------------------------------------------------------------------------

  #renderQuality() {
    const tbody = document.getElementById('ac-quality-tbody');
    if (!tbody) return;
    const rows = this.#sortedCities('labels_validated_share', 'desc');
    tbody.innerHTML = rows.map((c) => {
      const agreeDenom = (c.validations_agree || 0) + (c.validations_disagree || 0);
      const agreeRate = agreeDenom > 0 ? c.validations_agree / agreeDenom : null;
      const contribDenom = (c.active_contributors || 0) + (c.low_quality_contributors || 0);
      const lowQShare = contribDenom > 0 ? c.low_quality_contributors / contribDenom : 0;
      const flagged = (c.anomalies || []).includes('high_disagreement');
      const vpl = c.validations_per_label || 0;
      const agreeCell = agreeRate === null ? '<span class="ac-muted">—</span>' : this.#pct(agreeRate);
      const valTitle = `${this.#num(c.total_validations)} validations / ${this.#num(c.total_labels)} labels`;
      const sevWith = this.#num(c.labels_with_severity);
      const sevElig = this.#num(c.labels_severity_eligible);
      const sevTitle = `${sevWith} of ${sevElig} severity-eligible labels`;
      const tagTitle = `${this.#num(c.labels_with_tags)} of ${this.#num(c.labels_tag_eligible)} tag-eligible labels`;
      const aiValTitle = `${this.#num(c.ai_validations)} of ${this.#num(c.total_validations)} validations`;
      const lowQTitle = `${this.#num(c.low_quality_contributors)} of ${this.#num(contribDenom)} contributors`;
      return `
        <tr class="${flagged ? 'ac-row--flagged' : ''}">
          <td class="ac-td-city">${this.#cityLink(c)}</td>
          <td class="ac-num" title="${this.#num(c.labels_validated)} of ${this.#num(c.total_labels)}">
            ${this.#pct(c.labels_validated_share)}</td>
          <td class="ac-num" title="${valTitle}"> ${vpl.toFixed(1)}</td>
          <td class="ac-num">${agreeCell}</td>
          <td class="ac-num" title="${sevTitle}"> ${this.#pct(c.severity_share)}</td>
          <td class="ac-num" title="${tagTitle}"> ${this.#pct(c.tags_share)}</td>
          <td class="ac-num" title="${this.#num(c.ai_labels)} of ${this.#num(c.total_labels)} labels">
            ${this.#pct(c.ai_label_share)}</td>
          <td class="ac-num" title="${aiValTitle}"> ${this.#pct(c.ai_validation_share)}</td>
          <td class="ac-num" title="${lowQTitle}"> ${this.#pct(lowQShare)}</td>
        </tr>`;
    }).join('');
  }

  // --- Engagement funnel (#288) -----------------------------------------------------------------------------------

  /** Wires the window selector (refetches) and the breakdown toggle (re-renders from cached data). */
  #wireFunnelControls() {
    const win = document.getElementById('ac-funnel-window');
    if (win) {
      win.querySelectorAll('.ac-toggle-btn').forEach((btn) => btn.addEventListener('click', () => {
        if (this.#funnelWindow === btn.dataset.window) return;
        this.#funnelWindow = btn.dataset.window;
        win.querySelectorAll('.ac-toggle-btn').forEach((b) => b.classList.toggle('active', b === btn));
        this.#loadFunnels();
      }));
    }
    const dim = document.getElementById('ac-funnel-dim');
    if (dim) {
      dim.querySelectorAll('.ac-toggle-btn').forEach((btn) => btn.addEventListener('click', () => {
        if (this.#funnelDim === btn.dataset.dim) return;
        this.#funnelDim = btn.dataset.dim;
        dim.querySelectorAll('.ac-toggle-btn').forEach((b) => b.classList.toggle('active', b === btn));
        this.#renderFunnels();
      }));
    }
  }

  /** Fetches the funnels for the current window and renders them; a failure shows a message but leaves it intact. */
  async #loadFunnels() {
    this.#setText('ac-funnel-status', 'Loading funnels…');
    try {
      const data = await this.#fetchJson(`${this.#funnelsUrl}?window=${encodeURIComponent(this.#funnelWindow)}`);
      this.#funnels = (data && data.funnels) || {};
      this.#renderFunnels();
    } catch (err) {
      console.error('Funnel load failed:', err);
      this.#setText('ac-funnel-status', 'Could not load funnel data.');
    }
  }

  /** Renders each funnel (mapping, contribution) as its own block for the active breakdown dimension. */
  #renderFunnels() {
    const host = document.getElementById('ac-funnels');
    if (!host) return;
    const segs = AcrossCitiesPage.#FUNNEL_DIMS[this.#funnelDim] || AcrossCitiesPage.#FUNNEL_DIMS.all;
    const types = AcrossCitiesPage.#FUNNEL_ORDER.filter((t) => this.#funnels[t]);
    host.innerHTML = types.map((t) => this.#funnelBlock(t, this.#funnels[t], segs)).join('');
    const n = types.reduce((max, t) => Math.max(max, (this.#funnels[t].cities || []).length), 0);
    this.#setText(
      'ac-funnel-status', n ? `${n} ${n === 1 ? 'city' : 'cities'} with funnel data.` : 'No funnel data yet.',
    );
  }

  /**
   * One funnel block: heading + description, the comparison table, and the per-city small-multiples.
   * @param {string} funnelType  'mapping' | 'contribution'.
   * @param {{steps: string[], cities: object[]}} funnel  The funnel's step keys and per-city rows.
   * @param {{key: string, label: string}[]} segs  Segments to show for the active dimension.
   * @returns {string} The block's HTML.
   */
  #funnelBlock(funnelType, funnel, segs) {
    const meta = AcrossCitiesPage.#FUNNEL_META[funnelType] || { title: funnelType, desc: '' };
    const steps = funnel.steps || [];
    const cities = funnel.cities || [];
    return `
      <div class="ac-funnel-block">
        <h3 class="ac-funnel-block-title">${AcrossCitiesPage.#esc(meta.title)}</h3>
        <p class="ac-note">${AcrossCitiesPage.#esc(meta.desc)}</p>
        <div class="ac-table-wrap">${this.#funnelTableHtml(steps, cities, segs)}</div>
        <div class="ac-funnel-grid">${this.#funnelBarsHtml(steps, cities, segs)}</div>
      </div>`;
  }

  /**
   * The comparison table for one funnel: one row per (city, segment), sorted by overall conversion. Step columns are
   * driven by the funnel's `steps` order; each cell carries the count and (past the first step) its drop-off.
   * @returns {string} The `<table>` HTML.
   */
  #funnelTableHtml(steps, cities, segs) {
    const labels = AcrossCitiesPage.#FUNNEL_STEP_LABELS;
    const multi = segs.length > 1;
    const head = [
      '<tr>',
      '<th class="ac-th-text">City</th>',
      multi ? '<th class="ac-th-text">Group</th>' : '',
      ...steps.map((k) => {
        const l = labels[k] || { full: k, short: k };
        return `<th title="${AcrossCitiesPage.#esc(l.full)}">${AcrossCitiesPage.#esc(l.short)}</th>`;
      }),
      '<th title="Final step as a share of visitors">Overall</th></tr>',
    ].join('');

    const rows = [];
    for (const c of cities) {
      for (const seg of segs) {
        const d = c[seg.key];
        if (d) rows.push({ c, seg, d });
      }
    }
    rows.sort((a, b) => (b.d.overall_conversion || 0) - (a.d.overall_conversion || 0));

    let body;
    if (!rows.length) {
      const span = steps.length + (multi ? 3 : 2);
      body = `<tr><td colspan="${span}" class="dq-empty">No funnel data to show.</td></tr>`;
    } else {
      body = rows.map(({ c, seg, d }) => {
        const stepCells = d.steps.map((v, i) => {
          const title = i === 0
            ? `${this.#num(v)} visitors`
            : `${this.#num(v)} — ${this.#pct(d.step_conversion[i])} of previous step`;
          return `<td class="ac-num" title="${title}">${this.#compact(v)}</td>`;
        }).join('');
        return [
          '<tr>',
          `<td class="ac-td-city">${this.#cityLink(c)}</td>`,
          multi ? `<td>${AcrossCitiesPage.#esc(seg.label)}</td>` : '',
          stepCells,
          `<td class="ac-num">${this.#pct(d.overall_conversion)}</td>`,
          '</tr>',
        ].join('');
      }).join('');
    }
    return `<table class="ps-table ps-table--compact ac-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  /**
   * Per-city small-multiples for one funnel: a horizontal funnel of bars, each normalized to that segment's visitors
   * (= 100%) and labeled with the count and (past the first step) the drop-off. Cities are ordered by overall traffic.
   * @returns {string} The concatenated panel HTML.
   */
  #funnelBarsHtml(steps, cities, segs) {
    if (!cities.length || !steps.length) return '';
    const ordered = cities.slice().sort((a, b) => ((b.all && b.all.steps[0]) || 0) - ((a.all && a.all.steps[0]) || 0));
    return ordered.map((c) => this.#funnelPanel(steps, c, segs)).join('');
  }

  /** Builds one city's funnel panel for the given steps (title, optional legend, and the step bars). */
  #funnelPanel(steps, c, segs) {
    const labels = AcrossCitiesPage.#FUNNEL_STEP_LABELS;
    const palette = AcrossCitiesPage.#FUNNEL_SEG_COLORS;
    const legendItems = segs.map((s, i) =>
      `<span class="ac-funnel-legend-item">`
      + `<span class="ac-funnel-swatch" style="background:${palette[i] || palette[0]}"></span>`
      + `${AcrossCitiesPage.#esc(s.label)}</span>`).join('');
    const legend = segs.length > 1 ? `<div class="ac-funnel-legend">${legendItems}</div>` : '';
    const stepRows = steps.map((k, i) => {
      const full = (labels[k] || { full: k }).full;
      const bars = segs.map((s, si) => {
        const d = c[s.key];
        const v = d ? d.steps[i] : 0;
        const base = d && d.steps[0] > 0 ? d.steps[0] : 0;
        const width = base > 0 ? (v / base) * 100 : 0;
        const conv = d ? d.step_conversion[i] : 0;
        const valText = i === 0 ? this.#compact(v) : `${this.#compact(v)} · ${this.#pct(conv)}`;
        const title = i === 0
          ? `${AcrossCitiesPage.#esc(full)}: ${this.#num(v)} visitors`
          : `${AcrossCitiesPage.#esc(full)}: ${this.#num(v)} — ${this.#pct(conv)} of previous step`;
        return `<div class="ac-funnel-bar" title="${title}">`
          + `<span class="ac-funnel-bar-fill" `
          + `style="width:${width.toFixed(1)}%;background:${palette[si] || palette[0]}"></span>`
          + `<span class="ac-funnel-bar-val">${valText}</span></div>`;
      }).join('');
      return `<div class="ac-funnel-step"><div class="ac-funnel-step-label">${AcrossCitiesPage.#esc(full)}</div>`
        + `<div class="ac-funnel-bars">${bars}</div></div>`;
    }).join('');
    return `<div class="ac-funnel-panel"><div class="ac-funnel-panel-title">${this.#cityLink(c)}</div>`
      + `${legend}${stepRows}</div>`;
  }

  // --- Hover breakdown cards --------------------------------------------------------------------------------------

  /**
   * One "name — value" line of a hover card.
   *
   * @param {string} label - Already-escaped line label.
   * @param {string} value - Already-escaped value, set at the right edge.
   * @param {boolean} [muted=false] - True for the AI and anonymous lines, which qualify the human counts above them.
   * @param {string} [rowKey] - Names this row so a card can emphasize it via its own `data-emph`, which is what lets
   *   the three per-day charts share one built card and each still lean on the line it draws.
   * @returns {string} The line's markup.
   */
  static #tipRow(label, value, muted = false, rowKey = null) {
    const mod = muted ? ' ac-tip-row--ai' : '';
    const key = rowKey ? ` data-tip-row="${rowKey}"` : '';
    return `<div class="ac-tip-row${mod}"${key}><span>${label}</span>`
      + `<span class="ac-tip-num">${value}</span></div>`;
  }

  /**
   * A section heading inside a hover card.
   *
   * @param {string} text - Already-escaped heading text.
   * @returns {string} The heading's markup.
   */
  static #tipHead(text) {
    return `<div class="ac-tip-head">${text}</div>`;
  }

  /**
   * The named-contributor lines of a hover card: one person per line, their labels and validations at the right.
   *
   * Usernames are user-supplied and these cards render as HTML, so every name is escaped here rather than at the call
   * sites — one place to get right. AI accounts keep their line but are marked, so a card that looks like a busy week
   * can't hide that a pipeline produced it.
   *
   * @param {Array<{username: string, kind: string, labels: number, validations: number}>} people - Sorted, busiest
   *   first. Already filtered to nameable accounts by the endpoint.
   * @param {number} limit - How many lines to draw before collapsing the rest into a "+N more" line.
   * @param {number} total - How many contributors the endpoint's list was drawn from before it capped it. The "+N more"
   *   count must come from this and not from `people.length`, which is bounded by that cap and would silently
   *   understate a busy day by an unlimited amount.
   * @returns {string} The lines' markup, empty when nobody qualifies.
   */
  #tipPeople(people, limit, total) {
    if (!people.length) return '';
    const shown = people.slice(0, limit).map((p) => {
      const name = p.username ? AcrossCitiesPage.#esc(p.username) : 'unknown user';
      const tag = p.kind === 'ai' ? '<span class="ac-tip-tag">AI</span>' : '';
      return AcrossCitiesPage.#tipRow(`${name}${tag}`, `${this.#num(p.labels)} · ${this.#num(p.validations)}`);
    }).join('');
    const rest = Math.max(0, (total ?? people.length) - Math.min(limit, people.length));
    return rest > 0 ? `${shown}<div class="ac-tip-more">+ ${this.#num(rest)} more</div>` : shown;
  }

  /**
   * The hover card for one day's bar: the day's whole picture rather than the one number the bar draws — all three
   * volumes, what AI contributed, which cities were busiest, and who was active (#4931).
   *
   * The card body is built once per day and cached: all three charts show the same day the same way, differing only in
   * which line they lean on, and that is a `data-emph` on the card root the CSS keys off — so hovering three charts
   * costs one card, and the three can't drift apart in content.
   *
   * @param {object} d - A `over_time_daily` entry.
   * @param {string} [emphasisKey] - The `over_time_daily` key the hovered chart draws ('labels', 'validations',
   *   'contributors'), whose line the card leans on.
   * @returns {string} The card's markup.
   */
  #dayTipHtml(d, emphasisKey) {
    let card = this.#dayTipCards.get(d.day);
    if (card === undefined) {
      card = this.#buildDayTip(d);
      this.#dayTipCards.set(d.day, card);
    }
    return emphasisKey ? card.replace('data-emph=""', `data-emph="${AcrossCitiesPage.#esc(emphasisKey)}"`) : card;
  }

  /**
   * Builds one day's hover card, with an empty `data-emph` for [[#dayTipHtml]] to fill in per chart.
   *
   * @param {object} d - A `over_time_daily` entry.
   * @returns {string} The card's markup.
   */
  #buildDayTip(d) {
    const title = `<div class="ac-tip-title">${AcrossCitiesPage.#esc(AcrossCitiesPage.#longDate(d.day))}</div>`;
    // A day with no human work can still have plenty to report — the AI pipeline runs on its own schedule — so the
    // quiet case is "nothing at all happened", not "the bar this chart draws is zero".
    const quiet = !d.labels && !d.validations && !d.contributors && !d.anon_sessions
      && !d.ai_labels && !d.ai_validations;
    if (quiet) return `<div class="ac-tip" data-emph="">${title}<div class="ac-tip-more">No activity.</div></div>`;

    let out = title
      + AcrossCitiesPage.#tipRow('Labels', this.#num(d.labels), false, 'labels')
      + AcrossCitiesPage.#tipRow('Validations', this.#num(d.validations), false, 'validations')
      + AcrossCitiesPage.#tipRow('Contributors', this.#num(d.contributors), false, 'contributors');
    if (d.anon_sessions) {
      out += AcrossCitiesPage.#tipRow('Anonymous sessions', this.#num(d.anon_sessions), true);
    }
    if (d.ai_labels) out += AcrossCitiesPage.#tipRow('AI labels', this.#num(d.ai_labels), true);
    if (d.ai_validations) out += AcrossCitiesPage.#tipRow('AI validations', this.#num(d.ai_validations), true);

    const cities = d.top_cities || [];
    if (cities.length) {
      // Cities carry the same "labels · validations" pair as the contributor lines below rather than one combined
      // total: a lone number under a "busiest" heading reads as whichever row above it happens to match that day.
      out += AcrossCitiesPage.#tipHead('Busiest cities (labels · validations)');
      out += cities.map((city) => AcrossCitiesPage.#tipRow(
        AcrossCitiesPage.#esc(city.city_name || city.city_id),
        `${this.#num(city.labels || 0)} · ${this.#num(city.validations || 0)}`,
      )).join('');
    }

    const people = (d.contributor_list || []).map((c) => ({
      username: c.username, kind: c.kind, labels: c.labels || 0, validations: c.validations || 0,
    }));
    if (people.length) {
      out += AcrossCitiesPage.#tipHead('Who was active (labels · validations)');
      out += this.#tipPeople(people, 5, d.contributor_total);
    }
    return `<div class="ac-tip" data-emph="">${out}</div>`;
  }

  /**
   * The hover card for one "Most active cities" cell: both windows' raw counts behind the delta chip, the AI output
   * beside them, and the people the count is made of — ranked by whichever kind of work the column is about (#4931).
   *
   * @param {object} city - The scorecard row, carrying `activity_window`.
   * @param {string} metric - 'activity' | 'labels' | 'validations' | 'contributors'.
   * @returns {string} The card's markup.
   */
  #cityTipHtml(city, metric) {
    const w = city.activity_window || {};
    const { current, prior, ai } = this.#metricCounts(w, metric);
    const heading = { labels: 'labels', validations: 'validations', contributors: 'contributors' }[metric]
      ?? 'labels + validations';
    const title = `${AcrossCitiesPage.#esc(city.city_name || city.city_id)} · ${AcrossCitiesPage.#esc(heading)}`;
    let out = `<div class="ac-tip-title">${title}</div>`;
    out += AcrossCitiesPage.#tipRow('Last 7 days', this.#num(current));
    out += AcrossCitiesPage.#tipRow('7 days before', this.#num(prior));
    if (metric === 'contributors' && w.anon_sessions_7d) {
      out += AcrossCitiesPage.#tipRow('Anonymous sessions', this.#num(w.anon_sessions_7d), true);
    }
    if (ai) {
      out += AcrossCitiesPage.#tipRow(metric === 'contributors' ? 'AI accounts' : 'By AI', this.#num(ai), true);
    }

    // The Labels and Validations columns each rank people by the work that column is about; a top labeler and a top
    // validator are usually different people, and a single "busiest overall" list would bury one of them.
    const all = (w.contributors || []).map((c) => ({
      username: c.username, kind: c.kind, labels: c.labels_7d || 0, validations: c.validations_7d || 0,
    }));
    const rank = { labels: (p) => p.labels, validations: (p) => p.validations }[metric]
      ?? ((p) => p.labels + p.validations);
    // The rows above this list count people only, with AI reported separately, so the list has to be on that basis too.
    // Ranked together, one pipeline account sorts above every person and reads as the top contributor to a number it is
    // explicitly excluded from — so AI lines sit after the people, not among them.
    const ranked = all.filter((p) => rank(p) > 0).sort((a, b) => rank(b) - rank(a));
    const people = ranked.filter((p) => p.kind !== 'ai');
    const agents = ranked.filter((p) => p.kind === 'ai');
    if (people.length || agents.length) {
      const head = { labels: 'Top labelers', validations: 'Top validators' }[metric] ?? 'Contributors';
      out += AcrossCitiesPage.#tipHead(`${head} (labels · validations)`);
      // `contributor_total` counts AI alongside people, so discount the agents listed below to keep "+N more" about
      // the people this list is ranking.
      const peopleTotal = Math.max(people.length, (w.contributor_total ?? people.length) - agents.length);
      out += this.#tipPeople(people, 5, peopleTotal);
      out += this.#tipPeople(agents, agents.length, agents.length);
    }
    return `<div class="ac-tip">${out}</div>`;
  }

  // --- Shared cell builders ---------------------------------------------------------------------------------------

  #cityLink(c) {
    const name = AcrossCitiesPage.#esc(c.city_name || c.city_id);
    return c.url ? `<a href="${AcrossCitiesPage.#esc(c.url)}" target="_blank" rel="noopener">${name}</a>` : name;
  }

  #coverageBar(coverage) {
    const pct = Math.round((coverage || 0) * 100);
    return `<div class="ac-bar" title="${pct}% audited">`
      + `<span class="ac-bar-fill" style="width:${pct}%"></span>`
      + `<span class="ac-bar-label">${pct}%</span></div>`;
  }

  /** A tiny inline-SVG sparkline for a row cell (no axes/labels). */
  #sparkline(values) {
    if (!values || !values.length) return '';
    const W = 90;
    const H = 22;
    const pad = 2;
    const max = Math.max(1, ...values);
    const n = values.length;
    const x = (i) => pad + (n === 1 ? (W - 2 * pad) / 2 : (i / (n - 1)) * (W - 2 * pad));
    const y = (v) => pad + (1 - v / max) * (H - 2 * pad);
    const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<svg class="ac-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">`
      + `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  }

  /** Canonical label-type color via the shared helper, with a gray fallback. */
  #color(labelType) {
    try {
      if (window.util && util.misc && util.misc.getLabelColors) {
        const c = util.misc.getLabelColors(labelType);
        if (c) return c;
      }
    } catch { /* fall through to default */ }
    return '#b3b3b3';
  }

  // --- Helpers ----------------------------------------------------------------------------------------------------

  #setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  #setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  /** Full number with thousands separators ("1,234,567"). */
  #num(n) {
    return (n ?? 0).toLocaleString();
  }

  /** Compact number ("1.2M", "317k", "842"). */
  #compact(n) {
    const v = n ?? 0;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
    return v.toLocaleString();
  }

  /** Kilometers with one decimal under 100, else whole ("0.4", "12.7", "1,240"). */
  #km(n) {
    const v = n ?? 0;
    return v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString();
  }

  /** Percentage with no decimals ("47%"). */
  #pct(fraction) {
    return `${Math.round((fraction || 0) * 100)}%`;
  }

  /** Human duration from seconds ("8s", "2.4 min", "1.3 h"). */
  #duration(seconds) {
    const s = seconds || 0;
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${(s / 60).toFixed(1)} min`;
    return `${(s / 3600).toFixed(1)} h`;
  }

  static #esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
  }

  /** "Jun 9"-style short date from an ISO date string. */
  static #shortDate(iso) {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /** "Jun '19"-style month + year from an ISO date string, for multi-year x-axes. */
  static #shortDateYear(iso) {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso;
    return `${d.toLocaleDateString(undefined, { month: 'short' })} '${String(d.getFullYear()).slice(-2)}`;
  }

  /** "Thu, Jun 9"-style weekday + date from an ISO date string, for hover cards that have room to be unambiguous. */
  static #longDate(iso) {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /** "Thu"-style short weekday from an ISO date string. */
  static #weekday(iso) {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }
}
