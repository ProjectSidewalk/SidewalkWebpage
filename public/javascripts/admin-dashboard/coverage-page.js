/**
 * Coordinator for the admin Coverage page (#4272). Fetches region coverage once from the v3 regions API, then drives
 * two coordinated views — the choropleth (CoverageMap) and the bar chart (CoverageBars) — from a single selection
 * state. Hovering a region in either view transiently brushes the match in the other; clicking pins it (click again
 * to unpin). The effective highlight is the hovered region if any, otherwise the pinned one, so a transient hover
 * never destroys a pinned selection. One fetch, one source of truth, so the views never diverge.
 */
class CoveragePage {
    #mapboxToken;
    #regionsUrl;
    #map;
    #bars;
    #pinnedId = null;
    #hoverId = null;

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

            const barData = features.map(f => ({
                region_id: Number(f.properties.region_id),
                name: f.properties.name,
                completion_rate: f.properties.completion_rate,
                audited_distance_m: f.properties.audited_distance_m,
                total_distance_m: f.properties.total_distance_m,
                street_count: f.properties.street_count,
                audit_count: f.properties.audit_count,
                label_count: f.properties.label_count,
                user_count: f.properties.user_count,
                color: CoverageColors.forRate(f.properties.completion_rate)
            }));

            this.#map = new CoverageMap('coverage-choropleth', {
                mapboxToken: this.#mapboxToken,
                onRegionClick: id => this.#pin(id),
                onRegionHover: id => this.#hover(id),
                onRegionHoverEnd: () => this.#hoverEnd()
            });
            this.#bars = new CoverageBars('coverage-bars', {
                onBarClick: id => this.#pin(id),
                onBarHover: id => this.#hover(id),
                onBarHoverEnd: () => this.#hoverEnd()
            });

            await Promise.all([this.#map.init(geojson), this.#bars.render(barData)]);
            this.#wireSortButtons();
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

    /** Click handler: toggles the pinned region (click the pinned one again to unpin). */
    #pin(regionId) {
        this.#pinnedId = this.#pinnedId === regionId ? null : regionId;
        this.#applyHighlight();
    }

    /** Hover handler: transiently brushes a region without disturbing the pinned selection. */
    #hover(regionId) {
        this.#hoverId = regionId;
        this.#applyHighlight();
    }

    /** Hover-end handler: drops the transient brush, reverting to the pinned selection (if any). */
    #hoverEnd() {
        this.#hoverId = null;
        this.#applyHighlight();
    }

    /** Applies the effective highlight (hovered region, else pinned region, else none) to both views. */
    #applyHighlight() {
        const id = this.#hoverId ?? this.#pinnedId;
        if (id == null) {
            this.#map.clearHighlight();
            this.#bars.clearHighlight();
        } else {
            this.#map.highlightRegion(id);
            this.#bars.highlightBar(id);
        }
    }

    /** Wires the Coverage/Name sort toggle; re-rendering the chart and re-applying the current highlight. */
    #wireSortButtons() {
        const buttons = document.querySelectorAll('.coverage-sort-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', async () => {
                if (btn.classList.contains('active')) return;
                buttons.forEach(b => {
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
        const fullyAudited = features.filter(f => (f.properties.completion_rate || 0) >= 0.999).length;

        document.getElementById('kpi-city-coverage').textContent = CoverageFormat.pct(totalM ? auditedM / totalM : 0);
        document.getElementById('kpi-regions').textContent = features.length.toLocaleString();
        document.getElementById('kpi-fully-audited').textContent = fullyAudited.toLocaleString();
    }

    #renderLegend() {
        const legend = document.getElementById('coverage-legend');
        legend.innerHTML =
            '<span>0%</span><span class="coverage-legend-gradient" aria-hidden="true"></span><span>100%</span>' +
            '<span>audit coverage</span>';
    }

    /** Updates the status line; pass hide=true to remove it once data has loaded. */
    #setStatus(message, isError, hide = false) {
        const status = document.getElementById('coverage-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('error', !!isError);
        status.classList.toggle('hidden', hide);
    }
}
