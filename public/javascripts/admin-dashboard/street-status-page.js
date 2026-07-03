/**
 * Coordinator for the admin Street Status page (#4331). Fetches every street once from the v3 streets API as GeoJSON,
 * then drives the per-segment status map (StreetStatusMap) and the per-region breakdown table (StreetStatusTable) from
 * a single selection state. A single pass over the features builds both the per-region status counts (for the table +
 * KPIs) and a region → segment-id index (so a region selection in the table can brush all of that region's segments on
 * the map, and vice-versa). Selection mirrors the Coverage page: hovering brushes transiently, clicking pins (click
 * again to unpin), and the effective highlight is the hovered region if any, else the pinned region.
 */
class StreetStatusPage {
    #mapboxToken;
    #streetsUrl;
    #map;
    #table = null;

    #rows = [];                      // Per-region aggregation rows, in API order.
    #segmentsByRegion = new Map();   // region_id -> number[] of street_edge_ids.

    #pinnedIds = [];
    #hoverIds = null; // null = no active hover.

    /**
     * @param {{mapboxToken: string, streetsUrl: string}} opts - Mapbox access token and the v3 streets endpoint URL,
     *   both injected from the Twirl template so the JS has no server-config coupling.
     */
    constructor(opts = {}) {
        this.#mapboxToken = opts.mapboxToken;
        this.#streetsUrl = opts.streetsUrl;
    }

    async init() {
        try {
            const geojson = await this.#fetchStreets(this.#streetsUrl);
            const features = geojson.features || [];

            if (features.length === 0) {
                this.#setStatus('No street data available for this city yet.', false);
                return;
            }

            this.#aggregate(features);
            this.#renderKpis();
            this.#renderLegend();

            this.#map = new StreetStatusMap('street-status-choropleth', {
                mapboxToken: this.#mapboxToken,
                onRegionClick: (id) => this.#pin([id]),
                onRegionHover: (id) => this.#hover([id]),
                onRegionHoverEnd: () => this.#hoverEnd(),
            });
            await this.#map.init(geojson);

            this.#table = new StreetStatusTable('street-status-table', 'street-status-table-search', {
                onRowClick: (id) => this.#pin([id]),
                onRowHover: (id) => this.#hover([id]),
                onRowHoverEnd: () => this.#hoverEnd(),
            });
            this.#table.render(this.#rows);

            this.#setStatus('', false, true);
        } catch (err) {
            console.error('Street status page failed to load:', err);
            this.#setStatus('Could not load street data. Please try again.', true);
        }
    }

    async #fetchStreets(url) {
        const resp = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!resp.ok) throw new Error(`Streets request failed: ${resp.status}`);
        return resp.json();
    }

    /**
     * Single pass over the GeoJSON features building both outputs the page needs: per-region status counts (table +
     * KPIs) and a region → segment-id index (map↔table highlight sync). Only statuses actually present are counted, so
     * a city missing a status still renders cleanly.
     */
    #aggregate(features) {
        const byRegion = new Map();
        for (const f of features) {
            const p = f.properties;
            const regionId = Number(p.region_id);
            let row = byRegion.get(regionId);
            if (!row) {
                row = { region_id: regionId, name: p.region_name, open: 0, no_imagery: 0, closed: 0, disabled: 0, total: 0 };
                byRegion.set(regionId, row);
                this.#segmentsByRegion.set(regionId, []);
            }
            if (row[p.status] !== undefined) row[p.status] += 1;
            row.total += 1;
            this.#segmentsByRegion.get(regionId).push(Number(p.street_edge_id));
        }
        this.#rows = Array.from(byRegion.values());
    }

    /** Click handler: toggles the pinned set (clicking the same selection again clears it). */
    #pin(ids) {
        this.#pinnedIds = StreetStatusPage.#sameSet(this.#pinnedIds, ids) ? [] : ids;
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

    /** Applies the effective highlight (hovered region, else pinned region, else none) to the map and the table. */
    #applyHighlight() {
        const regionIds = this.#hoverIds !== null ? this.#hoverIds : this.#pinnedIds;
        if (regionIds.length === 0) {
            this.#map.clearHighlight();
            this.#table?.clearHighlight();
            return;
        }
        const segmentIds = regionIds.flatMap((id) => this.#segmentsByRegion.get(Number(id)) || []);
        this.#map.highlightSegments(segmentIds);
        this.#table?.highlightRows(regionIds);
    }

    #renderKpis() {
        const totals = { open: 0, no_imagery: 0, closed: 0, disabled: 0, total: 0 };
        for (const r of this.#rows) {
            totals.open += r.open; totals.no_imagery += r.no_imagery;
            totals.closed += r.closed; totals.disabled += r.disabled; totals.total += r.total;
        }
        const pct = (n) => `${Math.round((totals.total ? n / totals.total : 0) * 100)}%`;
        document.getElementById('kpi-total-streets').textContent = totals.total.toLocaleString();
        document.getElementById('kpi-no-imagery').textContent = pct(totals.no_imagery);
        document.getElementById('kpi-disabled').textContent = pct(totals.disabled);
        document.getElementById('kpi-closed').textContent = pct(totals.closed);
    }

    /** Renders the categorical legend: one swatch + label per status, from the shared palette. */
    #renderLegend() {
        document.getElementById('street-status-legend').innerHTML = StreetStatusColors.STATUSES.map((s) =>
            `<span class="street-status-legend-item"><span class="street-status-swatch" `
            + `style="background:${s.color}" aria-hidden="true"></span>${s.label}</span>`,
        ).join('');
    }

    /** Updates the status line; pass hide=true to remove it once data has loaded. */
    #setStatus(message, isError, hide = false) {
        const status = document.getElementById('street-status-status');
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
