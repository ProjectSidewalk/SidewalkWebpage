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
  #reloadQueued = false;

  /**
   * @param {Object} opts
   * @param {string} opts.trendUrl - URL of the trend JSON endpoint, without the `weeks` parameter.
   * @param {number} [opts.weeks] - Initial window size in weeks, injected from the server's own default so the two
   *   can't drift. Omitted leaves the window off the request, which lets the server apply that same default.
   */
  constructor(opts = {}) {
    this.#trendUrl = opts.trendUrl;
    this.#weeks = Number(opts.weeks) || null;
  }

  /** Loads the initial window and wires the range selector. */
  async init() {
    const range = document.getElementById('trend-range');
    if (range) {
      // The server's default has to be one of the offered windows for the select to show it; if it ever isn't, the
      // assignment is a no-op and the select keeps its first option, so take the select's value as authoritative
      // rather than letting the two disagree silently.
      range.value = String(this.#weeks);
      this.#weeks = Number(range.value) || this.#weeks;
      range.addEventListener('change', () => {
        this.#weeks = Number(range.value) || this.#weeks;
        this.#load();
      });
    }
    // The status palette is owned by StreetStatusColors, so publish it as custom properties rather than repeating the
    // hex values in CSS — the chart lines and the map legend can then never disagree.
    const root = document.getElementById('street-status-trend-section');
    if (root) {
      for (const status of StreetStatusColors.STATUSES) {
        root.style.setProperty(`--trend-${StreetStatusTrend.#cssKey(status.key)}`, status.color);
      }
    }
    await this.#load();
  }

  /** Fetches the current window and renders every panel, or reports a failure without touching the page above. */
  async #load() {
    // A window picked while a fetch is in flight is queued rather than dropped: returning outright would leave the
    // <select> showing one window and the charts another, with nothing on the page to say which is which.
    if (this.#loading) {
      this.#reloadQueued = true;
      return;
    }
    this.#loading = true;
    this.#setStatus('Loading recent changes…', false);
    try {
      const query = this.#weeks ? `?weeks=${this.#weeks}` : '';
      const response = await fetch(`${this.#trendUrl}${query}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const data = await response.json();
      this.#render(data);
      this.#setStatus('', false, true);
    } catch (e) {
      // #setStatus writes through textContent, which escapes on its own — escaping here too would render the
      // entities literally.
      this.#setStatus(`Could not load recent changes: ${e.message}`, true);
    } finally {
      this.#loading = false;
    }
    if (this.#reloadQueued) {
      this.#reloadQueued = false;
      await this.#load();
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

    // Every status keeps its line even when nothing moved into it: a flat zero is the answer to "did anything get
    // retired this quarter", and dropping the series would make that indistinguishable from a missing chart.
    const series = StreetStatusColors.STATUSES.map((status) => {
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

    // Summed over the rendered series rather than over the raw rows, so the headline can only ever describe bars that
    // are on screen. Totalling the rows instead would quietly report changes the chart has no bucket for — a count
    // above bars that visibly sum to less, with nothing on the page to explain the gap.
    //
    // Counted as changes, not streets: the server de-duplicates streets only within a (week, destination) bucket, so
    // one street that moved in two weeks — or into two statuses — contributes to two rows here.
    const total = series.reduce((sum, s) => sum + s.values.reduce((a, b) => a + b, 0), 0);
    AdminShell.setText('trend-status-summary', total === 0
      ? 'No street changed status in this window.'
      : `${AdminShell.num(total)} status change${total === 1 ? '' : 's'} in this window.`);
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
        return `${AdminShell.num(streets)} street${streets === 1 ? '' : 's'}, `
          + `${AdminShell.num(reports)} report${reports === 1 ? '' : 's'}`;
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
    AdminShell.setText('trend-expiry-note', undated === 0
      ? ''
      : `${AdminShell.num(undated)} panos were already expired before expiry dates were recorded, `
        + 'so they appear in no week above.');
  }

  /** The review queue: still-open streets that several distinct labelers reported as empty. */
  #renderCorroborated(data) {
    const rows = data.corroborated_streets || [];
    // The threshold is the server's (StreetLifecycleService.MinCorroboratingReporters) and always travels with the
    // payload, so it is read rather than mirrored — a local default would silently disagree the day it changed.
    AdminShell.setText('trend-corroborated-intro', `
      Streets still open for auditing that at least ${AdminShell.num(data.min_reporters)} different labeler accounts
      independently reported as having no imagery. A report is evidence, never a verdict: these stay in the pool
      until the offline imagery checker confirms them — run it against these streets first.`);

    if (rows.length === 0) {
      AdminShell.setHtml('trend-corroborated', `
        <p class="trend-note">No street has been reported by that many labelers in this window.</p>`);
      return;
    }

    const body = rows.map((r) => `
      <tr>
        <td>
          <a href="/explore?streetEdgeId=${encodeURIComponent(r.street_edge_id)}">
            ${AdminShell.num(r.street_edge_id)}
          </a>
        </td>
        <td>${AdminShell.esc(r.region_name)}</td>
        <td>${AdminShell.num(r.reporter_count)}</td>
        <td>${AdminShell.num(r.report_count)}</td>
        <td class="ac-muted">${AdminShell.esc((r.last_reported_at || '').slice(0, 10))}</td>
      </tr>`).join('');
    AdminShell.setHtml('trend-corroborated', AdminShell.tableHtml(
      [['Street', true], 'Region', ['Labelers', true], ['Reports', true], 'Last reported'], body));
  }

  /** Where the reports are coming from, across all reports rather than only corroborated ones. */
  #renderRegions(data) {
    const rows = data.top_report_regions || [];
    if (rows.length === 0) {
      AdminShell.setHtml('trend-regions', '<p class="trend-note">No missing-imagery reports in this window.</p>');
      return;
    }
    const body = rows.map((r) => `
      <tr>
        <td>${AdminShell.esc(r.region_name)}</td>
        <td>${AdminShell.num(r.street_count)}</td>
        <td>${AdminShell.num(r.report_count)}</td>
      </tr>`).join('');
    AdminShell.setHtml('trend-regions',
      AdminShell.tableHtml(['Region', ['Streets reported', true], ['Reports', true]], body));
  }

  /**
   * Every week start in the window, as `YYYY-MM-DD`, so sparse series can be zero-filled.
   *
   * Stepped in UTC: local-time arithmetic across a DST boundary lands on a Sunday or a Tuesday and silently
   * desynchronizes the labels from the server's ISO week buckets. Both endpoints are compared as calendar dates
   * rather than instants for the same reason — the server's buckets are dates in *its* zone, and stopping on
   * `week.getTime() > Date.now()` would drop the current week for the first hours of every local Monday on any host
   * running east of UTC, where that Monday's UTC midnight is still in the future.
   *
   * @param {string} sinceIso - Window start, which the server aligns to a Monday.
   * @param {number} weeks - Window size.
   * @returns {string[]} Week start dates, oldest first.
   */
  static #weekStarts(sinceIso, weeks) {
    const start = new Date(`${String(sinceIso).slice(0, 10)}T00:00:00Z`);
    // Read the clock through Date.now() rather than `new Date()`, so "now" enters this method in one place.
    const today = StreetStatusTrend.#localIsoDate(new Date(Date.now()));
    const out = [];
    for (let i = 0; i <= weeks; i++) {
      const week = new Date(start.getTime() + i * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      // ISO dates sort lexicographically, so a string comparison is a date comparison.
      if (week > today) break;
      out.push(week);
    }
    return out;
  }

  /**
   * @param {Date} date - Any date.
   * @returns {string} That date in the viewer's own zone as `YYYY-MM-DD`, not shifted into UTC.
   */
  static #localIsoDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

  /** @param {string} message @param {boolean} isError @param {boolean} [hide=false] */
  #setStatus(message, isError, hide = false) {
    const el = document.getElementById('trend-status');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', Boolean(isError));
    el.classList.toggle('hidden', hide);
  }
}
