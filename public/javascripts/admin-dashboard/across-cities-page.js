/**
 * Renders the admin "Across Cities" page (#4329): a cross-deployment overview of every Project Sidewalk city across
 * four lenses — coverage (how much is left), activity (what's happening and when), data patterns (the label-type mix,
 * city vs city), and data quality (how trustworthy the data is). Adds a "needs attention" panel from server-computed
 * anomaly flags and three overview line charts (labels / validations / active users per week, summed across cities).
 *
 * Plain HTML/CSS plus the shared MiniLineChart for the over-time charts and small inline-SVG sparklines for the
 * per-city activity trend. Owner-only; driven entirely from /adminapi/cityScorecards.
 */
class AcrossCitiesPage {

    /** Human-friendly label + severity for each data-quality anomaly flag key the endpoint can emit. */
    static #ANOMALY = {
        high_disagreement: { label: 'High disagreement', sev: 'warn' }
    };

    /**
     * Lifecycle/health states (#4329): label, badge tone, and whether the state warrants attention. `tone` maps to a
     * `.ac-badge--<tone>` CSS class. Ordered active → wrapped_up → stalled → low_traction for the Status sort.
     */
    static #LIFECYCLE = {
        active:       { label: 'Active',       tone: 'ok',    rank: 0, attention: false },
        wrapped_up:   { label: 'Wrapped up',   tone: 'good',  rank: 1, attention: false },
        stalled:      { label: 'Stalled',      tone: 'warn',  rank: 2, attention: true },
        low_traction: { label: 'Low traction', tone: 'bad',   rank: 3, attention: true }
    };

    /** Canonical label-type order + short display names for the data-patterns bars. */
    static #LABEL_TYPES = [
        ['CurbRamp', 'Curb ramp'], ['NoCurbRamp', 'Missing curb ramp'], ['Obstacle', 'Obstacle'],
        ['SurfaceProblem', 'Surface problem'], ['NoSidewalk', 'No sidewalk'], ['Crosswalk', 'Crosswalk'],
        ['Signal', 'Signal'], ['Occlusion', 'Occlusion'], ['Other', 'Other']
    ];

    /** Lifecycle → map circle color (matches the badge tones). */
    static #LIFECYCLE_COLOR = {
        active: '#4a90d9', wrapped_up: '#1f7a4d', stalled: '#e0a800', low_traction: '#c0392b'
    };

    #scorecardsUrl;
    #citiesUrl;
    #mapboxToken;
    #map = null;           // Mapbox map instance for the deployment-cities map.
    #cities = [];          // The latest scorecard rows, as returned by the endpoint.
    #summary = {};         // The summary block (thresholds + cross-city median + hero totals).
    #allTimeTrend = [];    // Cross-city weekly series for the full project history (the "All time" toggle).
    #trendSeries = {};     // { recent: [...], all: [...] } weekly aggregates for the over-time charts.
    #trendRange = 'recent';// Which over-time range is shown: 'recent' (12 wks) | 'all'.
    #sortKey = 'coverage'; // Current sort column.
    #sortDir = 'desc';     // 'asc' | 'desc'.

    /** @param {{scorecardsUrl: string, citiesUrl?: string, mapboxToken?: string}} opts */
    constructor(opts = {}) {
        this.#scorecardsUrl = opts.scorecardsUrl;
        this.#citiesUrl = opts.citiesUrl;
        this.#mapboxToken = opts.mapboxToken;
    }

    async init() {
        try {
            // Scorecards are required; the cities geo (for the map) is an enhancement, so it degrades gracefully.
            const [data, citiesGeo] = await Promise.all([
                this.#fetchJson(this.#scorecardsUrl),
                this.#citiesUrl ? this.#fetchJson(this.#citiesUrl).catch(() => null) : Promise.resolve(null)
            ]);
            this.#cities = (data && data.cities) || [];
            this.#summary = (data && data.summary) || {};
            this.#allTimeTrend = (data && data.over_time_all_time) || [];
            this.#renderHero();
            this.#renderMap(citiesGeo);
            this.#renderPulse();
            this.#renderAttention();
            this.#renderTrends();
            this.#wireSorting();
            this.#renderTable();
            this.#renderCoverage();
            this.#renderActivity();
            this.#renderEffort();
            this.#renderPatterns();
            this.#renderQuality();
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
        const parts = order.filter(k => counts[k]).map(k =>
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

        const byId = new Map(this.#cities.map(c => [c.city_id, c]));
        const features = [];
        let maxLabels = 1;
        for (const geo of citiesGeo.cities) {
            if (geo.center_lat == null || geo.center_lng == null) continue;
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
                    popup: this.#mapPopupHtml(geo, sc)
                }
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
            projection: 'mercator'
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
                    'circle-stroke-color': ['case', ['==', ['get', 'visibility'], 'public'], '#ffffff', '#33373a']
                }
            });
            const showPopup = e => {
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
            this.#map.on('click', 'ac-cities-circles', e => {
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
            ['Last activity', sc.last_activity ? AcrossCitiesPage.#relativeTime(sc.last_activity) : 'never']
        ].map(([k, v]) => `<tr><td>${k}</td><td>${AcrossCitiesPage.#esc(v)}</td></tr>`).join('');
        return `<div class="coverage-popup-name">${name}</div>` +
            `<table class="coverage-popup-dl">${rows}</table>`;
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
        el.innerHTML = items.map(it => {
            const name = AcrossCitiesPage.#esc(it.city.city_name || it.city.city_id);
            const href = it.city.url ? AcrossCitiesPage.#esc(it.city.url) : '#';
            return `<a class="ov-attention-item ov-attention--${it.sev === 'bad' ? 'warn' : it.sev}" href="${href}"` +
                (it.city.url ? ' target="_blank" rel="noopener"' : '') + '>' +
                '<span class="ov-attention-dot" aria-hidden="true"></span>' +
                `<span class="ov-attention-text"><strong>${name}</strong> — ${AcrossCitiesPage.#esc(it.reason)}</span>` +
                `<span class="ov-attention-go">${AcrossCitiesPage.#esc(it.label)} →</span>` +
                '</a>';
        }).join('');
    }

    /** Explanation for a lifecycle state that needs attention, using the city's own numbers. */
    #lifecycleReason(c) {
        const quiet = c.days_since_activity == null ? 'no recorded activity'
            : `quiet for ${c.days_since_activity} days`;
        if (c.lifecycle === 'low_traction') {
            return `never took off — ${quiet}, ${this.#pct(c.coverage)} coverage, ` +
                `${this.#num(c.active_contributors)} contributors`;
        }
        // Stalled: had a community, lost momentum before finishing.
        return `stalled at ${this.#pct(c.coverage)} coverage — ${quiet} ` +
            `(${this.#num(c.active_contributors)} contributors)`;
    }

    /** Human-readable explanation for one data-quality anomaly flag on one city, using the city's own numbers. */
    #anomalyReason(flag, c) {
        switch (flag) {
            case 'high_disagreement':
                return `${this.#pct(c.validation_disagreement_rate)} of human validations disagree ` +
                    `(median ${this.#pct(this.#summary.median_disagreement_rate)})`;
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
     * server-aggregated series), wires the range toggle, and draws the current range.
     */
    #renderTrends() {
        this.#trendSeries = {
            recent: this.#aggregateWeekly(this.#cities.flatMap(c => c.weekly_trend || [])),
            all: this.#allTimeTrend.slice()
        };

        const toggle = document.getElementById('ac-trend-toggle');
        if (toggle) {
            toggle.querySelectorAll('.ac-toggle-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.#trendRange = btn.dataset.range;
                    toggle.querySelectorAll('.ac-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
                    this.#drawTrends();
                });
            });
        }
        this.#drawTrends();
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
        const cats = series.map(w => AcrossCitiesPage.#shortDate(w.week_start));
        // Small dots on the short (12-week) view where they aid hover tooltips; none on the dense all-time view, where
        // hundreds of points would just be noise.
        const dotRadius = series.length > 30 ? 0 : 2;
        const draw = (id, key, name, values) => {
            const host = document.getElementById(id);
            if (host) MiniLineChart.renderInto(host, cats, [{ name, key, values }], { ariaLabel: name, dotRadius });
        };
        draw('ac-chart-labels', 'aclabels', 'Labels', series.map(w => w.labels));
        draw('ac-chart-validations', 'acvals', 'Validations', series.map(w => w.validations));
        draw('ac-chart-users', 'acusers', 'Active users', series.map(w => w.active_users));
    }

    // --- Scorecard table --------------------------------------------------------------------------------------------

    #wireSorting() {
        const ths = document.querySelectorAll('#ac-table thead th[data-sort]');
        ths.forEach(th => {
            th.addEventListener('click', () => {
                const key = th.getAttribute('data-sort');
                if (this.#sortKey === key) {
                    this.#sortDir = this.#sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    this.#sortKey = key;
                    this.#sortDir = key === 'city_name' ? 'asc' : 'desc';
                }
                this.#renderTable();
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
        const rows = this.#sortedCities(this.#sortKey, this.#sortDir);
        tbody.innerHTML = rows.map(c => {
            const lc = AcrossCitiesPage.#LIFECYCLE[c.lifecycle];
            const needsAttention = (lc && lc.attention) || (c.anomalies || []).length > 0;
            const chips = (c.anomalies || []).map(f => {
                const meta = AcrossCitiesPage.#ANOMALY[f] || { label: f, sev: 'info' };
                return `<span class="ac-chip ac-chip--${meta.sev}">${AcrossCitiesPage.#esc(meta.label)}</span>`;
            }).join('');
            const lastActivity = c.last_activity
                ? AcrossCitiesPage.#esc(AcrossCitiesPage.#relativeTime(c.last_activity))
                : '<span class="ac-muted">never</span>';
            return `<tr class="${needsAttention ? 'ac-row--flagged' : ''}">` +
                `<td class="ac-td-city">${this.#cityLink(c)}${chips ? ` <span class="ac-chips">${chips}</span>` : ''}</td>` +
                `<td>${this.#lifecycleBadge(c.lifecycle)}</td>` +
                `<td>${this.#coverageBar(c.coverage)}</td>` +
                `<td class="ac-num" title="${this.#num(c.total_labels)}">${this.#compact(c.total_labels)}</td>` +
                `<td class="ac-num" title="${this.#num(c.total_validations)}">${this.#compact(c.total_validations)}</td>` +
                `<td class="ac-num" title="${this.#num(c.active_contributors)}">${this.#compact(c.active_contributors)}</td>` +
                `<td class="ac-num">${this.#pct(c.ai_label_share)}</td>` +
                `<td class="ac-num">${lastActivity}</td>` +
                '</tr>';
        }).join('');
        this.#markSortedHeader();
        this.#setText('ac-status', `${rows.length} ${rows.length === 1 ? 'city' : 'cities'}.`);
    }

    #sortedCities(key, dirStr) {
        const dir = dirStr === 'asc' ? 1 : -1;
        const val = c => {
            if (key === 'city_name') return (c.city_name || c.city_id || '').toLowerCase();
            if (key === 'lifecycle') {
                const lc = AcrossCitiesPage.#LIFECYCLE[c.lifecycle];
                return lc ? lc.rank : 99;
            }
            if (key === 'days_since_activity') return c.days_since_activity == null ? Number.MAX_SAFE_INTEGER : c.days_since_activity;
            return c[key] == null ? 0 : c[key];
        };
        return this.#cities.slice().sort((a, b) => {
            const va = val(a), vb = val(b);
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
        });
    }

    #markSortedHeader() {
        document.querySelectorAll('#ac-table thead th[data-sort]').forEach(th => {
            const key = th.getAttribute('data-sort');
            th.classList.toggle('ac-sorted', key === this.#sortKey);
            if (key === this.#sortKey) {
                th.setAttribute('aria-sort', this.#sortDir === 'asc' ? 'ascending' : 'descending');
                th.dataset.dir = this.#sortDir;
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
        tbody.innerHTML = rows.map(c =>
            `<tr class="${(c.lifecycle === 'stalled' || c.lifecycle === 'low_traction') ? 'ac-row--flagged' : ''}">` +
            `<td class="ac-td-city">${this.#cityLink(c)}</td>` +
            `<td>${this.#coverageBar(c.coverage)}</td>` +
            `<td class="ac-num" title="${this.#num(c.audited_streets)} of ${this.#num(c.total_streets)}">` +
                `${this.#compact(c.audited_streets)} / ${this.#compact(c.total_streets)}</td>` +
            `<td class="ac-num" title="${this.#num(c.streets_remaining)}">${this.#compact(c.streets_remaining)}</td>` +
            `<td class="ac-num">${this.#km(c.audited_km)} / ${this.#km(c.total_km)}</td>` +
            `<td class="ac-num">${this.#km(c.km_remaining)}</td>` +
            '</tr>'
        ).join('');
    }

    // --- Activity section -------------------------------------------------------------------------------------------

    #renderActivity() {
        const tbody = document.getElementById('ac-activity-tbody');
        if (!tbody) return;
        // Sort by most-recent activity (freshest first; never-active last).
        const rows = this.#sortedCities('days_since_activity', 'asc');
        tbody.innerHTML = rows.map(c => {
            const last = c.last_activity
                ? AcrossCitiesPage.#esc(AcrossCitiesPage.#relativeTime(c.last_activity))
                : '<span class="ac-muted">never</span>';
            const spark = this.#sparkline((c.weekly_trend || []).map(w => w.labels || 0));
            const flagged = c.lifecycle === 'stalled' || c.lifecycle === 'low_traction';
            return `<tr class="${flagged ? 'ac-row--flagged' : ''}">` +
                `<td class="ac-td-city">${this.#cityLink(c)}</td>` +
                `<td class="ac-num">${this.#num(c.labels_7d)} / ${this.#num(c.labels_30d)}</td>` +
                `<td class="ac-num">${this.#num(c.validations_7d)} / ${this.#num(c.validations_30d)}</td>` +
                `<td class="ac-num">${this.#num(c.audits_7d)} / ${this.#num(c.audits_30d)}</td>` +
                `<td class="ac-num">${last}</td>` +
                `<td class="ac-spark-cell">${spark}</td>` +
                '</tr>';
        }).join('');
    }

    // --- Contributors & effort section ------------------------------------------------------------------------------

    #renderEffort() {
        const tbody = document.getElementById('ac-effort-tbody');
        if (!tbody) return;
        const rows = this.#cities.slice().sort((a, b) => (b.num_labelers || 0) - (a.num_labelers || 0));
        tbody.innerHTML = rows.map(c => {
            const out = (med, p90) => `${this.#num(Math.round(med || 0))} <span class="ac-muted">· ${this.#num(Math.round(p90 || 0))}</span>`;
            const v10 = c.seconds_to_validate_10 > 0
                ? this.#duration(c.seconds_to_validate_10) : '<span class="ac-muted">—</span>';
            const l100 = c.seconds_per_100m != null
                ? this.#duration(c.seconds_per_100m) : '<span class="ac-muted">—</span>';
            return '<tr>' +
                `<td class="ac-td-city">${this.#cityLink(c)}</td>` +
                `<td class="ac-num">${this.#num(c.num_labelers)}</td>` +
                `<td class="ac-num">${out(c.labels_per_user_median, c.labels_per_user_p90)}</td>` +
                `<td class="ac-num">${this.#num(c.num_validators)}</td>` +
                `<td class="ac-num">${out(c.validations_per_user_median, c.validations_per_user_p90)}</td>` +
                `<td class="ac-num">${v10}</td>` +
                `<td class="ac-num">${l100}</td>` +
                '</tr>';
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
            this.#cities.some(c => c.by_label_type && c.by_label_type[key] && c.by_label_type[key].labels > 0));

        if (legendEl) {
            legendEl.innerHTML = present.map(([key, name]) =>
                `<span class="ac-legend-item"><span class="ac-legend-swatch" style="background:${this.#color(key)}"></span>` +
                `${AcrossCitiesPage.#esc(name)}</span>`).join('');
        }

        const rows = this.#cities.slice().sort((a, b) => (b.total_labels || 0) - (a.total_labels || 0));
        host.innerHTML = rows.map(c => {
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
                    return `<span class="ac-stack-seg" style="width:${(share * 100).toFixed(2)}%;background:${this.#color(key)}" title="${AcrossCitiesPage.#esc(tip)}"></span>`;
                }).join('');
            }
            return '<div class="ac-pattern-row">' +
                `<div class="ac-pattern-city">${this.#cityLink(c)} <span class="ac-muted">${this.#compact(c.total_labels)}</span></div>` +
                `<div class="ac-stack">${segments}</div>` +
                '</div>';
        }).join('');
    }

    // --- Data quality section ---------------------------------------------------------------------------------------

    #renderQuality() {
        const tbody = document.getElementById('ac-quality-tbody');
        if (!tbody) return;
        const rows = this.#sortedCities('labels_validated_share', 'desc');
        tbody.innerHTML = rows.map(c => {
            const agreeDenom = (c.validations_agree || 0) + (c.validations_disagree || 0);
            const agreeRate = agreeDenom > 0 ? c.validations_agree / agreeDenom : null;
            const contribDenom = (c.active_contributors || 0) + (c.low_quality_contributors || 0);
            const lowQShare = contribDenom > 0 ? c.low_quality_contributors / contribDenom : 0;
            const flagged = (c.anomalies || []).includes('high_disagreement');
            const vpl = c.validations_per_label || 0;
            return `<tr class="${flagged ? 'ac-row--flagged' : ''}">` +
                `<td class="ac-td-city">${this.#cityLink(c)}</td>` +
                `<td class="ac-num" title="${this.#num(c.labels_validated)} of ${this.#num(c.total_labels)}">${this.#pct(c.labels_validated_share)}</td>` +
                `<td class="ac-num" title="${this.#num(c.total_validations)} validations / ${this.#num(c.total_labels)} labels">${vpl.toFixed(1)}</td>` +
                `<td class="ac-num">${agreeRate == null ? '<span class="ac-muted">—</span>' : this.#pct(agreeRate)}</td>` +
                `<td class="ac-num" title="${this.#num(c.labels_with_severity)} of ${this.#num(c.labels_severity_eligible)} severity-eligible labels">${this.#pct(c.severity_share)}</td>` +
                `<td class="ac-num" title="${this.#num(c.labels_with_tags)} of ${this.#num(c.labels_tag_eligible)} tag-eligible labels">${this.#pct(c.tags_share)}</td>` +
                `<td class="ac-num" title="${this.#num(c.ai_labels)} of ${this.#num(c.total_labels)} labels">${this.#pct(c.ai_label_share)}</td>` +
                `<td class="ac-num" title="${this.#num(c.ai_validations)} of ${this.#num(c.total_validations)} validations">${this.#pct(c.ai_validation_share)}</td>` +
                `<td class="ac-num" title="${this.#num(c.low_quality_contributors)} of ${this.#num(contribDenom)} contributors">${this.#pct(lowQShare)}</td>` +
                '</tr>';
        }).join('');
    }

    // --- Shared cell builders ---------------------------------------------------------------------------------------

    #cityLink(c) {
        const name = AcrossCitiesPage.#esc(c.city_name || c.city_id);
        return c.url ? `<a href="${AcrossCitiesPage.#esc(c.url)}" target="_blank" rel="noopener">${name}</a>` : name;
    }

    #coverageBar(coverage) {
        const pct = Math.round((coverage || 0) * 100);
        return '<div class="ac-bar" title="' + pct + '% audited">' +
            `<span class="ac-bar-fill" style="width:${pct}%"></span>` +
            `<span class="ac-bar-label">${pct}%</span></div>`;
    }

    /** A tiny inline-SVG sparkline for a row cell (no axes/labels). */
    #sparkline(values) {
        if (!values || !values.length) return '';
        const W = 90, H = 22, pad = 2;
        const max = Math.max(1, ...values);
        const n = values.length;
        const x = i => pad + (n === 1 ? (W - 2 * pad) / 2 : (i / (n - 1)) * (W - 2 * pad));
        const y = v => pad + (1 - v / max) * (H - 2 * pad);
        const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
        return `<svg class="ac-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
            `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
    }

    /** Canonical label-type color via the shared helper, with a gray fallback. */
    #color(labelType) {
        try {
            if (window.util && util.misc && util.misc.getLabelColors) {
                const c = util.misc.getLabelColors(labelType);
                if (c) return c;
            }
        } catch (e) { /* fall through to default */ }
        return '#b3b3b3';
    }

    // --- Helpers ----------------------------------------------------------------------------------------------------

    #setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
    #setHtml(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

    /** Full number with thousands separators ("1,234,567"). */
    #num(n) { return (n == null ? 0 : n).toLocaleString(); }

    /** Compact number ("1.2M", "317k", "842"). */
    #compact(n) {
        const v = n == null ? 0 : n;
        if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
        if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
        return v.toLocaleString();
    }

    /** Kilometers with one decimal under 100, else whole ("0.4", "12.7", "1,240"). */
    #km(n) {
        const v = n == null ? 0 : n;
        return v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString();
    }

    /** Percentage with no decimals ("47%"). */
    #pct(fraction) { return `${Math.round((fraction || 0) * 100)}%`; }

    /** Human duration from seconds ("8s", "2.4 min", "1.3 h"). */
    #duration(seconds) {
        const s = seconds || 0;
        if (s < 60) return `${Math.round(s)}s`;
        if (s < 3600) return `${(s / 60).toFixed(1)} min`;
        return `${(s / 3600).toFixed(1)} h`;
    }

    static #esc(s) {
        return String(s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /** "Jun 9"-style short date from an ISO date string. */
    static #shortDate(iso) {
        const d = new Date(iso + 'T00:00:00');
        if (isNaN(d)) return iso;
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    /** Compact relative time ("just now", "5m ago", "3h ago", "2d ago", or a date for older items). */
    static #relativeTime(ts) {
        const d = new Date(ts);
        if (isNaN(d)) return String(ts);
        const secs = Math.floor((Date.now() - d.getTime()) / 1000);
        if (secs < 60) return 'just now';
        const mins = Math.floor(secs / 60);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7) return `${days}d ago`;
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
}
