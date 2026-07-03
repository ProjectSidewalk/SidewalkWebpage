/**
 * Renders the admin API Analytics page (#4272). Frames v3 public-API usage around real external adoption vs our own
 * docs "Try it" traffic: KPIs, a monthly external-vs-docs usage trend (shared MiniLineChart), top endpoints, and
 * requested formats. Backed by /adminapi/apiAnalyticsBySource (source-split in one call); a time-range toggle re-fetches.
 */
class ApiAnalyticsPage {
    #dataUrl;
    #days = 30;
    #showDocs = { endpoints: false, formats: false };
    #data = null;

    /** @param {{dataUrl: string}} opts */
    constructor(opts = {}) {
        this.#dataUrl = opts.dataUrl;
    }

    init() {
        this.#wireRange();
        this.#wireDocsToggle();
        this.#load();
    }

    async #load() {
        this.#setStatus('Loading API analytics…', false);
        try {
            const data = await this.#fetchJson(`${this.#dataUrl}?days=${this.#days}`);
            this.#data = data;
            this.#renderRangeCaptions(data);
            this.#renderKpis(data);
            this.#renderTrend(data);
            this.#renderEndpoints(data);
            this.#renderFormats(data);
            this.#setStatus('', false, true);
        } catch (err) {
            console.error('API Analytics page failed to load:', err);
            this.#setStatus('Could not load API analytics. Please try again.', true);
        }
    }

    async #fetchJson(url) {
        const resp = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!resp.ok) throw new Error(`Request failed (${resp.status}): ${url}`);
        return resp.json();
    }

    #renderKpis(d) {
        const ext = (d.sources && d.sources.external) || {};
        const docs = (d.sources && d.sources.api_docs) || {};
        const extCalls = ext.calls || 0;
        const docsCalls = docs.calls || 0;
        const total = d.total_calls || 0;
        const busiest = (d.endpoints || []).find((e) => (e.external || 0) > 0);

        this.#setText('kpi-external-calls', extCalls.toLocaleString());
        this.#setText('kpi-external-calls-note', `+ ${docsCalls.toLocaleString()} from docs`);
        this.#setText('kpi-external-clients', (ext.unique_ips || 0).toLocaleString());
        this.#setText('kpi-busiest', busiest ? ApiAnalyticsPage.#short(busiest.endpoint) : '—');
        this.#setText('kpi-busiest-note', busiest ? `${(busiest.external || 0).toLocaleString()} external calls` : '');
        this.#setText('kpi-pct-external', total ? ApiAnalyticsPage.#pct(extCalls / total) : '—');
        this.#setText('kpi-pct-external-note', `${total.toLocaleString()} total calls`);
    }

    /**
     * External-vs-docs call volume over time, drawn with the shared MiniLineChart. Buckets by day for the dated ranges
     * (30/90) and by month for "All time" (readable over long spans). The axis is continuous and zero-filled, and
     * always ends at *today* so the right edge reads as "now" rather than the last day that happened to have traffic
     * (which also keeps gaps honest instead of collapsing them into adjacent points).
     */
    #renderTrend(d) {
        const el = document.getElementById('api-trend');
        if (!(d.total_calls > 0)) {
            el.innerHTML = `<p class="dq-empty">${this.#trendEmptyMsg(0, d.last_api_call)}</p>`;
            return;
        }
        const monthly = this.#days === 0;
        const byBucket = new Map();
        for (const r of d.daily || []) {
            const key = monthly ? String(r.date).slice(0, 7) : String(r.date);
            const a = byBucket.get(key) || { ext: 0, docs: 0 };
            a.ext += r.external || 0;
            a.docs += r.api_docs || 0;
            byBucket.set(key, a);
        }
        const dataKeys = [...byBucket.keys()].sort();
        const keys = ApiAnalyticsPage.#axisKeys(dataKeys[0], monthly, this.#days);
        if (keys.length < 2) {
            el.innerHTML = `<p class="dq-empty">${this.#trendEmptyMsg(d.total_calls || 0, d.last_api_call)}</p>`;
            return;
        }
        const at = (k) => byBucket.get(k) || { ext: 0, docs: 0 };
        const labels = keys.map((k) => (monthly ? ApiAnalyticsPage.#monthLabel(k) : ApiAnalyticsPage.#dayLabel(k)));
        const series = [
            { name: 'External', key: 'external', values: keys.map((k) => at(k).ext) },
            { name: 'Docs', key: 'apidocs', values: keys.map((k) => at(k).docs) },
        ];
        const fmt = (v) => `${Math.round(v).toLocaleString()} calls`;
        MiniLineChart.renderInto(el, labels, series, {
            tickFormat: (v) => Math.round(v).toLocaleString(), valueFormat: fmt, ariaLabel: 'API call volume over time',
        });
    }

    /**
     * Builds the continuous list of bucket keys for the trend axis, always ending at today so the chart's right edge
     * reads as "now". Dated ranges span the selected window (extended back if a boundary call predates it); "All time"
     * spans from the first month with data. Buckets the caller has no data for are absent here and get zero-filled.
     *
     * @param {string} firstDataKey - Earliest bucket key present in the data ('YYYY-MM-DD' or 'YYYY-MM').
     * @param {boolean} monthly - Month buckets (All time) vs day buckets (dated ranges).
     * @param {number} days - Selected range in days (0 = all time).
     * @returns {string[]} Ordered bucket keys from the start through today.
     */
    static #axisKeys(firstDataKey, monthly, days) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (monthly) {
            const keys = [];
            let [y, mo] = firstDataKey.split('-').map(Number);
            const ey = today.getFullYear(); const em = today.getMonth() + 1;
            while (y < ey || (y === ey && mo <= em)) {
                keys.push(`${y}-${String(mo).padStart(2, '0')}`);
                if (++mo > 12) {
                    mo = 1; y++;
                }
            }
            return keys;
        }
        const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
        const [sy, sm, sd] = [ApiAnalyticsPage.#isoDay(windowStart), firstDataKey].sort()[0].split('-').map(Number);
        const keys = [];
        let cur = new Date(sy, sm - 1, sd);
        while (cur <= today) {
            keys.push(ApiAnalyticsPage.#isoDay(cur));
            cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
        }
        return keys;
    }

    /** ISO `YYYY-MM-DD` for a local Date (no UTC conversion, so no day-shift). */
    static #isoDay(dt) {
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    }

    /**
     * Explains why the trend can't be drawn, naming the selected range and (when known) when activity last happened so
     * the admin knows whether to widen the range or whether the API is simply unused.
     *
     * @param {number} total - Total calls in the current window.
     * @param {?string} lastApiCall - ISO date of the most recent call ever (window-independent), or null/undefined.
     * @returns {string} Human-readable empty-state message.
     */
    #trendEmptyMsg(total, lastApiCall) {
        const range = this.#days > 0 ? `the past ${this.#days} days` : 'all time';
        if (total === 0) {
            if (!lastApiCall) return 'No v3 API calls have been recorded yet.';
            const ago = ApiAnalyticsPage.#daysAgo(lastApiCall);
            const agoText = ago == null ? '' : ` (${ago} ${ago === 1 ? 'day' : 'days'} ago)`;
            return `The selected range is ${range}, and there's been no API activity in it — the last call was on `
                + `${ApiAnalyticsPage.#fmtDate(lastApiCall)}${agoText}. Try a longer range.`;
        }
        // total > 0 but a single bucket: all activity lands in one month (only reachable for the All time range), so
        // there's no second point to draw a line to yet.
        const unit = this.#days > 0 ? 'day' : 'month';
        return `So far there's only a single ${unit} of API activity, so there's no trend to plot yet.`;
    }

    /** Writes the active date range ("Date range: …") onto every chart so the selected window is always explicit. */
    #renderRangeCaptions(d) {
        const label = `Date range: ${this.#rangeLabel(d)}`;
        for (const id of ['api-trend-range', 'api-endpoints-range', 'api-formats-range']) this.#setText(id, label);
    }

    /**
     * The selected window as a concrete date span ending today: the dated ranges (30/90) count back from today; "All
     * time" runs from the earliest day with data. Falls back to a plain note when there's no activity to bound.
     *
     * @param {object} d - The analytics payload (used for the All time start date).
     * @returns {string} e.g. "May 28 – Jun 26, 2026", or "May 21, 2025 – Jun 26, 2026" across years.
     */
    #rangeLabel(d) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let start;
        if (this.#days > 0) {
            start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (this.#days - 1));
        } else {
            const dates = (d.daily || []).map((r) => String(r.date)).sort();
            if (!dates.length) return 'all time (no API activity yet)';
            const [y, m, day] = dates[0].split('-').map(Number);
            start = new Date(y, m - 1, day);
        }
        return ApiAnalyticsPage.#fmtRange(start, today);
    }

    /** Formats a start–end span, showing the year on the start only when it differs from the end's, plus on the end. */
    static #fmtRange(start, end) {
        const sameYear = start.getFullYear() === end.getFullYear();
        const withYear = { month: 'short', day: 'numeric', year: 'numeric' };
        const noYear = { month: 'short', day: 'numeric' };
        const startStr = start.toLocaleDateString(undefined, sameYear ? noYear : withYear);
        return `${startStr} – ${end.toLocaleDateString(undefined, withYear)}`;
    }

    /** Formats an ISO `YYYY-MM-DD` date as a localized long date, parsing parts locally to avoid a UTC day-shift. */
    static #fmtDate(iso) {
        const [y, m, day] = String(iso).split('-').map(Number);
        if (!y || !m || !day) return String(iso);
        return new Date(y, m - 1, day).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    }

    /** Whole days between an ISO `YYYY-MM-DD` date and today (local midnight to local midnight); null if unparseable. */
    static #daysAgo(iso) {
        const [y, m, day] = String(iso).split('-').map(Number);
        if (!y || !m || !day) return null;
        const then = new Date(y, m - 1, day);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return Math.max(0, Math.round((today - then) / 86400000));
    }

    /** Short day label, e.g. "Jun 1", from an ISO `YYYY-MM-DD` (parsed locally to avoid a UTC day-shift). */
    static #dayLabel(iso) {
        const [y, m, day] = iso.split('-').map(Number);
        return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    /** Short month label, e.g. "Jun 2026", from a `YYYY-MM` bucket key. */
    static #monthLabel(ym) {
        const [y, m] = ym.split('-').map(Number);
        return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    }

    /**
     * Top endpoints, ranked by external calls. The bar shows external usage; when "docs traffic" is on, our own
     * docs "Try it" calls are stacked on in a second (grey) segment. Rank order stays by external regardless of the
     * toggle so rows don't reshuffle when it's flipped.
     */
    #renderEndpoints(d) {
        const eps = (d.endpoints || []).filter((e) => (e.external || 0) + (e.api_docs || 0) > 0);
        const el = document.getElementById('api-endpoints');
        el.innerHTML = eps.length === 0
            ? '<p class="dq-empty">No API calls recorded for this range.</p>'
            : this.#bars(eps, (e) => ApiAnalyticsPage.#short(e.endpoint), this.#showDocs.endpoints);
    }

    /** Requested output formats, ranked by external calls; docs traffic stacks on when this chart's switch is on. */
    #renderFormats(d) {
        const fmts = (d.formats || []).filter((f) => (f.external || 0) + (f.api_docs || 0) > 0);
        const el = document.getElementById('api-formats');
        el.innerHTML = fmts.length === 0
            ? '<p class="dq-empty">No format data for this range.</p>'
            : this.#bars(fmts, (f) => f.format, this.#showDocs.formats);
    }

    /**
     * Renders a list of source-split rows to HTML. The bar denominator is the largest external count, or the largest
     * external+docs total when docs traffic is shown, so stacked bars never overflow their track.
     *
     * @param {Array<{external?: number, api_docs?: number}>} items - Rows with external/api_docs counts.
     * @param {(item: object) => string} labelOf - Extracts the row label from an item.
     * @param {boolean} showDocs - Whether this chart stacks the docs segment onto its bars.
     * @returns {string} Concatenated row HTML.
     */
    #bars(items, labelOf, showDocs) {
        const max = Math.max(1, ...items.map((i) =>
            (showDocs ? (i.external || 0) + (i.api_docs || 0) : (i.external || 0))));
        return items.map((i) => {
            const ext = (i.external || 0).toLocaleString();
            // The docs count only earns its place in the value text once this chart's "docs traffic" switch is on.
            const value = showDocs
                ? `${ext} <span class="dq-sub">· ${(i.api_docs || 0).toLocaleString()} docs</span>`
                : ext;
            return ApiAnalyticsPage.#row(labelOf(i), i.external || 0, i.api_docs || 0, max, showDocs, value);
        }).join('');
    }

    /**
     * A label + usage-bar + value row. The bar is a single external segment, or external+docs stacked when showDocs
     * is on. valueHtml is trusted (built here); label is escaped.
     *
     * @param {string} label - Row label (escaped before insertion).
     * @param {number} extVal - External call count.
     * @param {number} docsVal - Docs "Try it" call count.
     * @param {number} max - Bar denominator (shared across the chart's rows).
     * @param {boolean} showDocs - Whether to stack the docs segment onto the bar.
     * @param {string} valueHtml - Trusted HTML for the trailing value text.
     * @returns {string} Row HTML.
     */
    static #row(label, extVal, docsVal, max, showDocs, valueHtml) {
        const w = (v) => `${Math.max(0, Math.min(1, v / max)) * 100}%`;
        const track = showDocs
            ? `<div class="dq-bar-track dq-stack">`
            + `<div class="api-bar-external" style="width:${w(extVal)}"></div>`
            + `<div class="api-bar-docs" style="width:${w(docsVal)}"></div>`
            + `</div>`
            : `<div class="dq-bar-track"><div class="dq-bar" style="width:${w(extVal)};background:var(--api-external, #2171b5)"></div></div>`;
        return [
            '<div class="api-ep-row">',
            `<span class="api-ep-label" title="${ApiAnalyticsPage.#esc(label)}">${ApiAnalyticsPage.#esc(label)}</span>`,
            track,
            `<span class="api-ep-value">${valueHtml}</span>`,
            '</div>',
        ].join('');
    }

    /** Strips the /v3/api/ prefix for a compact endpoint label. */
    static #short(endpoint) {
        return String(endpoint).replace('/v3/api/', '');
    }

    #wireRange() {
        const buttons = document.querySelectorAll('.api-range-btn');
        buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.classList.contains('active')) return;
                buttons.forEach((b) => {
                    const isTarget = b === btn;
                    b.classList.toggle('active', isTarget);
                    b.setAttribute('aria-pressed', String(isTarget));
                });
                this.#days = parseInt(btn.dataset.days, 10);
                this.#load();
            });
        });
    }

    /**
     * Wires each chart's "Show docs traffic" switch (one under Top endpoints, one under Formats). Off by default so
     * the charts read as real external adoption; flipping a switch re-renders only that chart from the already-loaded
     * data (no refetch) and reveals its colour legend.
     */
    #wireDocsToggle() {
        document.querySelectorAll('.api-docs-toggle').forEach((input) => {
            const chart = input.dataset.chart;
            const legend = input.closest('.api-docs-control').querySelector('.api-docs-legend');
            input.addEventListener('change', () => {
                this.#showDocs[chart] = input.checked;
                if (legend) legend.classList.toggle('hidden', !input.checked);
                if (!this.#data) return;
                if (chart === 'endpoints') this.#renderEndpoints(this.#data);
                else if (chart === 'formats') this.#renderFormats(this.#data);
            });
        });
    }

    static #pct(frac) {
        return `${Math.round((frac || 0) * 100)}%`;
    }

    static #esc(s) {
        return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    #setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    #setStatus(message, isError, hide = false) {
        const status = document.getElementById('api-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('error', !!isError);
        status.classList.toggle('hidden', hide);
    }
}
