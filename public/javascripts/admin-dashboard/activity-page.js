/**
 * Renders the admin Activity page (#4272) — the time/tempo lens on a deployment. Driven by one fetch of the unified
 * daily series (/adminapi/activityByDay) plus the recent-comments feed: KPI totals, a grid of volume small-multiples
 * (shared MiniLineChart), an active-contributors line split registered-vs-anonymous, and a recent-activity feed. A
 * shared range (30/90/all) and bucket (day/week) toggle re-render the charts client-side without refetching.
 *
 * Aggregation rule: volume metrics sum over a bucket; active-user counts are per-day distinct, which can't be summed
 * across days without double-counting, so they're averaged per day within a bucket instead (and omitted from the
 * additive KPI totals).
 */
class ActivityPage {
    #seriesUrl;
    #recentUrl;
    #range = 90;       // selected window in days; 0 = all time
    #gran = 'day';     // 'day' | 'week'
    #series = null;    // raw daily records (sorted ascending by date)
    #recent = null;    // recent-activity stream items (labels/validations/comments), newest first
    #labelPopup = null; // LabelPopup instance; set once the (async) pano viewer has initialized

    /** Max items shown in the recent-activity feed (the endpoint returns more; a feed wants only the freshest). */
    static #FEED_LIMIT = 20;

    /** Badge label + CSS modifier per recent-activity item type. */
    static #BADGES = {
        label: { label: 'Label', cls: 'is-label' },
        validation: { label: 'Validate', cls: 'is-validate' },
        comment: { label: 'Comment', cls: 'is-comment' }
    };

    /** Volume small-multiples: each is one additive metric drawn as a single-series sparkline. */
    static #VOLUME = [
        { title: 'Labels', fields: ['labels'], unit: 'labels' },
        { title: 'Validations', fields: ['validations'], unit: 'validations' },
        { title: 'Streets explored', fields: ['audits'], unit: 'streets' },
        { title: 'Missions', fields: ['missions'], unit: 'missions' },
        { title: 'Sign-ins', fields: ['signins_registered', 'signins_anon'], unit: 'sign-ins' },
        { title: 'New users', fields: ['new_users'], unit: 'users' }
    ];

    /** @param {{seriesUrl: string, recentUrl: string}} opts */
    constructor(opts = {}) {
        this.#seriesUrl = opts.seriesUrl;
        this.#recentUrl = opts.recentUrl;
    }

    init() {
        this.#wireControls();
        this.#wireFeedClicks();
        this.#load();
    }

    /**
     * Provides the (async-initialized) LabelPopup so feed label links open the label inline instead of navigating.
     * @param {{showLabel: function(number, string): Promise}} popup - A LabelPopup instance.
     */
    setLabelPopup(popup) {
        this.#labelPopup = popup;
    }

    async #load() {
        this.#setStatus('Loading activity…', false);
        try {
            const [seriesResp, recentResp] = await Promise.all([
                this.#fetchJson(this.#seriesUrl),
                this.#fetchJson(this.#recentUrl)
            ]);
            this.#series = (seriesResp && seriesResp.series) || [];
            this.#recent = (recentResp && recentResp.activity) || [];
            this.#renderRangeDependent();
            this.#renderFeed();
            this.#setStatus('', false, true);
        } catch (err) {
            console.error('Activity page failed to load:', err);
            this.#setStatus('Could not load activity. Please try again.', true);
        }
    }

    async #fetchJson(url) {
        const resp = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!resp.ok) throw new Error(`Request failed (${resp.status}): ${url}`);
        return resp.json();
    }

    /** Everything that depends on the range/bucket toggles — re-run on toggle without refetching. */
    #renderRangeDependent() {
        if (!this.#series) return; // a toggle may fire before the first load resolves; load() re-runs this after.
        this.#renderBanner();
        this.#renderKpis();
        this.#renderVolume();
        this.#renderActive();
    }

    /**
     * A persistent line telling the admin when the deployment was last active and who acted most recently, plus — when
     * the selected window is empty — a one-click jump to "all time". Without this, a quiet city loads as all-zero cards
     * with no hint that the data is simply older than the default window (see #4272 review).
     */
    #renderBanner() {
        const el = document.getElementById('activity-latest');
        if (!el) return;
        const top = this.#recent && this.#recent[0];
        if (!top && !this.#series.length) {
            el.innerHTML = 'No activity has been recorded for this deployment yet.';
            return;
        }
        let html;
        if (top) {
            // The stream is newest-first, so item 0 is the single most recent contribution — name what it was + who.
            html = `Most recent activity: <strong>${ActivityPage.#esc(ActivityPage.#describeItem(top))}</strong> by ` +
                `<strong>${ActivityPage.#esc(top.username || 'Unknown')}</strong> ` +
                `${ActivityPage.#esc(ActivityPage.#relativeTime(top.timestamp))}.`;
        } else {
            // No labels/validations/comments, but the series (audits/sign-ins/missions) has dates: fall back to the date.
            const latest = this.#series[this.#series.length - 1].date;
            const ago = ActivityPage.#daysAgo(latest);
            const agoText = ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago.toLocaleString()} days ago`;
            html = `Most recent activity: <strong>${ActivityPage.#esc(ActivityPage.#fmtLongDate(latest))}</strong> (${agoText}).`;
        }
        // Empty window: the backend emits only days that had activity, so no in-window records ⇒ nothing happened then.
        if (this.#range > 0 && this.#windowRecords().length === 0) {
            html += ` <span class="activity-latest-warn">Nothing in the last ${this.#range} days.</span> ` +
                '<button type="button" class="activity-link-btn act-show-all">View all time</button>';
        }
        el.innerHTML = html;

        const showAll = el.querySelector('.act-show-all');
        if (showAll) {
            showAll.addEventListener('click', () => {
                const allBtn = document.querySelector('.act-range-btn[data-range="all"]');
                if (allBtn) allBtn.click(); // reuse the range toggle's wiring (updates state + re-renders)
            });
        }
    }

    // --- KPIs ---------------------------------------------------------------------------------------------------

    #renderKpis() {
        const recs = this.#windowRecords();
        const sum = field => recs.reduce((a, r) => a + (r[field] || 0), 0);
        const note = `in ${this.#rangeNoun()}`;
        const set = (id, field) => {
            this.#setText(`kpi-${id}`, sum(field).toLocaleString());
            this.#setText(`kpi-${id}-note`, note);
        };
        set('labels', 'labels');
        set('validations', 'validations');
        set('audits', 'audits');
        set('missions', 'missions');
        set('newusers', 'new_users');
    }

    // --- Volume small-multiples ---------------------------------------------------------------------------------

    #renderVolume() {
        const el = document.getElementById('activity-volume');
        const buckets = this.#computeBuckets();
        if (buckets.length < 2) {
            el.innerHTML = `<p class="dq-empty">${this.#tooSparseMsg()}</p>`;
            return;
        }
        const labels = buckets.map(b => b.label);
        el.innerHTML = ActivityPage.#VOLUME.map(metric => {
            const values = buckets.map(b => metric.fields.reduce((a, f) => a + b.vol[f], 0));
            const total = values.reduce((a, v) => a + v, 0);
            const series = [{ name: metric.title, key: 'activity', values }];
            const chart = MiniLineChart.svg(labels, series, {
                valueFormat: v => `${Math.round(v).toLocaleString()} ${metric.unit}`,
                ariaLabel: `${metric.title} over time`
            });
            return '<div class="activity-card">' +
                '<div class="activity-card-head">' +
                `<span class="activity-card-title">${ActivityPage.#esc(metric.title)}</span>` +
                `<span class="activity-card-total"><strong>${total.toLocaleString()}</strong> in ${ActivityPage.#esc(this.#rangeNoun())}</span>` +
                '</div>' + chart + '</div>';
        }).join('');
    }

    // --- Active contributors over time --------------------------------------------------------------------------

    /**
     * Distinct active users per bucket, split registered vs anonymous. Daily points are the day's distinct count;
     * weekly points are the average of the week's daily counts (distinct-per-day can't be summed across days), so the
     * card notes that when weekly is selected.
     */
    #renderActive() {
        const el = document.getElementById('activity-active');
        const buckets = this.#computeBuckets();
        if (buckets.length < 2) {
            el.innerHTML = `<p class="dq-empty">${this.#tooSparseMsg()}</p>`;
            return;
        }
        const labels = buckets.map(b => b.label);
        const series = [
            { name: 'Registered', key: 'registered', values: buckets.map(b => b.activeRegistered) },
            { name: 'Anonymous', key: 'anon', values: buckets.map(b => b.activeAnon) }
        ];
        const weekly = this.#gran === 'week';
        const unit = weekly ? 'avg users/day' : 'users';
        const chart = MiniLineChart.svg(labels, series, {
            valueFormat: v => `${Math.round(v).toLocaleString()} ${unit}`,
            ariaLabel: 'Active contributors over time',
            dotRadius: 2
        });
        const caption = weekly
            ? '<p class="dq-empty">Weekly points are the average of that week’s daily active-user counts.</p>'
            : '';
        el.innerHTML = chart + caption;
    }

    // --- Bucketing ----------------------------------------------------------------------------------------------

    /**
     * Builds the continuous, zero-filled bucket series for the current range + granularity. Walks every calendar day
     * from the window start through today (so gaps stay honest and the right edge reads as "now"), assigning each to a
     * day or week-start bucket. Volume fields are summed; active-user fields are averaged over the bucket's days.
     *
     * @returns {Array<{key: string, label: string, days: number, vol: object, activeRegistered: number,
     *                  activeAnon: number}>} Ordered buckets.
     */
    #computeBuckets() {
        const today = ActivityPage.#startOfToday();
        const windowStart = this.#range > 0
            ? ActivityPage.#addDays(today, -(this.#range - 1))
            : (this.#earliestDate() || today);
        const dayMap = new Map();
        for (const r of this.#series) dayMap.set(r.date, r);

        const buckets = new Map();
        const order = [];
        const volFields = ['labels', 'validations', 'audits', 'missions',
            'signins_registered', 'signins_anon', 'new_users'];
        for (let cur = new Date(windowStart); cur <= today; cur = ActivityPage.#addDays(cur, 1)) {
            const iso = ActivityPage.#isoDay(cur);
            const key = this.#gran === 'week' ? ActivityPage.#isoDay(ActivityPage.#weekStart(cur)) : iso;
            let acc = buckets.get(key);
            if (!acc) {
                acc = { key, label: ActivityPage.#dayLabel(key), days: 0, vol: {},
                    activeRegSum: 0, activeAnonSum: 0 };
                volFields.forEach(f => { acc.vol[f] = 0; });
                buckets.set(key, acc);
                order.push(key);
            }
            const r = dayMap.get(iso);
            acc.days += 1;
            if (r) {
                volFields.forEach(f => { acc.vol[f] += r[f] || 0; });
                acc.activeRegSum += r.active_registered || 0;
                acc.activeAnonSum += r.active_anon || 0;
            }
        }
        return order.map(k => {
            const a = buckets.get(k);
            return {
                key: a.key, label: a.label, days: a.days, vol: a.vol,
                activeRegistered: a.days ? a.activeRegSum / a.days : 0,
                activeAnon: a.days ? a.activeAnonSum / a.days : 0
            };
        });
    }

    /** Records within the selected window (date >= window start). Drives the additive KPI totals. */
    #windowRecords() {
        if (this.#range <= 0) return this.#series;
        const today = ActivityPage.#startOfToday();
        const startIso = ActivityPage.#isoDay(ActivityPage.#addDays(today, -(this.#range - 1)));
        return this.#series.filter(r => r.date >= startIso);
    }

    /** Earliest date present in the series as a local Date (series is sorted ascending), or null if empty. */
    #earliestDate() {
        if (!this.#series.length) return null;
        return ActivityPage.#parseIso(this.#series[0].date);
    }

    // --- Recent-activity feed -----------------------------------------------------------------------------------

    #renderFeed() {
        const el = document.getElementById('activity-feed');
        const all = this.#recent || [];
        if (!all.length) {
            el.innerHTML = '<p class="dq-empty">No recent activity yet.</p>';
            return;
        }
        // The endpoint already returns the freshest items, newest-first; cap to keep the feed scannable.
        const items = all.slice(0, ActivityPage.#FEED_LIMIT);
        const rows = items.map(it => {
            const badge = ActivityPage.#BADGES[it.activity_type] || { label: 'Activity', cls: '' };
            const who = ActivityPage.#esc(it.username || 'Unknown');
            const link = (it.label_id != null)
                // The href is a real fallback (works without JS / before the popup loads); the click handler intercepts
                // it to open the label inline once the popup is ready.
                ? `<a class="activity-label-link" href="/admin/label/${encodeURIComponent(it.label_id)}" ` +
                  `data-label-id="${ActivityPage.#esc(it.label_id)}">label #${ActivityPage.#esc(it.label_id)}</a>`
                : '';
            const text = ActivityPage.#feedText(it);
            const meta = link ? `${who} · ${link}` : who;
            const when = ActivityPage.#relativeTime(it.timestamp);
            const fullDate = ActivityPage.#fmtDateTime(it.timestamp);
            return '<div class="activity-feed-item">' +
                `<span class="activity-feed-badge ${badge.cls}">${ActivityPage.#esc(badge.label)}</span>` +
                '<div class="activity-feed-body">' +
                `<div class="activity-feed-text">${text}</div>` +
                `<div class="activity-feed-meta">${meta}</div>` +
                '</div>' +
                `<span class="activity-feed-time" title="${ActivityPage.#esc(fullDate)}">${ActivityPage.#esc(when)}</span>` +
                '</div>';
        }).join('');
        const caption = all.length > items.length
            ? `<p class="dq-empty">Showing the ${items.length} most recent items.</p>`
            : '';
        el.innerHTML = rows + caption;
    }

    /**
     * The main line of a feed item: for a label/validation, a phrase about the action; for a comment, the comment text
     * (quoted). The label-type name is bolded so the type is scannable down the feed.
     *
     * @param {object} it - A recent-activity item.
     * @returns {string} Trusted HTML (all interpolated values escaped here).
     */
    static #feedText(it) {
        const type = it.label_type ? `<strong>${ActivityPage.#esc(it.label_type)}</strong>` : 'a label';
        if (it.activity_type === 'label') {
            return `Placed ${type}`;
        }
        if (it.activity_type === 'validation') {
            const verdict = { Agree: 'agreed', Disagree: 'disagreed', Unsure: 'unsure' }[it.validation_result]
                || ActivityPage.#esc(it.validation_result || '');
            return `Validated ${type} — ${verdict}`;
        }
        return `“${ActivityPage.#esc(it.comment || '')}”`;
    }

    /** A short phrase naming an item for the "most recent activity" banner. */
    static #describeItem(it) {
        const type = it.label_type || 'label';
        if (it.activity_type === 'label') return `a ${type} label`;
        if (it.activity_type === 'validation') {
            const verdict = { Agree: 'agreed', Disagree: 'disagreed', Unsure: 'unsure' }[it.validation_result] || 'validated';
            return `a ${type} validation (${verdict})`;
        }
        return 'a comment';
    }

    /**
     * Delegated click handling for feed label links: once the popup is ready, open the label inline instead of
     * navigating; until then (or if it failed to init), the link falls back to its href. Bound once on the container
     * so it survives feed re-renders.
     */
    #wireFeedClicks() {
        const feed = document.getElementById('activity-feed');
        if (!feed) return;
        feed.addEventListener('click', e => {
            const link = e.target.closest('.activity-label-link');
            if (!link || !this.#labelPopup) return; // no popup yet → let the href navigate
            e.preventDefault();
            const labelId = parseInt(link.dataset.labelId, 10);
            if (!Number.isNaN(labelId)) this.#labelPopup.showLabel(labelId, 'AdminActivity');
        });
    }

    // --- Controls -----------------------------------------------------------------------------------------------

    #wireControls() {
        this.#wireToggle('.act-range-btn', btn => {
            this.#range = btn.dataset.range === 'all' ? 0 : parseInt(btn.dataset.range, 10);
        });
        this.#wireToggle('.act-gran-btn', btn => {
            this.#gran = btn.dataset.gran;
        });
    }

    /**
     * Wires a single-select button group: clicking a button activates it (and deactivates its siblings), updates state
     * via the callback, then re-renders. No-ops when the already-active button is clicked. State updates even before
     * the first load resolves; the render is a safe no-op until data arrives (load() re-renders once it does).
     *
     * @param {string} selector - CSS selector for the button group.
     * @param {(btn: HTMLElement) => void} updateState - Reads the selected button and updates the relevant state field.
     */
    #wireToggle(selector, updateState) {
        const buttons = document.querySelectorAll(selector);
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.classList.contains('active')) return;
                buttons.forEach(b => {
                    const isTarget = b === btn;
                    b.classList.toggle('active', isTarget);
                    b.setAttribute('aria-pressed', String(isTarget));
                });
                updateState(btn);
                this.#renderRangeDependent();
            });
        });
    }

    // --- Small helpers ------------------------------------------------------------------------------------------

    /** The selected window as a noun phrase for KPI/total notes, e.g. "the last 90 days" or "all time". */
    #rangeNoun() {
        return this.#range > 0 ? `the last ${this.#range} days` : 'all time';
    }

    /** Message shown when the window has fewer than two buckets, so there's no line to draw. */
    #tooSparseMsg() {
        return this.#series && this.#series.length
            ? 'Not enough activity in this range to plot a trend. Try a longer range.'
            : 'No activity has been recorded yet.';
    }

    static #startOfToday() {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    static #addDays(dt, n) {
        return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);
    }

    /** Monday of the week containing `dt` (weeks start Monday). */
    static #weekStart(dt) {
        const diff = (dt.getDay() + 6) % 7; // days since Monday (Sun=0 -> 6)
        return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - diff);
    }

    /** ISO `YYYY-MM-DD` for a local Date (no UTC conversion, so no day-shift). */
    static #isoDay(dt) {
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    }

    /** Parse an ISO `YYYY-MM-DD` into a local Date (parts parsed locally to avoid a UTC day-shift). */
    static #parseIso(iso) {
        const [y, m, d] = String(iso).split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    /** Short day label, e.g. "Jun 1", from an ISO `YYYY-MM-DD`. */
    static #dayLabel(iso) {
        return ActivityPage.#parseIso(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    /** Long date label, e.g. "June 1, 2026", from an ISO `YYYY-MM-DD`. */
    static #fmtLongDate(iso) {
        return ActivityPage.#parseIso(iso).toLocaleDateString(undefined,
            { year: 'numeric', month: 'long', day: 'numeric' });
    }

    /** Whole days between an ISO `YYYY-MM-DD` and today (local midnight to local midnight). */
    static #daysAgo(iso) {
        const then = ActivityPage.#parseIso(iso);
        const today = ActivityPage.#startOfToday();
        return Math.max(0, Math.round((today - then) / 86400000));
    }

    /** Localized full date-time for a timestamp string (hover title on feed items). */
    static #fmtDateTime(ts) {
        const d = new Date(ts);
        return isNaN(d) ? String(ts) : d.toLocaleString(undefined,
            { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    /** Compact relative time ("just now", "5m ago", "3h ago", "2d ago", or a date for older items). */
    static #relativeTime(ts) {
        const then = new Date(ts);
        if (isNaN(then)) return '';
        const secs = Math.max(0, (Date.now() - then.getTime()) / 1000);
        if (secs < 60) return 'just now';
        const mins = Math.floor(secs / 60);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7) return `${days}d ago`;
        return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    static #esc(s) {
        return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    #setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    #setStatus(message, isError, hide = false) {
        const status = document.getElementById('activity-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('error', !!isError);
        status.classList.toggle('hidden', hide);
    }
}
