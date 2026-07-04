/**
 * Renders the admin Overview landing page (#4272): the at-a-glance snapshot that routes into the six detailed pages.
 * A "needs attention" panel of deep-linked action items, one KPI card per lens (each with a week-over-week trend and a
 * sparkline), a live recent-activity strip, and a "latest activity" pulse line. Built as a plain HTML/CSS scorecard
 * with tiny inline-SVG sparklines (no charting library) — it introduces no new analysis, only headline numbers,
 * trends, and deep links.
 *
 * Data: /adminapi/overviewSummary (headline numbers + attention counts), /adminapi/activityByDay (daily series →
 * weekly trends/sparklines), /adminapi/recentActivity (the strip + pulse), and /v3/api/labelTypes (pulse dot color).
 * Every percentage is shown with the N it's based on.
 */
class OverviewPage {
  /** Short, human-friendly label-type names (the v3 API exposes a machine name + long description, no short label). */
  static #DISPLAY = {
    CurbRamp: 'curb ramp', NoCurbRamp: 'missing curb ramp', Obstacle: 'obstacle',
    SurfaceProblem: 'surface problem', NoSidewalk: 'no sidewalk', Crosswalk: 'crosswalk',
    Signal: 'signal', Occlusion: 'occlusion', Other: 'other',
  };

  /** Number of trailing weeks shown in each card sparkline. */
  static #SPARK_WEEKS = 12;

  #summaryUrl;
  #activityByDayUrl;
  #recentActivityUrl;
  #labelTypesUrl;
  #colorByType = new Map();   // labelType name -> canonical color (for the pulse dot)

  /** @param {{summaryUrl: string, activityByDayUrl: string, recentActivityUrl: string, labelTypesUrl: string}} opts */
  constructor(opts = {}) {
    this.#summaryUrl = opts.summaryUrl;
    this.#activityByDayUrl = opts.activityByDayUrl;
    this.#recentActivityUrl = opts.recentActivityUrl;
    this.#labelTypesUrl = opts.labelTypesUrl;
  }

  async init() {
    try {
      // Only the summary is required; the trend/strip/colors are enhancements, so they degrade gracefully.
      const [summary, activity, recent, labelTypes] = await Promise.all([
        this.#fetchJson(this.#summaryUrl),
        this.#fetchJson(this.#activityByDayUrl).catch(() => ({ series: [] })),
        this.#fetchJson(this.#recentActivityUrl).catch(() => ({ activity: [] })),
        this.#fetchJson(this.#labelTypesUrl).catch(() => null),
      ]);
      this.#buildColors(labelTypes);
      this.#renderCards(summary);
      this.#renderTrends((activity && activity.series) || []);
      this.#renderAttention(summary);
      this.#renderRecent((recent && recent.activity) || []);
      this.#renderPulse(summary.last_activity);
    } catch (err) {
      console.error('Overview page failed to load:', err);
      this.#setText('ov-pulse', 'Could not load the snapshot. Please try again.');
      this.#setText('ov-status', 'Could not load the snapshot. Please try again.');
    }
  }

  async #fetchJson(url) {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`Request failed (${resp.status}): ${url}`);
    return resp.json();
  }

  /** Builds the label-type → canonical color lookup used only for the pulse line's dot. */
  #buildColors(labelTypes) {
    const list = (labelTypes && labelTypes.label_types) || [];
    for (const lt of list) {
      let color = lt.color || '#999999';
      try {
        if (window.util && util.misc && util.misc.getLabelColors(lt.name)) color = util.misc.getLabelColors(lt.name);
      } catch { /* fall back to the API color */ }
      this.#colorByType.set(lt.name, color);
    }
  }

  // --- KPI cards --------------------------------------------------------------------------------------------------

  /** Fills each lens card's headline value and secondary line from the summary payload. */
  #renderCards(s) {
    // Coverage: share of the street network audited, with the distance/street denominators.
    const covPct = s.total_distance_mi > 0 ? s.audited_distance_mi / s.total_distance_mi : 0;
    this.#setCard('coverage', this.#pct(covPct), s.total_distance_mi > 0
      ? `${this.#mi(s.audited_distance_mi)} of ${this.#mi(s.total_distance_mi)} mi · `
      + `${this.#num(s.audited_streets)} of ${this.#num(s.total_streets)} streets`
      : 'no streets loaded');

    // Data Quality: labels collected, with validations as the secondary figure.
    this.#setCard('quality', this.#compact(s.total_labels),
      `labels · ${this.#compact(s.total_validations)} validations`, this.#num(s.total_labels));

    // Contributors: distinct accounts that have produced any data.
    this.#setCard('contributors', this.#compact(s.contributors), 'contributing accounts', this.#num(s.contributors));

    // Activity: last-7-days pulse; the headline is labels, the sub adds validations and streets.
    this.#setCard('activity', this.#compact(s.labels_past_week),
      `labels · ${this.#compact(s.validations_past_week)} validations · `
      + `${this.#compact(s.audits_past_week)} streets (last 7 days)`, this.#num(s.labels_past_week));

    // Humans vs AI: the AI's share in the role it's most active in, with the other role + tagger in the sub.
    this.#renderHvaCard(s);

    // API Analytics: external (non-docs) calls in the trailing window, with unique clients.
    const days = s.api_window_days || 30;
    this.#setCard('api', this.#compact(s.api_calls_external),
      `external calls · ${this.#num(s.api_unique_clients)} clients (last ${days} days)`,
      this.#num(s.api_calls_external));
  }

  /** Humans-vs-AI card: leads with whichever role the AI does more of; shows an explicit empty state otherwise. */
  #renderHvaCard(s) {
    const aiActivity = (s.ai_labels || 0) + (s.ai_validations || 0) + (s.ai_assessments || 0);
    if (aiActivity === 0) {
      this.#setCard('hva', '—', 'no AI activity on this deployment');
      return;
    }
    const labelTot = (s.human_labels || 0) + (s.ai_labels || 0);
    const valTot = (s.human_validations || 0) + (s.ai_validations || 0);
    const aiLabelPct = labelTot > 0 ? s.ai_labels / labelTot : 0;
    const aiValPct = valTot > 0 ? s.ai_validations / valTot : 0;

    const labelLed = aiLabelPct >= aiValPct;
    const headline = labelLed ? aiLabelPct : aiValPct;
    const subParts = [labelLed ? 'of labels are AI' : 'of validations are AI'];
    if (labelLed && valTot > 0) subParts.push(`${this.#pct(aiValPct)} of validations`);
    else if (!labelLed && labelTot > 0) subParts.push(`${this.#pct(aiLabelPct)} of labels`);
    if (s.ai_assessments > 0) subParts.push(`${this.#compact(s.ai_assessments)} tagged`);
    this.#setCard('hva', this.#pct(headline), subParts.join(' · '));
  }

  // --- Trends + sparklines ----------------------------------------------------------------------------------------

  /**
     * Renders the week-over-week trend and sparkline on the four cards that have a meaningful weekly flow, from the
     * daily activity series. Each spec maps a card to the per-day metric that drives its trend.
     *
     * @param {Array<object>} series - Daily records from /adminapi/activityByDay (date + per-metric counts).
     */
  #renderTrends(series) {
    if (!series.length) return;
    const specs = [
      { key: 'coverage', get: (r) => r.audits || 0, unit: 'streets' },
      { key: 'quality', get: (r) => r.labels || 0, unit: 'labels' },
      { key: 'contributors', get: (r) => r.new_users || 0, unit: 'new' },
      { key: 'activity', get: (r) => (r.labels || 0) + (r.validations || 0) + (r.audits || 0), unit: 'actions' },
    ];
    const byDate = new Map(series.map((r) => [r.date, r]));
    const today = this.#startOfDay(new Date());
    for (const sp of specs) {
      const buckets = this.#weeklyBuckets(byDate, today, sp.get);
      const host = document.getElementById(`ov-${sp.key}-spark`);
      if (host) host.innerHTML = this.#sparkline(buckets.values);
      this.#renderTrend(sp.key, buckets.thisWeek, buckets.priorWeek, sp.unit);
    }
  }

  /**
     * Sums a per-day metric into trailing 7-day buckets ending today.
     *
     * @param {Map<string, object>} byDate - Day (YYYY-MM-DD) → record.
     * @param {Date} today - Local start-of-today, the right edge of the most recent bucket.
     * @param {function(object): number} get - Extracts the metric from a record.
     * @returns {{values: number[], thisWeek: number, priorWeek: number}} Weekly sums oldest→newest plus the last two.
     */
  #weeklyBuckets(byDate, today, get) {
    const values = [];
    for (let b = OverviewPage.#SPARK_WEEKS - 1; b >= 0; b--) {
      const end = this.#addDays(today, -b * 7);
      const start = this.#addDays(end, -6);
      let sum = 0;
      for (let d = 0; d < 7; d++) {
        const rec = byDate.get(this.#isoDay(this.#addDays(start, d)));
        if (rec) sum += get(rec);
      }
      values.push(sum);
    }
    return { values, thisWeek: values[values.length - 1], priorWeek: values[values.length - 2] || 0 };
  }

  /** Sets a card's trend line: a direction arrow, this-week total, and unit, colored by direction vs last week. */
  #renderTrend(key, thisWeek, priorWeek, unit) {
    const el = document.getElementById(`ov-${key}-trend`);
    if (!el) return;
    const delta = thisWeek - priorWeek;
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '→';
    el.className = `ov-card-trend ov-trend--${dir}`;
    el.textContent = `${arrow} ${thisWeek.toLocaleString()} ${unit} this week`;
    el.title = `${thisWeek.toLocaleString()} this week vs ${priorWeek.toLocaleString()} last week`;
  }

  /**
     * A compact inline-SVG sparkline (line only, no axes) for a weekly series. Stroke stays crisp under the non-uniform
     * stretch via vector-effect, and the last point is dotted so "now" is easy to find.
     *
     * @param {number[]} values - Weekly sums, oldest → newest.
     * @returns {string} An <svg> string, or '' when there's too little data to draw.
     */
  #sparkline(values) {
    const present = values.filter((v) => v !== null && v !== undefined);
    if (present.length < 2) return '';
    const W = 200;
    const H = 36;
    const pad = 3;
    const max = Math.max(...present);
    const min = Math.min(...present, 0);
    const range = max - min || 1;
    const n = values.length;
    const x = (i) => pad + (i / (n - 1)) * (W - 2 * pad);
    const y = (v) => pad + (1 - (v - min) / range) * (H - 2 * pad);
    let d = '';
    let move = true;
    values.forEach((v, i) => {
      if (v === null || v === undefined) {
        move = true;
        return;
      }
      d += `${move ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      move = false;
    });
    const lastV = values[n - 1];
    const dot = lastV !== null && lastV !== undefined
      ? `<circle class="ov-spark-dot" cx="${x(n - 1).toFixed(1)}" cy="${y(lastV).toFixed(1)}" r="2.4"/>`
      : '';
    return `<svg class="ov-spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-hidden="true">`
      + `<path class="ov-spark-line" d="${d.trim()}" vector-effect="non-scaling-stroke"/>${dot}</svg>`;
  }

  // --- Needs attention --------------------------------------------------------------------------------------------

  /**
     * Builds the "needs attention" panel: a short list of deep-linked action items computed from the summary. Shows an
     * "all clear" note when nothing is flagged.
     *
     * @param {object} s - The overview summary payload.
     */
  #renderAttention(s) {
    const el = document.getElementById('ov-attention');
    if (!el) return;
    const items = [];

    if (s.labels_awaiting_validation > 0) {
      items.push({ sev: 'warn', action: 'Validate', href: '/adminValidate',
        html: `<strong>${this.#num(s.labels_awaiting_validation)}</strong> labels haven't been validated yet` });
    }
    if (s.low_quality_users > 0) {
      items.push({ sev: 'warn', action: 'Review', href: '/admin/contributors',
        html: `<strong>${this.#num(s.low_quality_users)}</strong> contributors are flagged low-quality` });
    }
    const streetsLeft = (s.total_streets || 0) - (s.audited_streets || 0);
    if (streetsLeft > 0) {
      const pctLeft = s.total_streets > 0 ? Math.round((streetsLeft / s.total_streets) * 100) : 0;
      items.push({ sev: 'info', action: 'Coverage', href: '/admin/coverage',
        html: `<strong>${this.#num(streetsLeft)}</strong> streets aren't audited yet (${pctLeft}% of the network)` });
    }
    // Stalled activity — only one of these, the more fundamental gap first.
    if (s.audits_past_week === 0) {
      items.push({ sev: 'warn', action: 'Activity', href: '/admin/activity',
        html: 'No streets have been audited in the past 7 days' });
    } else if (s.labels_past_week === 0) {
      items.push({ sev: 'warn', action: 'Activity', href: '/admin/activity',
        html: 'No labels have been placed in the past 7 days' });
    }

    if (!items.length) {
      el.innerHTML = '<p class="ov-attention-clear">All clear — nothing needs attention right now. ✅</p>';
      return;
    }
    el.innerHTML = items.map((it) => `
            <a class="ov-attention-item ov-attention--${it.sev}" href="${OverviewPage.#esc(it.href)}">
                <span class="ov-attention-dot" aria-hidden="true"></span>
                <span class="ov-attention-text">${it.html}</span>
                <span class="ov-attention-go">${OverviewPage.#esc(it.action)} →</span>
            </a>`,
    ).join('');
  }

  // --- Recent-activity strip --------------------------------------------------------------------------------------

  /**
     * Renders the live recent-activity strip: the newest contributions with their preview thumbnails.
     *
     * @param {Array<object>} items - Recent-activity items (newest first) from /adminapi/recentActivity.
     */
  #renderRecent(items) {
    const el = document.getElementById('ov-recent');
    if (!el) return;
    if (!items.length) {
      el.innerHTML = '<p class="dq-empty">No recent activity recorded on this deployment.</p>';
      return;
    }
    el.innerHTML = items.map((it) => {
      const thumb = it.thumbnail_url
        ? `<img class="ov-recent-thumb" loading="lazy" alt="" src="${OverviewPage.#esc(it.thumbnail_url)}">`
        : '<span class="ov-recent-thumb ov-recent-thumb--none" aria-hidden="true"></span>';
      const who = OverviewPage.#esc(it.username || 'someone');
      const when = OverviewPage.#esc(OverviewPage.#relativeTime(it.timestamp));
      return [
        '<div class="ov-recent-item">',
        thumb,
        '<div class="ov-recent-body">',
        `<div class="ov-recent-text">${this.#recentText(it)}</div>`,
        `<div class="ov-recent-meta">${who} · ${when}</div>`,
        '</div></div>',
      ].join('');
    }).join('');
    el.querySelectorAll('img.ov-recent-thumb').forEach((img) => {
      img.addEventListener('error', () => img.classList.add('is-broken'), { once: true });
    });
  }

  /** The action phrase for a recent item, with the label type bolded. */
  #recentText(it) {
    const type = it.label_type ? `<strong>${OverviewPage.#esc(this.#typeName(it.label_type))}</strong>` : 'a label';
    if (it.activity_type === 'label') return `Placed ${type}`;
    if (it.activity_type === 'validation') {
      const verdict = { Agree: 'agreed', Disagree: 'disagreed', Unsure: 'unsure' }[it.validation_result]
        || OverviewPage.#esc((it.validation_result || '').toLowerCase());
      return `Validated ${type} — ${verdict}`;
    }
    return `“${OverviewPage.#esc(it.comment || '')}”`;
  }

  // --- Pulse ------------------------------------------------------------------------------------------------------

  /**
     * Renders the "latest activity" pulse line at the top of the page from the single most-recent contribution.
     *
     * @param {?object} item - A recent-activity item or null.
     */
  #renderPulse(item) {
    const el = document.getElementById('ov-pulse');
    if (!el) return;
    if (!item) {
      el.textContent = 'No recent activity recorded on this deployment.';
      return;
    }
    const who = OverviewPage.#esc(item.username || 'someone');
    const when = OverviewPage.#esc(OverviewPage.#relativeTime(item.timestamp));
    const type = item.label_type ? this.#typeName(item.label_type) : null;
    let dot = '';
    if (type && this.#colorByType.has(item.label_type)) {
      dot = `<span class="ov-pulse-dot" style="background:${OverviewPage.#esc(this.#colorByType.get(item.label_type))}" aria-hidden="true"></span>`;
    }
    let what;
    if (item.activity_type === 'label') {
      what = `placed a <strong>${OverviewPage.#esc(type || 'label')}</strong> label`;
    } else if (item.activity_type === 'validation') {
      const verdict = item.validation_result ? ` (${OverviewPage.#esc(item.validation_result.toLowerCase())})` : '';
      what = `validated a <strong>${OverviewPage.#esc(type || 'label')}</strong>${verdict}`;
    } else {
      what = 'left a comment';
    }
    el.innerHTML = `${dot}Most recent: <strong>${who}</strong> ${what} · ${when}`;
  }

  // --- Helpers ----------------------------------------------------------------------------------------------------

  #typeName(machineName) {
    return OverviewPage.#DISPLAY[machineName] || machineName;
  }

  /**
     * Sets a card's headline value and secondary line.
     *
     * @param {string} key - Card key (matches the `ov-<key>-value` / `ov-<key>-sub` element ids).
     * @param {string} value - Headline text.
     * @param {string} sub - Secondary line text.
     * @param {string} [titleFull] - Optional full-precision value for the headline's title tooltip.
     */
  #setCard(key, value, sub, titleFull) {
    const valEl = document.getElementById(`ov-${key}-value`);
    const subEl = document.getElementById(`ov-${key}-sub`);
    if (valEl) {
      valEl.textContent = value;
      if (titleFull) valEl.title = titleFull;
    }
    if (subEl) subEl.textContent = sub;
  }

  #setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /** Full number with thousands separators ("1,234,567"). */
  #num(n) {
    return (n ?? 0).toLocaleString();
  }

  /** Compact number for card headlines ("1.2M", "317k", "842"). */
  #compact(n) {
    const v = n ?? 0;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
    return v.toLocaleString();
  }

  /** Whole-mile string ("17", "1,240"). */
  #mi(n) {
    return Math.round(n ?? 0).toLocaleString();
  }

  /** Percentage with no decimals ("47%"). */
  #pct(fraction) {
    return `${Math.round((fraction || 0) * 100)}%`;
  }

  // Local-time date math for weekly bucketing.
  #startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  #addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  #isoDay(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  static #esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
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
