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
    { label: '95–100%', max: 100.0001 },
  ];

  /**
   * Colors for the labels-by-role bar, from the Okabe-Ito colorblind-safe palette. Anonymous is a muted grey (it's
   * transient, low-trust traffic); unknown roles fall back to the same grey.
   */
  static #ROLE_COLORS = {
    Registered: '#0072b2',
    Turker: '#e69f00',
    Researcher: '#56b4e9',
    Administrator: '#009e73',
    Owner: '#cc79a7',
    Anonymous: '#999999',
  };

  #userStatsUrl;
  #leaderboardsUrl;

  /** @param {{userStatsUrl: string, leaderboardsUrl: string}} opts */
  constructor(opts = {}) {
    this.#userStatsUrl = opts.userStatsUrl;
    this.#leaderboardsUrl = opts.leaderboardsUrl;
  }

  async init() {
    try {
      // Aggregate charts come from the per-user stats; the two enriched leaderboards come from their own endpoint
      // (which ranks + breaks down server-side, scoped to the top rows).
      const [statsResp, boardsResp] = await Promise.all([
        this.#fetchJson(this.#userStatsUrl),
        this.#fetchJson(this.#leaderboardsUrl),
      ]);
      const users = (statsResp && statsResp.user_stats) || [];
      const labelers = users.filter((u) => (u.labels || 0) > 0);

      this.#renderKpis(labelers);
      this.#renderQualitySplit(labelers);
      this.#renderLabelSource(labelers);
      this.#renderLabelSourceByRole(labelers);
      this.#renderTopLabelers((boardsResp && boardsResp.top_labelers) || []);
      this.#renderTopValidators((boardsResp && boardsResp.top_validators) || []);
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
    const highQ = labelers.filter((u) => u.highQuality).length;
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
    const high = labelers.filter((u) => u.highQuality).length;
    const low = labelers.length - high;
    document.getElementById('contrib-quality').innerHTML = ContributorsPage.#stackedBar([
      { label: 'High-quality', value: high, cls: 'contrib-seg--high' },
      { label: 'Low-quality', value: low, cls: 'contrib-seg--low' },
    ]);
  }

  /** Stacked bar of how many labels come from high- vs low-quality contributors. */
  #renderLabelSource(labelers) {
    const high = labelers.reduce((s, u) => s + (u.highQuality ? (u.labels || 0) : 0), 0);
    const low = labelers.reduce((s, u) => s + (!u.highQuality ? (u.labels || 0) : 0), 0);
    document.getElementById('contrib-label-source').innerHTML = ContributorsPage.#stackedBar([
      { label: 'From high-quality users', value: high, cls: 'contrib-seg--high' },
      { label: 'From low-quality users', value: low, cls: 'contrib-seg--low' },
    ]);
  }

  /**
   * Top labelers leaderboard (ranked + enriched server-side). Beyond volume and trustworthiness, each row shows the
   * labeler's label-type mix (canonical colors) and severity-rating distribution, so lopsided patterns — only one
   * type, or always the same severity — stand out down the column.
   */
  #renderTopLabelers(labelers) {
    const el = document.getElementById('contrib-top-labelers');
    if (!labelers.length) {
      el.innerHTML = '<p class="dq-empty">No labelers yet.</p>';
      return;
    }
    const factor = ContributorsPage.#pctFactor(labelers, 'own_validated_agreed_pct');
    const columns = [
      { label: '#', align: 'right' },
      { label: 'Contributor', align: 'left' },
      { label: 'Role', align: 'left' },
      { label: 'Labels', align: 'right' },
      { label: 'Label types', align: 'left' },
      { label: 'Severity', align: 'left' },
      { label: 'Accuracy', align: 'right' },
      { label: 'Quality', align: 'right' },
    ];
    const rows = labelers.map((u, i) => [
      `${i + 1}`,
      ContributorsPage.#userCell(u),
      ContributorsPage.#esc(u.role || ''),
      (u.labels || 0).toLocaleString(),
      ContributorsPage.#labelTypeBar(u.label_type_counts || []),
      ContributorsPage.#severityDist(u.severity_counts || []),
      ContributorsPage.#accuracyCell(u.own_validated_agreed_pct, u.own_validated, factor),
      ContributorsPage.#qualityBadge(u.high_quality),
    ]);
    el.innerHTML = ContributorsPage.#table(columns, rows);
  }

  /**
   * Top validators leaderboard (ranked + enriched server-side). The verdict bar shows how they vote — agree /
   * disagree / unsure — so an over-harsh (mostly disagree) or unsure-everything validator is obvious; Agreement is
   * how often those verdicts matched the eventual consensus (their accuracy, a separate signal from their tendency).
   */
  #renderTopValidators(validators) {
    const el = document.getElementById('contrib-top-validators');
    if (!validators.length) {
      el.innerHTML = '<p class="dq-empty">No one has validated others’ labels yet.</p>';
      return;
    }
    const factor = ContributorsPage.#pctFactor(validators, 'agreement_pct');
    const columns = [
      { label: '#', align: 'right' },
      { label: 'Contributor', align: 'left' },
      { label: 'Role', align: 'left' },
      { label: 'Validations', align: 'right' },
      { label: 'Verdicts (agree / disagree / unsure)', align: 'left' },
      { label: 'Agreement', align: 'right' },
    ];
    const rows = validators.map((u, i) => [
      `${i + 1}`,
      ContributorsPage.#userCell(u),
      ContributorsPage.#esc(u.role || ''),
      (u.validations || 0).toLocaleString(),
      ContributorsPage.#verdictBar(u.agree || 0, u.disagree || 0, u.unsure || 0),
      ContributorsPage.#accuracyCell(u.agreement_pct, u.validations, factor),
    ]);
    el.innerHTML = ContributorsPage.#table(columns, rows);
  }

  /** Stacked bar of labels by the contributor's account role, largest share first. */
  #renderLabelSourceByRole(labelers) {
    const byRole = new Map();
    for (const u of labelers) byRole.set(u.role, (byRole.get(u.role) || 0) + (u.labels || 0));
    const segments = [...byRole.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([role, value]) => ({ label: role, value, color: ContributorsPage.#ROLE_COLORS[role] || '#999999' }));
    document.getElementById('contrib-label-role').innerHTML = ContributorsPage.#stackedBar(segments);
  }

  /** Histogram of contributors by the agreement rate of their own labels (only those with validated labels). */
  #renderAccuracy(labelers) {
    const rated = labelers.filter((u) => (u.ownValidated || 0) > 0);
    // ownValidatedAgreedPct may be a fraction (0–1) or a percent (0–100); normalize from the observed max.
    const maxVal = rated.reduce((m, u) => Math.max(m, u.ownValidatedAgreedPct || 0), 0);
    const factor = maxVal <= 1 ? 100 : 1;

    const counts = ContributorsPage.#ACCURACY_BUCKETS.map(() => 0);
    for (const u of rated) {
      const acc = (u.ownValidatedAgreedPct || 0) * factor;
      const idx = ContributorsPage.#ACCURACY_BUCKETS.findIndex((b) => acc < b.max);
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
    const max = Math.max(1, ...rows.map((r) => r[1]));
    document.getElementById('contrib-roles').innerHTML = rows.map(([role, count]) =>
      ContributorsPage.#barRow(role, count, max, 'var(--color-asphalt-500, #263238)')).join('');
  }

  /**
   * A stacked bar with a legend (count + share) beneath. Each segment colors via a CSS class (`cls`) or an inline
   * `color` — classes suit the fixed high/low split; inline colors suit the data-driven role palette.
   *
   * @param {Array<{label: string, value: number, cls?: string, color?: string}>} segments - Bar segments.
   * @returns {string} Bar + legend HTML.
   */
  static #stackedBar(segments) {
    const total = segments.reduce((s, x) => s + x.value, 0) || 1;
    const fill = (s) => (s.color ? `;background:${s.color}` : '');
    const segsHtml = segments.map((s) =>
      `<div class="contrib-seg ${s.cls || ''}" style="width:${(s.value / total) * 100}%${fill(s)}"></div>`).join('');
    const legendItems = segments.map((s) => `
            <span class="contrib-legend-item">
                <span class="contrib-swatch ${s.cls || ''}"${s.color ? ` style="background:${s.color}"` : ''}></span>
                ${ContributorsPage.#esc(s.label)} <b>${s.value.toLocaleString()}</b>
                <span class="dq-sub">(${ContributorsPage.#pct(s.value / total)})</span>
            </span>`).join('');
    return `<div class="dq-bar-track dq-stack">${segsHtml}</div><div class="contrib-legend">${legendItems}</div>`;
  }

  /** A label + horizontal bar + count row. */
  static #barRow(label, count, max, color) {
    return `
            <div class="contrib-row">
                <span class="contrib-row-label">${ContributorsPage.#esc(label)}</span>
                <div class="dq-bar-track">
                    <div class="dq-bar" style="width:${(count / max) * 100}%;background:${color}"></div>
                </div>
                <span class="contrib-row-count">${count.toLocaleString()}</span>
            </div>`;
  }

  /**
   * Builds an accessible leaderboard table. Each column declares its label + alignment; right-aligned columns get
   * the `num` class on both header and cells. Cell values are trusted HTML (callers escape user-supplied values).
   *
   * @param {Array<{label: string, align: ('left'|'right')}>} columns - Column specs.
   * @param {Array<string[]>} rows - Row cell HTML, one array per row aligned to `columns`.
   * @returns {string} Table HTML.
   */
  static #table(columns, rows) {
    const cls = (c) => (c.align === 'right' ? ' class="num"' : '');
    const headCells = columns.map((c) =>
      `<th scope="col"${cls(c)}>${ContributorsPage.#esc(c.label)}</th>`).join('');
    const head = `<tr>${headCells}</tr>`;
    const body = rows.map((cells) =>
      `<tr>${cells.map((cell, i) => `<td${cls(columns[i])}>${cell}</td>`).join('')}</tr>`).join('');
    return `<table class="contrib-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  /** Canonical label-type color via util.misc, with a grey fallback for unknown/odd types. */
  static #typeColor(labelType) {
    try {
      return (window.util && util.misc && util.misc.getLabelColors(labelType)) || '#999999';
    } catch {
      return '#999999';
    }
  }

  /**
   * A compact stacked bar of a labeler's label-type mix, each segment in the canonical label-type color, widths
   * proportional to count. Hovering a segment shows the exact type, count, and share.
   *
   * @param {Array<{label_type: string, count: number}>} typeCounts - Per-type counts (already sorted desc).
   * @returns {string} Bar HTML, or an em dash when empty.
   */
  static #labelTypeBar(typeCounts) {
    const total = typeCounts.reduce((s, t) => s + (t.count || 0), 0);
    if (!total) return '<span class="dq-sub">—</span>';
    const segs = typeCounts.map((t) => {
      const pct = Math.round((t.count / total) * 100);
      const title = `${t.label_type}: ${(t.count || 0).toLocaleString()} (${pct}%)`;
      return `<span class="contrib-typeseg" style="width:${(t.count / total) * 100}%;`
        + `background:${ContributorsPage.#typeColor(t.label_type)}" title="${ContributorsPage.#esc(title)}"></span>`;
    }).join('');
    return `<span class="contrib-typebar">${segs}</span>`;
  }

  /**
   * A tiny fixed-domain (severity 1–3) bar chart of a labeler's severity ratings, bar heights proportional to count
   * (within the row). Fixed domain so the distribution shape is comparable down the column; hover shows exact counts.
   *
   * Severity is a 3-point scale (#3306); any legacy out-of-range value is folded into the nearest 1–3 bucket so old
   * data still renders without inventing extra buckets.
   *
   * @param {Array<{severity: number, count: number}>} severityCounts - Per-severity counts.
   * @returns {string} Mini-distribution HTML, or an em dash when empty.
   */
  static #severityDist(severityCounts) {
    const total = severityCounts.reduce((s, x) => s + (x.count || 0), 0);
    if (!total) return '<span class="dq-sub">—</span>';
    const byLevel = new Map([[1, 0], [2, 0], [3, 0]]);
    for (const s of severityCounts) {
      const level = Math.min(3, Math.max(1, s.severity));
      byLevel.set(level, byLevel.get(level) + (s.count || 0));
    }
    const max = Math.max(1, ...byLevel.values());
    const bars = [1, 2, 3].map((level) => {
      const count = byLevel.get(level);
      const pct = Math.round((count / total) * 100);
      const title = `Severity ${level}: ${count.toLocaleString()} (${pct}%)`;
      return `<span class="contrib-sevbar" title="${ContributorsPage.#esc(title)}">`
        + `<span style="height:${Math.round((count / max) * 100)}%"></span></span>`;
    }).join('');
    return `<span class="contrib-sevdist" aria-label="Severity distribution (1 to 3)">${bars}</span>`;
  }

  /**
   * A three-segment verdict bar (agree / disagree / unsure) with the percentages spelled out, so a validator's voting
   * tendency reads at a glance and per-segment hovers give exact counts.
   *
   * @param {number} agree - Agree count.
   * @param {number} disagree - Disagree count.
   * @param {number} unsure - Unsure count.
   * @returns {string} Verdict bar HTML, or an em dash when there are no validations.
   */
  static #verdictBar(agree, disagree, unsure) {
    const total = agree + disagree + unsure;
    if (!total) return '<span class="dq-sub">—</span>';
    const seg = (value, cls, label) => (value
      ? `<span class="contrib-verdictseg ${cls}" style="width:${(value / total) * 100}%" `
      + `title="${label}: ${value.toLocaleString()} (${Math.round((value / total) * 100)}%)"></span>`
      : '');
    const bar = [
      '<span class="contrib-verdictbar">',
      seg(agree, 'is-agree', 'Agree'),
      seg(disagree, 'is-disagree', 'Disagree'),
      seg(unsure, 'is-unsure', 'Unsure'),
      '</span>',
    ].join('');
    const pcts = `<span class="contrib-verdictpct">${Math.round(agree / total * 100)}% / `
      + `${Math.round(disagree / total * 100)}% / ${Math.round(unsure / total * 100)}%</span>`;
    return `<span class="contrib-verdictwrap">${bar}${pcts}</span>`;
  }

  /** A username linking to the user's admin profile (username escaped; both the text and the URL path). */
  static #userCell(u) {
    const name = u.username || u.userId || 'Unknown';
    return `<a href="/admin/user/${encodeURIComponent(name)}">${ContributorsPage.#esc(name)}</a>`;
  }

  /** A high/low-quality pill. */
  static #qualityBadge(highQuality) {
    return highQuality
      ? '<span class="contrib-badge contrib-badge--high">High</span>'
      : '<span class="contrib-badge contrib-badge--low">Low</span>';
  }

  /**
   * Formats an agreement/accuracy percentage with its denominator, e.g. "92% <span>of 120</span>". Returns "—" when
   * there's nothing validated to base it on.
   *
   * @param {number} pct - Raw agreement value (fraction or percent; scaled by `factor`).
   * @param {number} n - Number of validations the percentage is based on.
   * @param {number} factor - 100 if the source value is a 0–1 fraction, else 1.
   * @returns {string} Trusted cell HTML.
   */
  static #accuracyCell(pct, n, factor) {
    if (!(n > 0)) return '—';
    return `${Math.round((pct || 0) * factor)}% <span class="dq-sub">of ${n.toLocaleString()}</span>`;
  }

  /** Picks the 0–1-fraction vs 0–100-percent scale factor for a pct field from its observed max across rows. */
  static #pctFactor(rows, field) {
    const maxVal = rows.reduce((m, u) => Math.max(m, u[field] || 0), 0);
    return maxVal <= 1 ? 100 : 1;
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
    const status = document.getElementById('contrib-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', !!isError);
    status.classList.toggle('hidden', hide);
  }
}
