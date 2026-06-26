/**
 * Renders the admin Data Quality page (#4272). Answers "how good is the data?" for the current deployment by
 * breaking labels down by type — counts, severity (mean ± SD), validation agreement (with a human-vs-AI toggle),
 * and tag usage — always using the official label-type colors and icons (via util.misc). Data comes from the per-city
 * v3 overallStats endpoint plus the label tag counts; rendered as an accessible HTML/CSS scorecard (no charting
 * library needed), so the page stays light.
 */
class DataQualityPage {
    /** Canonical display order and human-readable names for the label types. */
    static #TYPES = [
        ['CurbRamp', 'Curb Ramp'],
        ['NoCurbRamp', 'Missing Curb Ramp'],
        ['Obstacle', 'Obstacle'],
        ['SurfaceProblem', 'Surface Problem'],
        ['NoSidewalk', 'Missing Sidewalk'],
        ['Crosswalk', 'Crosswalk'],
        ['Signal', 'Signal'],
        ['Occlusion', 'Occlusion'],
        ['Other', 'Other']
    ];
    static #NAME = new Map(DataQualityPage.#TYPES);
    static #TOP_TAGS_PER_TYPE = 8;

    #statsUrl;
    #tagsUrl;
    #validations = null; // { combined, human, ai } kept so the validator toggle can re-render without refetching.

    /** @param {{statsUrl: string, tagsUrl: string}} opts */
    constructor(opts = {}) {
        this.#statsUrl = opts.statsUrl;
        this.#tagsUrl = opts.tagsUrl;
    }

    async init() {
        try {
            const [stats, tags] = await Promise.all([this.#fetchJson(this.#statsUrl), this.#fetchJson(this.#tagsUrl)]);

            this.#renderKpis(stats);
            this.#renderLabels(stats.labels || {});
            this.#renderSeverity(stats.labels || {});
            this.#validations = stats.validations || {};
            this.#renderValidation('combined');
            this.#wireValidatorToggle();
            this.#renderTags(Array.isArray(tags) ? tags : []);

            this.#setStatus('', false, true);
        } catch (err) {
            console.error('Data Quality page failed to load:', err);
            this.#setStatus('Could not load data quality metrics. Please try again.', true);
        }
    }

    async #fetchJson(url) {
        const resp = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!resp.ok) throw new Error(`Request failed (${resp.status}): ${url}`);
        return resp.json();
    }

    #renderKpis(stats) {
        const labels = stats.labels || {};
        const total = labels.label_count || 0;
        const withSeverity = labels.label_count_with_severity || 0;
        const overall = (stats.validations?.combined || {}).Overall || {};
        const agreement = overall.validated ? overall.agreed / overall.validated : null;

        this.#setText('kpi-total-labels', total.toLocaleString());
        this.#setText('kpi-with-severity', total ? DataQualityPage.#pct(withSeverity / total) : '—');
        this.#setText('kpi-agreement', agreement === null ? '—' : DataQualityPage.#pct(agreement));
        this.#setText('kpi-total-validations', ((stats.validations?.combined || {}).total_validations || 0).toLocaleString());
    }

    /** Labels by type: one row per type, bar width relative to the largest count. Sorted by count descending. */
    #renderLabels(labels) {
        const rows = DataQualityPage.#TYPES
            .map(([type]) => ({ type, count: (labels[type] || {}).count || 0 }))
            .filter(r => r.count > 0)
            .sort((a, b) => b.count - a.count);
        const total = rows.reduce((s, r) => s + r.count, 0);
        const max = rows.length ? rows[0].count : 1;

        document.getElementById('dq-labels').innerHTML = rows.map(r => {
            const pct = total ? ` <span class="dq-sub">(${DataQualityPage.#pct(r.count / total)})</span>` : '';
            const bar = `<div class="dq-bar-track"><div class="dq-bar" style="width:${(r.count / max) * 100}%;` +
                `background:${DataQualityPage.#color(r.type)}"></div></div>`;
            return DataQualityPage.#row(r.type, bar, `${r.count.toLocaleString()}${pct}`);
        }).join('');
    }

    /** Severity by type: a 1–5 track with a ± SD band and a marker at the mean. Sorted by mean descending. */
    #renderSeverity(labels) {
        const rows = DataQualityPage.#TYPES
            .map(([type]) => ({ type, ...(labels[type] || {}) }))
            .filter(r => r.severity_mean != null && r.count_with_severity)
            .sort((a, b) => b.severity_mean - a.severity_mean);

        const toPct = v => ((Math.max(1, Math.min(5, v)) - 1) / 4) * 100;
        document.getElementById('dq-severity').innerHTML = rows.map(r => {
            const sd = r.severity_sd || 0;
            const lo = toPct(r.severity_mean - sd);
            const hi = toPct(r.severity_mean + sd);
            const track =
                '<div class="dq-sev-track">' +
                `<div class="dq-sev-band" style="left:${lo}%;width:${Math.max(0, hi - lo)}%"></div>` +
                `<div class="dq-sev-marker" style="left:${toPct(r.severity_mean)}%;background:${DataQualityPage.#color(r.type)}"></div>` +
                '</div>';
            const value = `${r.severity_mean.toFixed(2)} <span class="dq-sub">± ${sd.toFixed(2)}</span>`;
            return DataQualityPage.#row(r.type, track, value);
        }).join('');
    }

    /** Validation agreement by type for the chosen validator group: stacked agree/disagree bar + agreement %. */
    #renderValidation(group) {
        const data = this.#validations[group] || {};
        const rows = DataQualityPage.#TYPES
            .map(([type]) => ({ type, ...(data[type] || {}) }))
            .filter(r => r.validated > 0)
            .sort((a, b) => (b.agreed / b.validated) - (a.agreed / a.validated));

        const container = document.getElementById('dq-validation');
        if (rows.length === 0) {
            container.innerHTML = '<p class="dq-empty">No validations recorded for this validator group.</p>';
            return;
        }
        container.innerHTML = rows.map(r => {
            const agreePct = (r.agreed / r.validated) * 100;
            const disagreePct = (r.disagreed / r.validated) * 100;
            const track =
                '<div class="dq-bar-track dq-stack">' +
                `<div class="dq-bar-agree" style="width:${agreePct}%"></div>` +
                `<div class="dq-bar-disagree" style="width:${disagreePct}%"></div>` +
                '</div>';
            const value = `${DataQualityPage.#pct(r.agreed / r.validated)} ` +
                `<span class="dq-sub">(${r.agreed.toLocaleString()}/${r.validated.toLocaleString()})</span>`;
            return DataQualityPage.#row(r.type, track, value);
        }).join('');
    }

    /** Tag usage: per label type, the most-used tags as count-labeled chips tinted with the type's color. */
    #renderTags(tagCounts) {
        const byType = new Map();
        for (const t of tagCounts) {
            if (!byType.has(t.label_type)) byType.set(t.label_type, []);
            byType.get(t.label_type).push(t);
        }
        const blocks = DataQualityPage.#TYPES
            .filter(([type]) => byType.has(type))
            .map(([type]) => {
                const tags = byType.get(type)
                    .sort((a, b) => b.count - a.count)
                    .slice(0, DataQualityPage.#TOP_TAGS_PER_TYPE);
                const color = DataQualityPage.#color(type);
                const chips = tags.map(t =>
                    `<span class="dq-chip" style="border-color:${color}">${DataQualityPage.#esc(t.tag)} ` +
                    `<b>${t.count.toLocaleString()}</b></span>`).join('');
                const head =
                    `<div class="dq-tag-head"><img class="dq-icon" src="${DataQualityPage.#icon(type)}" alt="" ` +
                    `width="20" height="20"><span class="dq-name">${DataQualityPage.#NAME.get(type)}</span></div>`;
                return `<div class="dq-tag-group">${head}<div class="dq-tag-chips">${chips}</div></div>`;
            });
        document.getElementById('dq-tags').innerHTML = blocks.join('') ||
            '<p class="dq-empty">No tags recorded yet.</p>';
    }

    #wireValidatorToggle() {
        const buttons = document.querySelectorAll('.dq-validator-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.classList.contains('active')) return;
                buttons.forEach(b => {
                    const isTarget = b === btn;
                    b.classList.toggle('active', isTarget);
                    b.setAttribute('aria-pressed', String(isTarget));
                });
                this.#renderValidation(btn.dataset.validator);
            });
        });
    }

    /** Builds a standard scorecard row: icon + color swatch + name + a chart cell + a value cell. */
    static #row(type, chartHtml, valueHtml) {
        return '<div class="dq-row">' +
            `<img class="dq-icon" src="${DataQualityPage.#icon(type)}" alt="" width="20" height="20">` +
            `<span class="dq-swatch" style="background:${DataQualityPage.#color(type)}"></span>` +
            `<span class="dq-name">${DataQualityPage.#NAME.get(type)}</span>` +
            `<div class="dq-chart">${chartHtml}</div>` +
            `<span class="dq-value">${valueHtml}</span>` +
            '</div>';
    }

    static #color(type) {
        return (window.util && util.misc) ? util.misc.getLabelColors(type) : '#888';
    }

    static #icon(type) {
        const paths = (window.util && util.misc) ? util.misc.getIconImagePaths(type) : null;
        return paths ? paths.iconImagePath : '';
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
        const status = document.getElementById('dq-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('error', !!isError);
        status.classList.toggle('hidden', hide);
    }
}
