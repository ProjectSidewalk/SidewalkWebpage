/**
 * Renders this deployment's own engagement funnels on the single-city admin Contributors page (#4379).
 *
 * The per-city counterpart of the cross-city funnels on the Across Cities page (#288): it reads /adminapi/funnels
 * (this schema only) and draws the two funnels — "mapping" (the Explore onboarding flow) and "contribution" (any
 * labeling/validation contribution and finishing a mission) — as horizontal bar funnels, each step normalized to its
 * segment's visitors (= 100%) and labeled with the count and per-step drop-off. A window selector refetches; a
 * breakdown selector (all / registered-vs-anonymous / desktop-vs-mobile) re-renders from cached data. Reuses the
 * shared `.ac-funnel-*` / `.ac-toggle` CSS; no charting library.
 *
 * The set and order of steps come from each funnel's `steps` array in the response — this class only supplies
 * presentational labels — so the funnel shape stays defined by the backend (ConfigService.FunnelDefs).
 */
class FunnelsSection {
  /**
   * Display names for the funnel steps, keyed by the backend step keys. `full` labels the bar rows; `short` is unused
   * here but kept parallel to the Across Cities page for consistency. Covers both funnels.
   */
  static #STEP_LABELS = {
    visited:                { full: 'Visited site' },
    tutorial_started:       { full: 'Started tutorial' },
    tutorial_finished:      { full: 'Finished or skipped tutorial' },
    took_step:              { full: 'Took a step' },
    labeled:                { full: 'Placed a label' },
    mission_completed:      { full: 'Completed a mapping mission' },
    contributed:            { full: 'Labeled or validated' },
    contribution_completed: { full: 'Completed a labeling/validation mission' },
  };

  /** Title + one-line description for each funnel, shown above its bars. Keyed by funnel type. */
  static #FUNNEL_META = {
    mapping:      { title: 'Mapping funnel',
      desc: 'The Explore onboarding flow: tutorial, then walking, labeling, and completing an audit mission.' },
    contribution: { title: 'Contribution funnel',
      desc: 'The broad view: any contribution (labeling or validation) and finishing a mission.' },
  };

  /** Funnel display order on the page. The endpoint may include any subset of these. */
  static #FUNNEL_ORDER = ['mapping', 'contribution'];

  /** Which segment keys (matching the endpoint's per-funnel `segments` object) each breakdown dimension shows. */
  static #DIMS = {
    all:    [{ key: 'all',        label: 'All users' }],
    role:   [{ key: 'registered', label: 'Registered' }, { key: 'anonymous', label: 'Anonymous' }],
    device: [{ key: 'desktop',    label: 'Desktop' }, { key: 'mobile', label: 'Mobile' },
      { key: 'device_unknown', label: 'Unknown' }],
  };

  /** Bar colors by segment position within the active dimension. */
  static #SEG_COLORS = ['#4a90d9', '#e0a800', '#b3b3b3'];

  #funnelsUrl;
  #hostId;
  #statusId;
  #windowToggleId;
  #dimToggleId;

  #funnels = {};          // { mapping: {steps, segments}, contribution: {steps, segments} } for the current window.
  #computedAt = null;     // ISO string of when this city's funnel_stat was last recomputed, or null.
  #window = '30d';        // '30d' | '90d' | 'all'.
  #dim = 'all';           // 'all' | 'role' | 'device'.

  /**
   * @param {{funnelsUrl: string, hostId: string, statusId: string, windowToggleId: string, dimToggleId: string}} opts
   */
  constructor(opts = {}) {
    this.#funnelsUrl = opts.funnelsUrl;
    this.#hostId = opts.hostId;
    this.#statusId = opts.statusId;
    this.#windowToggleId = opts.windowToggleId;
    this.#dimToggleId = opts.dimToggleId;
  }

  async init() {
    this.#wireControls();
    await this.#load();
  }

  /** Wires the window selector (refetches) and the breakdown toggle (re-renders from cached data). */
  #wireControls() {
    const win = document.getElementById(this.#windowToggleId);
    if (win) {
      win.querySelectorAll('.ac-toggle-btn').forEach((btn) => btn.addEventListener('click', () => {
        if (this.#window === btn.dataset.window) return;
        this.#window = btn.dataset.window;
        win.querySelectorAll('.ac-toggle-btn').forEach((b) => b.classList.toggle('active', b === btn));
        this.#load();
      }));
    }
    const dim = document.getElementById(this.#dimToggleId);
    if (dim) {
      dim.querySelectorAll('.ac-toggle-btn').forEach((btn) => btn.addEventListener('click', () => {
        if (this.#dim === btn.dataset.dim) return;
        this.#dim = btn.dataset.dim;
        dim.querySelectorAll('.ac-toggle-btn').forEach((b) => b.classList.toggle('active', b === btn));
        this.#render();
      }));
    }
  }

  /** Fetches the funnels for the current window and renders them; a failure shows a message but leaves the page intact. */
  async #load() {
    this.#setText(this.#statusId, 'Loading funnels…');
    try {
      const data = await this.#fetchJson(`${this.#funnelsUrl}?window=${encodeURIComponent(this.#window)}`);
      this.#funnels = (data && data.funnels) || {};
      this.#computedAt = (data && data.computed_at) || null;
      this.#render();
    } catch (err) {
      console.error('Funnel load failed:', err);
      this.#setText(this.#statusId, 'Could not load funnel data.');
    }
  }

  /** Renders each available funnel (mapping, contribution) for the active breakdown dimension. */
  #render() {
    const host = document.getElementById(this.#hostId);
    if (!host) return;
    const segs = FunnelsSection.#DIMS[this.#dim] || FunnelsSection.#DIMS.all;
    const types = FunnelsSection.#FUNNEL_ORDER.filter((t) => this.#funnels[t]);
    if (!types.length) {
      host.innerHTML = '';
      // No funnel_stat rows yet: the nightly job hasn't run for this deployment, or it was never triggered.
      this.#setText(this.#statusId, 'No funnel data yet — an admin can recompute it via /adminapi/updateFunnelStats.');
      return;
    }
    host.innerHTML = types.map((t) => this.#funnelBlock(t, this.#funnels[t], segs)).join('');
    this.#setText(this.#statusId, this.#computedAt
      ? `Data as of ${this.#formatDate(this.#computedAt)}.`
      : '');
  }

  /**
   * One funnel block: heading, description, optional legend, and the step bars for the active dimension.
   * @param {string} funnelType 'mapping' | 'contribution'.
   * @param {{steps: string[], segments: object}} funnel The funnel's step keys and per-segment data.
   * @param {{key: string, label: string}[]} segs Segments to show for the active dimension.
   * @returns {string} The block's HTML.
   */
  #funnelBlock(funnelType, funnel, segs) {
    const meta = FunnelsSection.#FUNNEL_META[funnelType] || { title: funnelType, desc: '' };
    const steps = funnel.steps || [];
    const segments = funnel.segments || {};
    const palette = FunnelsSection.#SEG_COLORS;

    const legendItems = segs.map((s, i) =>
      `<span class="ac-funnel-legend-item"><span class="ac-funnel-swatch" `
      + `style="background:${palette[i] || palette[0]}"></span>${FunnelsSection.#esc(s.label)}</span>`).join('');
    const legend = segs.length > 1 ? `<div class="ac-funnel-legend">${legendItems}</div>` : '';

    const stepRows = steps.map((k, i) => {
      const full = (FunnelsSection.#STEP_LABELS[k] || { full: k }).full;
      const bars = segs.map((s, si) => {
        const d = segments[s.key];
        const v = d ? d.steps[i] : 0;
        const base = d && d.steps[0] > 0 ? d.steps[0] : 0;
        const width = base > 0 ? (v / base) * 100 : 0;
        const conv = d ? d.step_conversion[i] : 0;
        const valText = i === 0 ? this.#compact(v) : `${this.#compact(v)} · ${this.#pct(conv)}`;
        const title = i === 0
          ? `${FunnelsSection.#esc(full)}: ${this.#num(v)} visitors`
          : `${FunnelsSection.#esc(full)}: ${this.#num(v)} — ${this.#pct(conv)} of previous step`;
        return `
                    <div class="ac-funnel-bar" title="${title}">
                        <span class="ac-funnel-bar-fill"
                              style="width:${width.toFixed(1)}%;background:${palette[si] || palette[0]}"></span>
                        <span class="ac-funnel-bar-val">${valText}</span>
                    </div>`;
      }).join('');
      return `
                <div class="ac-funnel-step">
                    <div class="ac-funnel-step-label">${FunnelsSection.#esc(full)}</div>
                    <div class="ac-funnel-bars">${bars}</div>
                </div>`;
    }).join('');

    return `
            <div class="ac-funnel-block">
                <h3 class="ac-funnel-block-title">${FunnelsSection.#esc(meta.title)}</h3>
                <p class="ac-note">${FunnelsSection.#esc(meta.desc)}</p>
                <div class="ac-funnel-panel">${legend}${stepRows}</div>
            </div>`;
  }

  async #fetchJson(url) {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`Request failed (${resp.status}): ${url}`);
    return resp.json();
  }

  #setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /** Full count with thousands separators, for tooltips. */
  #num(v) {
    return (v || 0).toLocaleString();
  }

  /** Compact count for the on-bar label (e.g. 1.2k), to keep narrow bars legible. */
  #compact(v) {
    const n = v || 0;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
    return `${n}`;
  }

  /** A 0–1 fraction as a rounded percent. */
  #pct(frac) {
    return `${Math.round((frac || 0) * 100)}%`;
  }

  /** ISO timestamp → a short local date string; falls back to the raw value if unparseable. */
  #formatDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  static #esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
