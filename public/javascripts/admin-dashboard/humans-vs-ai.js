/**
 * Renders the admin Humans vs AI page (#4272): the cross-cutting comparison between human and AI contributions across
 * the AI's three roles — labeler, validator, and tagger. Rendered as an accessible HTML/CSS scorecard (no charting
 * library), reusing the dashboard's shared bar/track classes.
 *
 * Data: /adminapi/humanVsAi (labeler/validator/tagger stats, AI group always present so empty states are consistent)
 * plus /v3/api/labelTypes for canonical label-type icons, colors, and display names. Project Sidewalk's AI only lights
 * up the lenses a given deployment uses (e.g. labeler on Vancouver, validator elsewhere); lenses with no AI activity
 * show an explicit empty state rather than misleading all-human bars.
 */
class HumanVsAiPage {
    /** Short, human-friendly names for label types (the v3 API has a machine name + long description, no short label). */
    static #DISPLAY = {
        CurbRamp: 'Curb Ramp', NoCurbRamp: 'Missing Curb Ramp', Obstacle: 'Obstacle',
        SurfaceProblem: 'Surface Problem', NoSidewalk: 'No Sidewalk', Crosswalk: 'Crosswalk',
        Signal: 'Signal', Occlusion: 'Occlusion', Other: 'Other'
    };

    /** Below this many validated labels, an acceptance rate is too noisy to compare, so it's shown muted. */
    static #MIN_VALIDATED = 20;

    /** How many tags each ranked tag list shows. */
    static #TAG_LIMIT = 12;

    #statsUrl;
    #labelTypesUrl;
    #meta = new Map();   // labelType name -> { display, color, icon }

    /** @param {{statsUrl: string, labelTypesUrl: string}} opts */
    constructor(opts = {}) {
        this.#statsUrl = opts.statsUrl;
        this.#labelTypesUrl = opts.labelTypesUrl;
    }

    async init() {
        try {
            const [stats, labelTypes] = await Promise.all([
                this.#fetchJson(this.#statsUrl),
                this.#fetchJson(this.#labelTypesUrl)
            ]);
            this.#buildMeta(labelTypes);

            const human = this.#group(stats.labelers, 'human');
            const ai = this.#group(stats.labelers, 'ai');
            const humanVal = this.#group(stats.validators, 'human');
            const aiVal = this.#group(stats.validators, 'ai');
            const tagger = stats.tagger || {};

            this.#renderKpis(human, ai, humanVal, aiVal, tagger);
            this.#renderSummary(ai, aiVal, tagger);
            this.#renderLabeler(human, ai);
            this.#renderValidator(humanVal, aiVal);
            this.#renderTagger(tagger);

            this.#setStatus('', false, true);
        } catch (err) {
            console.error('Humans vs AI page failed to load:', err);
            this.#setStatus('Could not load the comparison. Please try again.', true);
        }
    }

    async #fetchJson(url) {
        const resp = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!resp.ok) throw new Error(`Request failed (${resp.status}): ${url}`);
        return resp.json();
    }

    /** Builds the canonical label-type lookup (display name, color, icon) from /v3/api/labelTypes. */
    #buildMeta(labelTypes) {
        const list = (labelTypes && labelTypes.label_types) || [];
        for (const lt of list) {
            this.#meta.set(lt.name, {
                display: HumanVsAiPage.#DISPLAY[lt.name] || lt.name,
                color: this.#canonicalColor(lt.name) || lt.color || '#999999',
                icon: lt.small_icon_url || ''
            });
        }
    }

    /** Canonical label-type color via util.misc (falls back to null so the caller can use the API's color). */
    #canonicalColor(labelType) {
        try {
            return (window.util && util.misc && util.misc.getLabelColors(labelType)) || null;
        } catch (e) {
            return null;
        }
    }

    /** Picks one group ("human"/"ai") out of the [human, ai] array, with a zeroed fallback so render code is simple. */
    #group(groups, name) {
        return (groups || []).find(g => g.group === name) ||
            { group: name, total: 0, validated: 0, correct: 0, type_stats: [], severity_counts: [], agree: 0, disagree: 0, unsure: 0 };
    }

    #renderKpis(human, ai, humanVal, aiVal, tagger) {
        const totalLabels = (human.total || 0) + (ai.total || 0);
        const totalVals = (humanVal.total || 0) + (aiVal.total || 0);
        this.#setText('kpi-ai-labels', (ai.total || 0).toLocaleString());
        this.#setText('kpi-ai-labels-note', totalLabels
            ? `${HumanVsAiPage.#pct(ai.total / totalLabels)} of ${totalLabels.toLocaleString()} labels` : 'no labels yet');
        this.#setText('kpi-ai-validations', (aiVal.total || 0).toLocaleString());
        this.#setText('kpi-ai-validations-note', totalVals
            ? `${HumanVsAiPage.#pct(aiVal.total / totalVals)} of ${totalVals.toLocaleString()} validations` : 'no validations yet');
        this.#setText('kpi-ai-assessed', (tagger.labels_assessed || 0).toLocaleString());
        this.#setText('kpi-ai-assessed-note', tagger.avg_confidence != null
            ? `avg confidence ${Math.round(tagger.avg_confidence * 100)}%` : 'no assessments yet');
    }

    /** A one-line, deployment-specific read of which AI roles are actually active here. */
    #renderSummary(ai, aiVal, tagger) {
        const roles = [];
        if ((ai.total || 0) > 0) roles.push('places labels');
        if ((aiVal.total || 0) > 0) roles.push('validates labels');
        if ((tagger.labels_assessed || 0) > 0) roles.push('tags labels');
        const el = document.getElementById('hva-summary');
        if (!el) return;
        el.textContent = roles.length
            ? `On this deployment, the AI ${this.#joinList(roles)}.`
            : 'This deployment has no AI activity yet — every comparison below is human-only.';
    }

    // --- Labeler lens. ---

    #renderLabeler(human, ai) {
        const hasAi = (ai.total || 0) > 0;
        this.#toggle('hva-labeler-empty', !hasAi);
        this.#toggle('hva-labeler-body', hasAi);
        if (!hasAi) return;

        this.#renderTypeMix(human, ai);
        this.#renderAcceptance(human, ai);
        this.#renderSeverity(human, ai);
    }

    /** Labels placed per type, human vs AI, as paired count bars (shared scale across types). */
    #renderTypeMix(human, ai) {
        const types = this.#unionTypes(human, ai);
        const rows = types.map(t => ({
            label: this.#typeLabel(t),
            human: { value: this.#typeCount(human, t) },
            ai: { value: this.#typeCount(ai, t) }
        }));
        document.getElementById('hva-type-mix').innerHTML = this.#pairedBars(rows, { format: 'count' });
    }

    /**
     * Correct-rate (share of validated labels judged correct) per type, human vs AI; muted where there are too few
     * validated labels. Only types with at least one validated label on either side are shown — a type nobody has
     * validated yet has nothing to compare, so it's dropped rather than rendered as empty rows.
     */
    #renderAcceptance(human, ai) {
        const validatedCount = (group, t) => { const s = this.#typeStat(group, t); return (s && s.validated) || 0; };
        const types = this.#unionTypes(human, ai).filter(t => validatedCount(human, t) > 0 || validatedCount(ai, t) > 0);
        const el = document.getElementById('hva-acceptance');
        if (!types.length) {
            el.innerHTML = '<p class="hva-note">No labels have been validated here yet, so there’s nothing to compare.</p>';
            return;
        }
        const rows = types.map(t => ({
            label: this.#typeLabel(t),
            human: this.#acceptanceCell(this.#typeStat(human, t)),
            ai: this.#acceptanceCell(this.#typeStat(ai, t))
        }));
        el.innerHTML = this.#pairedBars(rows, { format: 'rate', max: 100 });
    }

    /** One acceptance datum: percent correct of validated, the N it's based on, and whether N is too small to trust. */
    #acceptanceCell(stat) {
        const validated = (stat && stat.validated) || 0;
        const correct = (stat && stat.correct) || 0;
        if (!validated) return { value: null, note: 'none validated', muted: true };
        return {
            value: Math.round((correct / validated) * 100),
            note: `of ${validated.toLocaleString()} validated`,
            muted: validated < HumanVsAiPage.#MIN_VALIDATED
        };
    }

    /** Severity-rating distribution (1–3), human vs AI, as paired count bars per level. */
    #renderSeverity(human, ai) {
        const level = (g, l) => ((g.severity_counts || []).find(s => s.severity === l) || {}).count || 0;
        const rows = [1, 2, 3].map(l => ({
            label: `Severity ${l}`,
            human: { value: level(human, l) },
            ai: { value: level(ai, l) }
        }));
        const any = rows.some(r => r.human.value || r.ai.value);
        document.getElementById('hva-severity').innerHTML = any
            ? this.#pairedBars(rows, { format: 'count' })
            : '<p class="hva-note">Neither humans nor the AI have rated severity on their labels here.</p>';
    }

    // --- Validator lens. ---

    #renderValidator(human, ai) {
        const hasAi = (ai.total || 0) > 0;
        this.#toggle('hva-validator-empty', !hasAi);
        this.#toggle('hva-validator-body', hasAi);
        if (!hasAi) return;

        document.getElementById('hva-val-volume').innerHTML = this.#pairedBars([{
            label: 'Validations',
            human: { value: human.total || 0 },
            ai: { value: ai.total || 0 }
        }], { format: 'count' });

        document.getElementById('hva-verdicts').innerHTML =
            this.#verdictRow('Humans', human) + this.#verdictRow('AI', ai);
    }

    /** A labelled three-segment agree/disagree/unsure bar for one validator group. */
    #verdictRow(name, g) {
        const agree = g.agree || 0;
        const disagree = g.disagree || 0;
        const unsure = g.unsure || 0;
        const total = agree + disagree + unsure;
        const seg = (value, cls, label) => value
            ? `<span class="contrib-verdictseg ${cls}" style="width:${(value / total) * 100}%" ` +
              `title="${label}: ${value.toLocaleString()} (${Math.round((value / total) * 100)}%)"></span>`
            : '';
        const bar = total
            ? '<span class="contrib-verdictbar">' + seg(agree, 'is-agree', 'Agree') +
              seg(disagree, 'is-disagree', 'Disagree') + seg(unsure, 'is-unsure', 'Unsure') + '</span>'
            : '<span class="dq-sub">—</span>';
        const pcts = total
            ? `<span class="contrib-verdictpct">${Math.round(agree / total * 100)}% / ` +
              `${Math.round(disagree / total * 100)}% / ${Math.round(unsure / total * 100)}%</span>`
            : '';
        return '<div class="hva-verdict-row">' +
            `<span class="hva-verdict-name">${HumanVsAiPage.#esc(name)}</span>` +
            `<span class="contrib-verdictwrap">${bar}${pcts}</span>` +
            `<span class="hva-verdict-n dq-sub">${total.toLocaleString()}</span>` +
            '</div>';
    }

    // --- Tagger lens. ---

    #renderTagger(tagger) {
        const hasAi = (tagger.labels_assessed || 0) > 0;
        this.#toggle('hva-tagger-empty', !hasAi);
        this.#toggle('hva-tagger-body', hasAi);
        if (!hasAi) return;

        const aiTags = (tagger.ai_tags || []).slice(0, HumanVsAiPage.#TAG_LIMIT);
        const humanTags = (tagger.human_tags || []).slice(0, HumanVsAiPage.#TAG_LIMIT);
        // Two ranked lists, each scaled within itself, so the comparison is of tag *mix*, not raw volume (humans have
        // applied vastly more tags overall, which would otherwise dwarf the AI list).
        document.getElementById('hva-tags').innerHTML =
            this.#tagList('AI tagger', aiTags, 'var(--hva-ai, #d55e00)') +
            this.#tagList('Humans', humanTags, 'var(--hva-human, #0072b2)');
    }

    #tagList(title, tags, color) {
        if (!tags.length) {
            return `<div class="hva-taglist"><h4 class="hva-taglist-title">${HumanVsAiPage.#esc(title)}</h4>` +
                '<p class="dq-sub">No tags.</p></div>';
        }
        const max = Math.max(1, ...tags.map(t => t.count || 0));
        const rows = tags.map(t =>
            '<div class="contrib-row">' +
            `<span class="contrib-row-label">${HumanVsAiPage.#esc(t.tag)}</span>` +
            `<div class="dq-bar-track"><div class="dq-bar" style="width:${((t.count || 0) / max) * 100}%;background:${color}"></div></div>` +
            `<span class="contrib-row-count">${(t.count || 0).toLocaleString()}</span>` +
            '</div>').join('');
        return `<div class="hva-taglist"><h4 class="hva-taglist-title">${HumanVsAiPage.#esc(title)}</h4>${rows}</div>`;
    }

    // --- Shared paired-bar rendering (human bar above AI bar per row). ---

    /**
     * Renders rows of paired human/AI bars with a shared legend. For counts, bars share a scale across all rows; for
     * rates, each bar is a percentage of a fixed max (100). A datum may carry a `note` (shown after the value) and a
     * `muted` flag (rendered faded, for too-small samples).
     *
     * @param {Array<{label: string, human: object, ai: object}>} rows - Each side is {value, note?, muted?}.
     * @param {{format: ('count'|'rate'), max?: number}} opts - Render options.
     * @returns {string} Grouped-bar HTML.
     */
    #pairedBars(rows, opts) {
        const isRate = opts.format === 'rate';
        const max = isRate ? (opts.max || 100)
            : Math.max(1, ...rows.flatMap(r => [r.human.value || 0, r.ai.value || 0]));
        const body = rows.map(r =>
            '<div class="hva-group">' +
            `<div class="hva-group-label">${r.label}</div>` +
            '<div class="hva-group-bars">' +
            this.#bar('human', r.human, max, isRate) +
            this.#bar('ai', r.ai, max, isRate) +
            '</div></div>').join('');
        return HumanVsAiPage.#legend() + body;
    }

    /** A single human-or-AI bar within a group: a track, a value label, and an optional note. */
    #bar(side, datum, max, isRate) {
        const value = datum.value;
        const hasValue = value != null;
        const width = hasValue ? (value / max) * 100 : 0;
        const valueText = !hasValue ? '—' : (isRate ? `${value}%` : value.toLocaleString());
        const note = datum.note ? ` <span class="dq-sub">${HumanVsAiPage.#esc(datum.note)}</span>` : '';
        const muted = datum.muted ? ' hva-bar--muted' : '';
        return `<div class="hva-bar hva-bar--${side}${muted}">` +
            `<span class="hva-bar-side">${side === 'ai' ? 'AI' : 'Human'}</span>` +
            `<div class="dq-bar-track"><div class="dq-bar hva-fill--${side}" style="width:${width}%"></div></div>` +
            `<span class="hva-bar-value">${valueText}${note}</span>` +
            '</div>';
    }

    /** Human/AI color legend shown atop each grouped viz. */
    static #legend() {
        return '<div class="hva-legend">' +
            '<span class="hva-legend-item"><span class="hva-swatch hva-fill--human"></span>Human</span>' +
            '<span class="hva-legend-item"><span class="hva-swatch hva-fill--ai"></span>AI</span>' +
            '</div>';
    }

    // --- Label-type helpers. ---

    /** Union of label types appearing in either group, ordered by combined count (desc). */
    #unionTypes(human, ai) {
        const totals = new Map();
        for (const g of [human, ai]) {
            for (const t of (g.type_stats || [])) totals.set(t.label_type, (totals.get(t.label_type) || 0) + (t.count || 0));
        }
        return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    }

    #typeStat(group, type) { return (group.type_stats || []).find(t => t.label_type === type); }
    #typeCount(group, type) { const s = this.#typeStat(group, type); return s ? (s.count || 0) : 0; }

    /** An icon + display-name cell for a label type (icon from /v3/api/labelTypes; canonical color as a fallback dot). */
    #typeLabel(type) {
        const m = this.#meta.get(type) || { display: type, icon: '', color: '#999999' };
        const icon = m.icon
            ? `<img class="dq-icon" src="${m.icon}" alt="" width="18" height="18">`
            : `<span class="hva-dot" style="background:${m.color}"></span>`;
        return `<span class="hva-type">${icon}<span>${HumanVsAiPage.#esc(m.display)}</span></span>`;
    }

    // --- Small utilities. ---

    #joinList(items) {
        if (items.length === 1) return items[0];
        if (items.length === 2) return `${items[0]} and ${items[1]}`;
        return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
    }

    static #pct(frac) { return `${Math.round((frac || 0) * 100)}%`; }

    static #esc(s) {
        return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    #toggle(id, show) {
        const el = document.getElementById(id);
        if (el) el.hidden = !show;
    }

    #setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    #setStatus(message, isError, hide = false) {
        const status = document.getElementById('hva-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('error', !!isError);
        status.classList.toggle('hidden', hide);
    }
}
