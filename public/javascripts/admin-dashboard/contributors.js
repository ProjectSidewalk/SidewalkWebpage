/**
 * Renders the admin Contributors page (#4272). Aggregates the per-user admin stats into a picture of who produces the
 * deployment's data and how trustworthy it is: counts by quality flag and role, the share of labels coming from high-
 * vs low-quality users, and the distribution of contributor accuracy. Rendered as an accessible HTML/CSS scorecard
 * (no charting library). Data is /adminapi/getUserStats (per-user highQuality, labels, ownValidatedAgreedPct, role).
 */
class ContributorsPage {
    /** Accuracy buckets (upper bounds, percent) for the contributor-accuracy distribution. */
    static #ACCURACY_BUCKETS = [
        { label: '< 50%', max: 50 },
        { label: '50–70%', max: 70 },
        { label: '70–80%', max: 80 },
        { label: '80–90%', max: 90 },
        { label: '90–95%', max: 95 },
        { label: '95–100%', max: 100.0001 }
    ];

    #userStatsUrl;

    /** @param {{userStatsUrl: string}} opts */
    constructor(opts = {}) {
        this.#userStatsUrl = opts.userStatsUrl;
    }

    async init() {
        try {
            const resp = await this.#fetchJson(this.#userStatsUrl);
            const users = (resp && resp.user_stats) || [];
            const labelers = users.filter(u => (u.labels || 0) > 0);

            this.#renderKpis(labelers);
            this.#renderQualitySplit(labelers);
            this.#renderLabelSource(labelers);
            this.#renderAccuracy(labelers);
            this.#renderRoles(labelers);

            this.#setStatus('', false, true);
        } catch (err) {
            console.error('Contributors page failed to load:', err);
            this.#setStatus('Could not load contributor data. Please try again.', true);
        }
    }

    async #fetchJson(url) {
        const resp = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!resp.ok) throw new Error(`Request failed (${resp.status}): ${url}`);
        return resp.json();
    }

    #renderKpis(labelers) {
        const highQ = labelers.filter(u => u.highQuality).length;
        const totalLabels = labelers.reduce((s, u) => s + (u.labels || 0), 0);
        const labelsHighQ = labelers.reduce((s, u) => s + (u.highQuality ? (u.labels || 0) : 0), 0);

        this.#setText('kpi-contributors', labelers.length.toLocaleString());
        this.#setText('kpi-high-quality', highQ.toLocaleString());
        this.#setText('kpi-low-quality', (labelers.length - highQ).toLocaleString());
        this.#setText('kpi-labels-high-quality', totalLabels ? ContributorsPage.#pct(labelsHighQ / totalLabels) : '—');
        this.#setText('kpi-labels-high-quality-note', `${labelsHighQ.toLocaleString()} of ${totalLabels.toLocaleString()} labels`);
    }

    /** Stacked bar of high- vs low-quality contributor counts. */
    #renderQualitySplit(labelers) {
        const high = labelers.filter(u => u.highQuality).length;
        const low = labelers.length - high;
        document.getElementById('contrib-quality').innerHTML = ContributorsPage.#stackedBar([
            { label: 'High-quality', value: high, cls: 'contrib-seg--high' },
            { label: 'Low-quality', value: low, cls: 'contrib-seg--low' }
        ]);
    }

    /** Stacked bar of how many labels come from high- vs low-quality contributors. */
    #renderLabelSource(labelers) {
        const high = labelers.reduce((s, u) => s + (u.highQuality ? (u.labels || 0) : 0), 0);
        const low = labelers.reduce((s, u) => s + (!u.highQuality ? (u.labels || 0) : 0), 0);
        document.getElementById('contrib-label-source').innerHTML = ContributorsPage.#stackedBar([
            { label: 'From high-quality users', value: high, cls: 'contrib-seg--high' },
            { label: 'From low-quality users', value: low, cls: 'contrib-seg--low' }
        ]);
    }

    /** Histogram of contributors by the agreement rate of their own labels (only those with validated labels). */
    #renderAccuracy(labelers) {
        const rated = labelers.filter(u => (u.ownValidated || 0) > 0);
        // ownValidatedAgreedPct may be a fraction (0–1) or a percent (0–100); normalize from the observed max.
        const maxVal = rated.reduce((m, u) => Math.max(m, u.ownValidatedAgreedPct || 0), 0);
        const factor = maxVal <= 1 ? 100 : 1;

        const counts = ContributorsPage.#ACCURACY_BUCKETS.map(() => 0);
        for (const u of rated) {
            const acc = (u.ownValidatedAgreedPct || 0) * factor;
            const idx = ContributorsPage.#ACCURACY_BUCKETS.findIndex(b => acc < b.max);
            counts[idx >= 0 ? idx : counts.length - 1]++;
        }
        const max = Math.max(1, ...counts);
        const el = document.getElementById('contrib-accuracy');
        if (rated.length === 0) {
            el.innerHTML = '<p class="dq-empty">No contributors with validated labels yet.</p>';
            return;
        }
        el.innerHTML = ContributorsPage.#ACCURACY_BUCKETS.map((b, i) =>
            ContributorsPage.#barRow(b.label, counts[i], max, 'var(--color-pine-500, #4a9d6d)')).join('');
    }

    /** Contributor counts by account role, sorted descending. */
    #renderRoles(labelers) {
        const byRole = new Map();
        for (const u of labelers) byRole.set(u.role, (byRole.get(u.role) || 0) + 1);
        const rows = [...byRole.entries()].sort((a, b) => b[1] - a[1]);
        const max = Math.max(1, ...rows.map(r => r[1]));
        document.getElementById('contrib-roles').innerHTML = rows.map(([role, count]) =>
            ContributorsPage.#barRow(role, count, max, 'var(--color-asphalt-500, #263238)')).join('');
    }

    /** A two-segment stacked bar with a legend (count + share) beneath. */
    static #stackedBar(segments) {
        const total = segments.reduce((s, x) => s + x.value, 0) || 1;
        const bar = '<div class="dq-bar-track dq-stack">' + segments.map(s =>
            `<div class="contrib-seg ${s.cls}" style="width:${(s.value / total) * 100}%"></div>`).join('') + '</div>';
        const legend = '<div class="contrib-legend">' + segments.map(s =>
            `<span class="contrib-legend-item"><span class="contrib-swatch ${s.cls}"></span>` +
            `${ContributorsPage.#esc(s.label)} <b>${s.value.toLocaleString()}</b> ` +
            `<span class="dq-sub">(${ContributorsPage.#pct(s.value / total)})</span></span>`).join('') + '</div>';
        return bar + legend;
    }

    /** A label + horizontal bar + count row. */
    static #barRow(label, count, max, color) {
        return '<div class="contrib-row">' +
            `<span class="contrib-row-label">${ContributorsPage.#esc(label)}</span>` +
            `<div class="dq-bar-track"><div class="dq-bar" style="width:${(count / max) * 100}%;background:${color}"></div></div>` +
            `<span class="contrib-row-count">${count.toLocaleString()}</span>` +
            '</div>';
    }

    static #pct(frac) { return `${Math.round((frac || 0) * 100)}%`; }

    static #esc(s) {
        return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    #setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    #setStatus(message, isError, hide = false) {
        const status = document.getElementById('contrib-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('error', !!isError);
        status.classList.toggle('hidden', hide);
    }
}
