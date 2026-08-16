/**
 * The "Recently changed" section of the admin Street Status page (#4928).
 *
 * The map and table above it are a snapshot: they answer what the city looks like now, and cannot answer what changed
 * or when. This renders the three weekly series that can — streets moving between statuses, labeler reports of
 * missing imagery, and panos whose imagery went away — plus the queue of streets several different labelers have
 * independently reported, which is what the offline imagery checker should be pointed at next.
 *
 * Fetches its own endpoint so a failure here leaves the snapshot above intact. Admin-only surface, English only.
 */
class StreetStatusTrend {
  #trendUrl;
  #weeks;
  #loading = false;

  /**
   * @param {Object} opts
   * @param {string} opts.trendUrl - URL of the trend JSON endpoint, without the `weeks` parameter.
   * @param {number} [opts.weeks=26] - Initial window size in weeks.
   */
  constructor(opts = {}) {
    this.#trendUrl = opts.trendUrl;
    this.#weeks = opts.weeks || 26;
  }

  /** Loads the initial window and wires the range selector. */
  async init() {
    const range = document.getElementById('trend-range');
    if (range) {
      range.value = String(this.#weeks);
      range.addEventListener('change', () => {
        this.#weeks = Number(range.value) || this.#weeks;
        this.#load();
      });
    }
    // The status palette is owned by StreetStatusColors, so publish it as custom properties rather than repeating the
    // hex values in CSS — the chart lines and the map legend can then never disagree.
    const root = document.getElementById('street-status-trend-section');
    if (root && typeof StreetStatusColors !== 'undefined') {
      for (const status of StreetStatusColors.STATUSES) {
        root.style.setProperty(`--trend-${StreetStatusTrend.#cssKey(status.key)}`, status.color);
      }
    }
    await this.#load();
  }

  /** Fetches the current window and renders every panel, or reports a failure without touching the page above. */
  async #load() {
    if (this.#loading) return;
    this.#loading = true;
    this.#setStatus('Loading recent changes…', false);
    try {
      const response = await fetch(`${this.#trendUrl}?weeks=${this.#weeks}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const data = await response.json();
      this.#render(data);
      this.#setStatus('', false, true);
    } catch (e) {
      this.#setStatus(`Could not load recent changes: ${StreetStatusTrend.#esc(e.message)}`, true);
    } finally {
      this.#loading = false;
    }
  }

  /**
   * @param {Object} data - The `/adminapi/streetStatusTrend` payload.
   */
  #render(data) {
    const weekStarts = StreetStatusTrend.#weekStarts(data.since, data.weeks);
    const labels = weekStarts.map(StreetStatusTrend.#formatWeek);

    this.#renderStatusChanges(data, weekStarts, labels);
    this.#renderReports(data, weekStarts, labels);
    this.#renderExpiries(data, weekStarts, labels);
    this.#renderCorroborated(data);
    this.#renderRegions(data);
  }

  /** Streets entering each status per week, one line per status. */
  #renderStatusChanges(data, weekStarts, labels) {
    const rows = data.status_changes || [];
    const statuses = typeof StreetStatusColors !== 'undefined'
      ? StreetStatusColors.STATUSES
      : [{ key: 'open', label: 'Open' }, { key: 'no_imagery', label: 'No imagery' },
          { key: 'closed', label: 'Closed' }, { key: 'disabled', label: 'Disabled' }];

    // Every status keeps its line even when nothing moved into it: a flat zero is the answer to "did anything get
    // retired this quarter", and dropping the series would make that indistinguishable from a missing chart.
    const series = statuses.map((status) => {
      const byWeek = new Map(rows.filter((r) => r.new_status === status.key)
        .map((r) => [r.week_start, r.street_count]));
      return {
        name: `→ ${status.label}`,
        key: StreetStatusTrend.#cssKey(status.key),
        values: weekStarts.map((week) => byWeek.get(week) || 0),
      };
    });

    MiniLineChart.renderInto(document.getElementById('trend-status-chart'), labels, series, {
      valueFormat: (v) => `${Math.round(v).toLocaleString()} street${Math.round(v) === 1 ? '' : 's'}`,
      ariaLabel: 'Streets changing status per week, by the status they moved into',
      dotRadius: 2,
    });

    const total = rows.reduce((sum, r) => sum + r.street_count, 0);
    this.#setText('trend-status-summary', total === 0
      ? 'No street changed status in this window.'
      : `${StreetStatusTrend.#num(total)} street${total === 1 ? '' : 's'} changed status in this window.`);
  }

  /** Distinct streets reported as having no imagery per week. */
  #renderReports(data, weekStarts, labels) {
    const rows = data.no_imagery_reports || [];
    const streetsByWeek = new Map(rows.map((r) => [r.week_start, r.street_count]));
    const reportsByWeek = new Map(rows.map((r) => [r.week_start, r.report_count]));

    MiniLineChart.renderInto(document.getElementById('trend-reports-chart'), labels, [{
      name: 'Streets reported',
      key: 'reports',
      values: weekStarts.map((week) => streetsByWeek.get(week) || 0),
      tooltips: weekStarts.map((week) => {
        const streets = streetsByWeek.get(week) || 0;
        const reports = reportsByWeek.get(week) || 0;
        return `${StreetStatusTrend.#num(streets)} street${streets === 1 ? '' : 's'}, `
          + `${StreetStatusTrend.#num(reports)} report${reports === 1 ? '' : 's'}`;
      }),
    }], {
      kind: 'bar',
      ariaLabel: 'Distinct streets reported as having no imagery per week',
    });
  }

  /** Panos whose imagery the nightly sweep found gone, per week. */
  #renderExpiries(data, weekStarts, labels) {
    const rows = data.panos_expired || [];
    const byWeek = new Map(rows.map((r) => [r.week_start, r.pano_count]));

    MiniLineChart.renderInto(document.getElementById('trend-expiry-chart'), labels, [{
      name: 'Panos expired',
      key: 'expired',
      values: weekStarts.map((week) => byWeek.get(week) || 0),
    }], {
      kind: 'bar',
      valueFormat: (v) => `${Math.round(v).toLocaleString()} pano${Math.round(v) === 1 ? '' : 's'}`,
      ariaLabel: 'Panoramas whose imagery went away per week',
    });

    const undated = data.panos_expired_undated || 0;
    this.#setText('trend-expiry-note', undated === 0
      ? ''
      : `${StreetStatusTrend.#num(undated)} panos were already expired before expiry dates were recorded, `
        + 'so they appear in no week above.');
  }

  /** The review queue: still-open streets that several distinct labelers reported as empty. */
  #renderCorroborated(data) {
    const rows = data.corroborated_streets || [];
    const min = data.min_reporters || 2;
    this.#setText('trend-corroborated-intro',
      `Streets still open for auditing that at least ${min} different labelers independently reported as having no `
      + 'imagery. A report is evidence, never a verdict, so these stay in the pool until the offline imagery checker '
      + 'confirms them — run it against these streets first.');

    if (rows.length === 0) {
      this.#setHtml('trend-corroborated', '<p class="trend-note">No street has been reported by that many '
      + 'labelers in this window.</p>');
      return;
    }

    const body = rows.map((r) => `
      <tr>
        <td><a href="/explore?streetEdgeId=${encodeURIComponent(r.street_edge_id)}">${StreetStatusTrend.#num(r.street_edge_id)}</a></td>
        <td>${StreetStatusTrend.#esc(r.region_name)}</td>
        <td>${StreetStatusTrend.#num(r.reporter_count)}</td>
        <td>${StreetStatusTrend.#num(r.report_count)}</td>
        <td class="ac-muted">${StreetStatusTrend.#esc((r.last_reported_at || '').slice(0, 10))}</td>
      </tr>`).join('');
    this.#renderTable('trend-corroborated',
      [['Street', true], 'Region', ['Labelers', true], ['Reports', true], 'Last reported'], body);
  }

  /** Where the reports are coming from, across all reports rather than only corroborated ones. */
  #renderRegions(data) {
    const rows = data.top_report_regions || [];
    if (rows.length === 0) {
      this.#setHtml('trend-regions', '<p class="trend-note">No missing-imagery reports in this window.</p>');
      return;
    }
    const body = rows.map((r) => `
      <tr>
        <td>${StreetStatusTrend.#esc(r.region_name)}</td>
        <td>${StreetStatusTrend.#num(r.street_count)}</td>
        <td>${StreetStatusTrend.#num(r.report_count)}</td>
      </tr>`).join('');
    this.#renderTable('trend-regions', ['Region', ['Streets reported', true], ['Reports', true]], body);
  }

  /**
   * Every week start in the window, as `YYYY-MM-DD`, so sparse series can be zero-filled.
   *
   * Stepped in UTC: local-time arithmetic across a DST boundary lands on a Sunday or a Tuesday and silently
   * desynchronizes the labels from the server's ISO week buckets.
   *
   * @param {string} sinceIso - Window start, which the server aligns to a Monday.
   * @param {number} weeks - Window size.
   * @returns {string[]} Week start dates, oldest first.
   */
  static #weekStarts(sinceIso, weeks) {
    const start = new Date(`${String(sinceIso).slice(0, 10)}T00:00:00Z`);
    const out = [];
    for (let i = 0; i <= weeks; i++) {
      const week = new Date(start.getTime() + i * 7 * 24 * 60 * 60 * 1000);
      if (week.getTime() > Date.now()) break;
      out.push(week.toISOString().slice(0, 10));
    }
    return out;
  }

  /**
   * A status enum value as a CSS-safe series key: `no_imagery` → `no-imagery`.
   *
   * MiniLineChart turns a series key straight into a class name, and both the class and the custom property it reads
   * have to be kebab-case to pass Stylelint — so the backend's underscore convention is translated here rather than
   * the palette being re-declared in CSS.
   *
   * @param {string} statusKey - A `street_edge_status` value.
   * @returns {string} The same value in kebab-case.
   */
  static #cssKey(statusKey) {
    return String(statusKey).replace(/_/g, '-');
  }

  /** `2026-08-10` → `Aug 10`. */
  static #formatWeek(isoDate) {
    const date = new Date(`${isoDate}T00:00:00Z`);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  /**
   * @param {string} id - Container element id.
   * @param {Array<string|[string, boolean]>} headers - Column headers; `[label, true]` right-aligns a numeric column.
   * @param {string} bodyHtml - Pre-rendered `<tr>` rows.
   */
  #renderTable(id, headers, bodyHtml) {
    const head = headers.map((h) => {
      const [label, num] = Array.isArray(h) ? h : [h, false];
      return `<th${num ? '' : ' class="ac-th-text"'}>${label}</th>`;
    }).join('');
    this.#setHtml(id, `
      <div class="ac-table-wrap">
        <table class="ac-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>`);
  }

  /** @param {string} message @param {boolean} isError @param {boolean} [hide=false] */
  #setStatus(message, isError, hide = false) {
    const el = document.getElementById('trend-status');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', Boolean(isError));
    el.classList.toggle('hidden', hide);
  }

  #setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  #setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  /** Thousands-separated integer. */
  static #num(n) {
    return Number(n || 0).toLocaleString();
  }

  /** @param {*} value @returns {string} HTML-escaped text. */
  static #esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}
