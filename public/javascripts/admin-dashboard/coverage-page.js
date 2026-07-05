/**
 * Coordinator for the admin Coverage page (#4272). Fetches region coverage once from the v3 regions API, then drives
 * the choropleth (CoverageMap) plus one of two secondary views from a single selection state:
 *   - "bars": per-region bars (CoverageBars), best for small deployments.
 *   - "distribution": a coverage histogram (CoverageHistogram) + a searchable/sortable region table (CoverageTable),
 *     which scale to large deployments (e.g. Seattle/Amsterdam, ~80-100+ regions).
 * The default view is chosen by region count, but the user can switch. Selection is uniform across views: hovering an
 * item transiently brushes the matching region(s) in the others; clicking pins them (click again to unpin). The
 * effective highlight is the hovered set if any, else the pinned set, so a transient hover never drops a pin. Range
 * brushing falls out naturally — a histogram bucket selects every region in that coverage range at once.
 */
class CoveragePage {
  /** Above this many regions, default to the distribution view (per-region bars become an unreadable wall). */
  static #BARS_THRESHOLD = 40;
  /** Number of coverage buckets for the distribution histogram. */
  static #NUM_BUCKETS = 10;

  #mapboxToken;
  #regionsUrl;
  #map;
  #bars = null;
  #histogram = null;
  #table = null;
  #mode = 'bars';

  #barData = [];
  #buckets = [];
  #bucketRegionIds = [];
  #tableRows = [];

  #pinnedIds = [];
  #hoverIds = null; // null = no active hover.

  /**
   * @param {{mapboxToken: string, regionsUrl: string}} opts - Mapbox access token and the v3 regions endpoint URL,
   *   both injected from the Twirl template so the JS has no server-config coupling.
   */
  constructor(opts = {}) {
    this.#mapboxToken = opts.mapboxToken;
    this.#regionsUrl = opts.regionsUrl;
  }

  async init() {
    try {
      const geojson = await this.#fetchRegions(this.#regionsUrl);
      const features = geojson.features || [];

      if (features.length === 0) {
        this.#setStatus('No region data available for this city yet.', false);
        return;
      }

      this.#renderKpis(features);
      this.#renderLegend();
      this.#prepareData(features);

      this.#map = new CoverageMap('coverage-choropleth', {
        mapboxToken: this.#mapboxToken,
        onRegionClick: (id) => this.#pin([id]),
        onRegionHover: (id) => this.#hover([id]),
        onRegionHoverEnd: () => this.#hoverEnd(),
      });
      await this.#map.init(geojson);

      this.#mode = features.length <= CoveragePage.#BARS_THRESHOLD ? 'bars' : 'distribution';
      this.#wireViewToggle();
      await this.#activateMode(this.#mode);

      this.#setStatus('', false, true);
    } catch (err) {
      console.error('Coverage page failed to load:', err);
      this.#setStatus('Could not load coverage data. Please try again.', true);
    }
  }

  async #fetchRegions(url) {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`Regions request failed: ${resp.status}`);
    return resp.json();
  }

  /** Precomputes the data each secondary view needs: per-region bar rows, coverage buckets, and table rows. */
  #prepareData(features) {
    this.#barData = features.map((f) => ({
      region_id: Number(f.properties.region_id),
      name: f.properties.name,
      completion_rate: f.properties.completion_rate,
      audited_distance_m: f.properties.audited_distance_m,
      total_distance_m: f.properties.total_distance_m,
      street_count: f.properties.street_count,
      audit_count: f.properties.audit_count,
      label_count: f.properties.label_count,
      user_count: f.properties.user_count,
      color: CoverageColors.forRate(f.properties.completion_rate),
    }));
    this.#tableRows = this.#barData; // Same per-region rows; the table formats them itself.

    const nb = CoveragePage.#NUM_BUCKETS;
    this.#bucketRegionIds = Array.from({ length: nb }, () => []);
    for (const f of features) {
      const rate = f.properties.completion_rate || 0;
      const idx = Math.min(Math.floor(rate * nb), nb - 1);
      this.#bucketRegionIds[idx].push(Number(f.properties.region_id));
    }
    this.#buckets = this.#bucketRegionIds.map((ids, idx) => ({
      index: idx,
      label: `${idx * (100 / nb)}–${(idx + 1) * (100 / nb)}%`,
      count: ids.length,
      color: CoverageColors.forRate((idx + 0.5) / nb),
    }));
  }

  /** Shows the chosen view (lazily creating its components) and hides the other. */
  async #activateMode(mode) {
    this.#mode = mode;
    const barsView = document.getElementById('coverage-bars-view');
    const distView = document.getElementById('coverage-distribution-view');
    barsView.hidden = mode !== 'bars';
    distView.hidden = mode !== 'distribution';

    document.querySelectorAll('.coverage-toggle-btn').forEach((b) => {
      const active = b.dataset.view === mode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });

    if (mode === 'bars' && !this.#bars) {
      this.#bars = new CoverageBars('coverage-bars', {
        onBarClick: (id) => this.#pin([id]),
        onBarHover: (id) => this.#hover([id]),
        onBarHoverEnd: () => this.#hoverEnd(),
      });
      await this.#bars.render(this.#barData);
      this.#wireSortButtons();
    } else if (mode === 'distribution') {
      if (!this.#histogram) {
        this.#histogram = new CoverageHistogram('coverage-histogram', {
          onBinClick: (idx) => this.#pin(this.#bucketRegionIds[idx]),
          onBinHover: (idx) => this.#hover(this.#bucketRegionIds[idx]),
          onBinHoverEnd: () => this.#hoverEnd(),
        });
        await this.#histogram.render(this.#buckets);
      }
      if (!this.#table) {
        this.#table = new CoverageTable('coverage-table', 'coverage-table-search', {
          onRowClick: (id) => this.#pin([id]),
          onRowHover: (id) => this.#hover([id]),
          onRowHoverEnd: () => this.#hoverEnd(),
        });
        this.#table.render(this.#tableRows);
      }
    }

    // Selection semantics differ across views; reset it on switch to avoid a stale, half-applied highlight.
    this.#pinnedIds = [];
    this.#hoverIds = null;
    this.#applyHighlight();
  }

  /** Click handler: toggles the pinned set (clicking the same selection again clears it). */
  #pin(ids) {
    this.#pinnedIds = CoveragePage.#sameSet(this.#pinnedIds, ids) ? [] : ids;
    this.#applyHighlight();
  }

  /** Hover handler: transiently brushes a set without disturbing the pinned selection. */
  #hover(ids) {
    this.#hoverIds = ids;
    this.#applyHighlight();
  }

  /** Hover-end handler: drops the transient brush, reverting to the pinned selection (if any). */
  #hoverEnd() {
    this.#hoverIds = null;
    this.#applyHighlight();
  }

  /** Applies the effective highlight (hovered set, else pinned set, else none) to the map and the active view. */
  #applyHighlight() {
    const ids = this.#hoverIds !== null ? this.#hoverIds : this.#pinnedIds;
    if (ids.length === 0) {
      this.#map.clearHighlight();
      this.#bars?.clearHighlight();
      this.#table?.clearHighlight();
      return;
    }
    this.#map.highlightRegions(ids);
    if (this.#mode === 'bars') this.#bars?.highlightBars(ids);
    if (this.#mode === 'distribution') this.#table?.highlightRows(ids);
  }

  /** Wires the Per-region / Distribution view toggle. */
  #wireViewToggle() {
    document.querySelectorAll('.coverage-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.view !== this.#mode) this.#activateMode(btn.dataset.view);
      });
    });
  }

  /** Wires the Coverage/Name sort toggle for the per-region bars; re-renders and restores the highlight. */
  #wireSortButtons() {
    const buttons = document.querySelectorAll('.coverage-sort-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.classList.contains('active')) return;
        buttons.forEach((b) => {
          const isTarget = b === btn;
          b.classList.toggle('active', isTarget);
          b.setAttribute('aria-pressed', String(isTarget));
        });
        await this.#bars.setSort(btn.dataset.sort);
        this.#applyHighlight(); // Re-embedding resets the bar signal, so restore the current highlight.
      });
    });
  }

  #renderKpis(features) {
    const totalM = features.reduce((s, f) => s + (f.properties.total_distance_m || 0), 0);
    const auditedM = features.reduce((s, f) => s + (f.properties.audited_distance_m || 0), 0);
    const fullyAudited = features.filter((f) => (f.properties.completion_rate || 0) >= 0.999).length;

    document.getElementById('kpi-city-coverage').textContent = CoverageFormat.pct(totalM ? auditedM / totalM : 0);
    document.getElementById('kpi-regions').textContent = features.length.toLocaleString();
    document.getElementById('kpi-fully-audited').textContent = fullyAudited.toLocaleString();
  }

  #renderLegend() {
    document.getElementById('coverage-legend').innerHTML = `
            <span>0%</span><span class="coverage-legend-gradient" aria-hidden="true"></span><span>100%</span>
            <span>audit coverage</span>`;
  }

  /** Updates the status line; pass hide=true to remove it once data has loaded. */
  #setStatus(message, isError, hide = false) {
    const status = document.getElementById('coverage-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', !!isError);
    status.classList.toggle('hidden', hide);
  }

  /** True if two id lists contain the same set of ids (order-independent). */
  static #sameSet(a, b) {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    return b.every((id) => set.has(id));
  }
}
