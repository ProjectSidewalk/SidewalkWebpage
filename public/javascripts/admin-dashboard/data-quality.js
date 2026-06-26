/**
 * Renders the admin Data Quality page (#4272). Answers "how good is the data?" for the current deployment by breaking
 * labels down by type — counts, severity/quality ratings, validation coverage and agreement (with a human-vs-AI
 * toggle), and tag usage. Rendered as an accessible HTML/CSS scorecard (no charting library), so the page stays light.
 *
 * Type metadata is driven by canonical sources rather than hardcoded: the type list + colors + icons come from
 * /v3/api/labelTypes, and behavior (which types carry severity, positive-vs-negative rating scheme, the 1..N rating
 * vocabulary, and the smiley icons) comes from util.misc — the same framework the labeling/validation UIs use. The
 * only intentional literal is a short display-name map, because the API exposes a machine name + long description but
 * no short label.
 */
class DataQualityPage {
    /** Short display names (the v3 labelTypes API has a machine `name` + long `description`, but no short label). */
    static #DISPLAY_NAMES = {
        CurbRamp: 'Curb Ramp',
        NoCurbRamp: 'Missing Curb Ramp',
        Obstacle: 'Obstacle',
        SurfaceProblem: 'Surface Problem',
        NoSidewalk: 'Missing Sidewalk',
        Crosswalk: 'Crosswalk',
        Signal: 'Signal',
        Occlusion: 'Occlusion',
        Other: 'Other'
    };
    static #TOP_TAGS_PER_TYPE = 8;

    #statsUrl;
    #tagsUrl;
    #labelTypesUrl;
    #order = [];           // Canonical label-type order (machine names) from /v3/api/labelTypes.
    #meta = new Map();     // name -> { color, icon, display }
    #validations = null;   // Kept so the validator toggle can re-render without refetching.

    /** @param {{statsUrl: string, tagsUrl: string, labelTypesUrl: string}} opts */
    constructor(opts = {}) {
        this.#statsUrl = opts.statsUrl;
        this.#tagsUrl = opts.tagsUrl;
        this.#labelTypesUrl = opts.labelTypesUrl;
    }

    async init() {
        try {
            const [stats, tags, labelTypes] = await Promise.all([
                this.#fetchJson(this.#statsUrl), this.#fetchJson(this.#tagsUrl), this.#fetchJson(this.#labelTypesUrl)
            ]);

            this.#buildMeta(labelTypes);
            this.#renderKpis(stats);
            this.#renderLabels(stats.labels || {});
            this.#renderSeverity(stats.labels || {});
            this.#validations = stats.validations || {};
            this.#renderCoverage(stats);
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

    /** Builds the canonical type order + color/icon/display lookup from /v3/api/labelTypes. */
    #buildMeta(labelTypes) {
        const list = (labelTypes && labelTypes.label_types) || [];
        this.#order = list.map(lt => lt.name);
        for (const lt of list) {
            this.#meta.set(lt.name, {
                color: lt.color,
                icon: lt.small_icon_url,
                display: DataQualityPage.#DISPLAY_NAMES[lt.name] || lt.name
            });
        }
    }

    #renderKpis(stats) {
        const labels = stats.labels || {};
        // "% with a severity rating" is over labels that CAN carry severity (NoSidewalk/Signal/Occlusion can't), so the
        // denominator is severity-eligible labels — not all labels.
        let eligible = 0;
        let withSeverity = 0;
        for (const type of this.#order) {
            if (!this.#hasSeverity(type)) continue;
            eligible += (labels[type] || {}).count || 0;
            withSeverity += (labels[type] || {}).count_with_severity || 0;
        }
        const combined = (stats.validations || {}).combined || {};
        const overall = combined.Overall || {};
        const agreed = overall.agreed || 0;
        const validated = overall.validated || 0;

        this.#setText('kpi-total-labels', (labels.label_count || 0).toLocaleString());
        this.#setText('kpi-with-severity', eligible ? DataQualityPage.#pct(withSeverity / eligible) : '—');
        this.#setText('kpi-with-severity-note', `${withSeverity.toLocaleString()} of ${eligible.toLocaleString()} eligible labels`);
        this.#setText('kpi-agreement', validated ? DataQualityPage.#pct(agreed / validated) : '—');
        this.#setText('kpi-agreement-note', `${agreed.toLocaleString()} of ${validated.toLocaleString()} validated`);
        this.#setText('kpi-total-validations', (combined.total_validations || 0).toLocaleString());

        // Imagery freshness: overallStats returns a string like "1037 days"; show it in years for readability.
        const ageDays = parseInt(labels.avg_age_of_image_when_labeled, 10);
        this.#setText('kpi-image-age', Number.isFinite(ageDays) ? `${(ageDays / 365.25).toFixed(1)} yr` : '—');
    }

    /** Labels by type: one row per type, bar width relative to the largest count. Sorted by count descending. */
    #renderLabels(labels) {
        const rows = this.#order
            .map(type => ({ type, count: (labels[type] || {}).count || 0 }))
            .filter(r => r.count > 0)
            .sort((a, b) => b.count - a.count);
        const total = rows.reduce((s, r) => s + r.count, 0);
        const max = rows.length ? rows[0].count : 1;

        document.getElementById('dq-labels').innerHTML = rows.map(r => {
            const pct = total ? ` <span class="dq-sub">(${DataQualityPage.#pct(r.count / total)})</span>` : '';
            const bar = `<div class="dq-bar-track"><div class="dq-bar" style="width:${(r.count / max) * 100}%;` +
                `background:${this.#color(r.type)}"></div></div>`;
            return this.#row(r.type, bar, `${r.count.toLocaleString()}${pct}`);
        }).join('');
    }

    /** Severity/quality ratings, split into the two scales (quality for positive features, severity for the rest). */
    #renderSeverity(labels) {
        this.#renderSeverityGroup(labels, true, 'dq-severity-positive', 'dq-sevlegend-positive');
        this.#renderSeverityGroup(labels, false, 'dq-severity-negative', 'dq-sevlegend-negative');
    }

    /**
     * Renders one severity sub-group (positive or negative). Each shows a smiley legend for its 1..N scale and one row
     * per type with a marker at the mean and a ± SD band. Sorted by mean descending (worst first).
     */
    #renderSeverityGroup(labels, positive, containerId, legendId) {
        const rows = this.#order
            .filter(type => this.#hasSeverity(type) && this.#isPositive(type) === positive)
            .map(type => ({ type, ...(labels[type] || {}) }))
            .filter(r => r.severity_mean != null && r.count_with_severity)
            .sort((a, b) => b.severity_mean - a.severity_mean);

        const sampleType = rows.length ? rows[0].type
            : this.#order.find(t => this.#hasSeverity(t) && this.#isPositive(t) === positive);
        document.getElementById(legendId).innerHTML = sampleType ? this.#smileyLegend(sampleType) : '';

        document.getElementById(containerId).innerHTML = rows.map(r => {
            const max = this.#severityMax(r.type);
            const toPct = v => ((Math.max(1, Math.min(max, v)) - 1) / (max - 1)) * 100;
            const sd = r.severity_sd || 0;
            const lo = toPct(r.severity_mean - sd);
            const hi = toPct(r.severity_mean + sd);
            const track =
                '<div class="dq-sev-track">' +
                `<div class="dq-sev-band" style="left:${lo}%;width:${Math.max(0, hi - lo)}%"></div>` +
                `<div class="dq-sev-marker" style="left:${toPct(r.severity_mean)}%;background:${this.#color(r.type)}"></div>` +
                '</div>';
            const words = this.#ratingWords(r.type);
            const level = words[Math.max(0, Math.min(words.length - 1, Math.round(r.severity_mean) - 1))];
            const value = `${r.severity_mean.toFixed(2)} <span class="dq-sub">${level} · ±${sd.toFixed(2)}</span>`;
            return this.#row(r.type, track, value);
        }).join('') || '<p class="dq-empty">No ratings recorded yet.</p>';
    }

    /** Validation coverage by type: share of labels with ≥1 validation, plus a deep-link to validate that type. */
    #renderCoverage(stats) {
        const labels = stats.labels || {};
        const combined = (stats.validations || {}).combined || {};
        const rows = this.#order
            .map(type => {
                const count = (labels[type] || {}).count || 0;
                const validated = (combined[type] || {}).has_a_validation || 0;
                return { type, count, validated, coverage: count ? validated / count : 0 };
            })
            .filter(r => r.count > 0)
            .sort((a, b) => a.coverage - b.coverage);

        document.getElementById('dq-coverage').innerHTML = rows.map(r => {
            const bar = `<div class="dq-bar-track"><div class="dq-bar" style="width:${r.coverage * 100}%;` +
                `background:${this.#color(r.type)}"></div></div>`;
            const value = `${DataQualityPage.#pct(r.coverage)} ` +
                `<span class="dq-sub">(${r.validated.toLocaleString()}/${r.count.toLocaleString()})</span>`;
            // Deep-link straight into validating this label type (admin-gated validate route parses a type name).
            const action = `<a class="dq-validate-btn" href="/adminValidate?labelType=${encodeURIComponent(r.type)}">Validate</a>`;
            return this.#row(r.type, bar, value, action);
        }).join('');
    }

    /** Validation agreement by type for the chosen validator group: stacked agree/disagree bar + agreement %. */
    #renderValidation(group) {
        const data = this.#validations[group] || {};
        const rows = this.#order
            .map(type => ({ type, ...(data[type] || {}) }))
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
            return this.#row(r.type, track, value);
        }).join('');
    }

    /** Tag usage: a small-multiple — one mini ranked horizontal bar chart of top tags per label type. */
    #renderTags(tagCounts) {
        const byType = new Map();
        for (const t of tagCounts) {
            if (!byType.has(t.label_type)) byType.set(t.label_type, []);
            byType.get(t.label_type).push(t);
        }
        const blocks = this.#order
            .filter(type => byType.has(type))
            .map(type => {
                const tags = byType.get(type)
                    .sort((a, b) => b.count - a.count)
                    .slice(0, DataQualityPage.#TOP_TAGS_PER_TYPE);
                const color = this.#color(type);
                const max = tags[0].count || 1; // Bars scale within each type so each small-multiple fills well.
                const bars = tags.map(t =>
                    '<div class="dq-tag-row">' +
                    `<span class="dq-tag-name" title="${DataQualityPage.#esc(t.tag)}">${DataQualityPage.#esc(t.tag)}</span>` +
                    `<div class="dq-bar-track"><div class="dq-bar" style="width:${(t.count / max) * 100}%;background:${color}"></div></div>` +
                    `<span class="dq-tag-count">${t.count.toLocaleString()}</span>` +
                    '</div>').join('');
                const head =
                    `<div class="dq-tag-head"><img class="dq-icon" src="${this.#icon(type)}" alt="" width="20" ` +
                    `height="20"><span class="dq-name">${this.#name(type)}</span></div>`;
                return `<div class="dq-tag-group">${head}<div class="dq-tag-bars">${bars}</div></div>`;
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

    /** Smiley legend for a 1..N rating scale, using the type's positive/negative icon set and vocabulary. */
    #smileyLegend(type) {
        const words = this.#ratingWords(type);
        return words.map((word, i) =>
            `<span class="dq-smiley"><img src="${this.#smiley(i + 1, type)}" alt="" width="18" height="18">${word}</span>`
        ).join('');
    }

    /** Builds a scorecard row: icon + color swatch + name + a chart cell + value, with an optional trailing action. */
    #row(type, chartHtml, valueHtml, actionHtml = '') {
        return `<div class="dq-row${actionHtml ? ' dq-row--action' : ''}">` +
            `<img class="dq-icon" src="${this.#icon(type)}" alt="" width="20" height="20">` +
            `<span class="dq-swatch" style="background:${this.#color(type)}"></span>` +
            `<span class="dq-name">${this.#name(type)}</span>` +
            `<div class="dq-chart">${chartHtml}</div>` +
            `<span class="dq-value">${valueHtml}</span>` +
            (actionHtml ? `<div class="dq-action">${actionHtml}</div>` : '') +
            '</div>';
    }

    // --- Canonical metadata accessors (from /v3/api/labelTypes). ---
    #color(type) { return (this.#meta.get(type) || {}).color || '#888'; }
    #icon(type) { return (this.#meta.get(type) || {}).icon || ''; }
    #name(type) { return (this.#meta.get(type) || {}).display || type; }

    // --- Behavior from util.misc (the shared label-type framework, loaded by the shell). ---
    #isPositive(type) { return util.misc.isPositiveLabelType(type); }
    #hasSeverity(type) { return util.misc.labelTypeHasSeverity(type); }
    #severityMax(type) { return Object.keys(util.misc.getRatingLevelKeys(type)).length; }
    #ratingWords(type) {
        return Object.values(util.misc.getRatingLevelKeys(type)).map(w => w.charAt(0).toUpperCase() + w.slice(1));
    }
    #smiley(severity, type) { return util.misc.getSmileyIconPath(severity, type, true); }

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
