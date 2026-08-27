/**
 * The "Recently changed" section of the admin Street Status page (#4928).
 *
 * The map and table above it are a snapshot: they answer what the city looks like now, and cannot answer what changed
 * or when. This renders the three weekly series that can — streets moving between statuses, labeler reports of
 * missing imagery, and panos losing or regaining their imagery — plus the queue of streets several different labelers
 * have independently reported, which is what the offline imagery checker should be pointed at next.
 *
 * Fetches its own endpoint so a failure here leaves the snapshot above intact. Admin-only surface, English only.
 */
class StreetStatusTrend {
  #trendUrl;
  #weeks;
  #onShowStreet;
  #loading = false;
  #reloadQueued = false;

  /**
   * @param {Object} opts
   * @param {string} opts.trendUrl - URL of the trend JSON endpoint, without the `weeks` parameter.
   * @param {number} [opts.weeks] - Initial window size in weeks, injected from the server's own default so the two
   *   can't drift. Omitted leaves the window off the request, which lets the server apply that same default.
   * @param {function(number): boolean} [opts.onShowStreet] - Asks the page to point its status map at one street,
   *   returning false if it can't yet. Omitted renders the reopen queue's street ids as plain text.
   */
  constructor(opts = {}) {
    this.#trendUrl = opts.trendUrl;
    this.#weeks = Number(opts.weeks) || null;
    this.#onShowStreet = opts.onShowStreet || null;
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
    this.#renderImageryChanges(data, weekStarts, labels);
    this.#renderReopenCandidates(data);
    this.#renderCorroborated(data);
    this.#renderRegions(data);
  }

  /**
   * The regained-imagery review queue (#4929): no_imagery streets whose latest nightly poll found panos again, each
   * with Reopen/Dismiss actions. Tolerates both the payload field and the container being absent, so older fixtures
   * and pages keep rendering.
   */
  #renderReopenCandidates(data) {
    const container = document.getElementById('trend-reopen-candidates');
    if (!container) return;
    const rows = data.reopen_candidates || [];

    if (rows.length === 0) {
      container.innerHTML = '<p class="trend-note">No retired street currently shows regained imagery. '
        + 'The nightly poll re-checks a small batch of no-imagery streets and queues any it finds panoramas on.</p>';
      return;
    }

    // Every row's buttons would otherwise read as an unqualified "Reopen" to a screen reader, so each names its
    // street. Buttons are wired after insertion -- listeners can't ride along in an HTML string.
    const body = rows.map((r) => {
      const id = Number(r.street_edge_id);
      return `
      <tr data-street-id="${id}">
        <td>${StreetStatusTrend.#streetCell(id, !!this.#onShowStreet)}</td>
        <td>${AdminShell.esc(r.region_name)}</td>
        <td>${AdminShell.num(r.n_panos)}</td>
        <td class="ac-muted">${AdminShell.esc(r.newest_capture || '—')}</td>
        <td class="ac-muted">${AdminShell.esc((r.last_detected_at || '').slice(0, 10))}</td>
        <td class="reopen-queue-actions">
          <button type="button" class="reopen-queue-btn" data-action="reopen"
                  aria-label="Reopen street ${id}">Reopen</button>
          <button type="button" class="reopen-queue-btn" data-action="dismiss"
                  aria-label="Dismiss street ${id}">Dismiss</button>
        </td>
      </tr>`;
    }).join('');
    container.innerHTML = AdminShell.tableHtml(
      [['Street', true], 'Region', ['Panos found', true], 'Newest capture', 'Last detected', 'Actions'], body);
    // Focusable so an action that re-renders the table can put focus back here instead of dropping it to the body.
    container.tabIndex = -1;
    for (const button of container.querySelectorAll('button[data-action="locate"]')) {
      button.addEventListener('click', () => this.#showCandidateOnMap(button));
    }
    for (const button of container.querySelectorAll('button[data-action="reopen"], button[data-action="dismiss"]')) {
      button.addEventListener('click', () => this.#actOnReopenCandidate(button));
    }
  }

  /**
   * The queue's street cell. Every street here is `no_imagery`, and Explore only serves open streets, so the id links
   * to the status map above rather than to Explore — which would answer a 500 for exactly these streets.
   *
   * @param {number} streetEdgeId - The street the row is about.
   * @param {boolean} canShowOnMap - Whether a map handler was supplied; without one the id is plain text.
   * @returns {string} The cell's inner HTML.
   */
  static #streetCell(streetEdgeId, canShowOnMap) {
    if (!canShowOnMap) return AdminShell.num(streetEdgeId);
    return `<button type="button" class="reopen-queue-locate" data-action="locate"
                    aria-label="Show street ${streetEdgeId} on the status map above"
            >${AdminShell.num(streetEdgeId)}</button>`;
  }

  /**
   * Zooms the page's status map to one queued street, or says so if the map can't answer yet — the whole-city GeoJSON
   * it needs loads independently of this section and is usually the slower of the two.
   *
   * @param {HTMLButtonElement} button - The clicked street id, inside a data-street-id row.
   */
  #showCandidateOnMap(button) {
    const streetEdgeId = Number(button.closest('tr')?.dataset.streetId);
    if (!Number.isInteger(streetEdgeId)) return;
    if (!this.#onShowStreet(streetEdgeId)) {
      this.#setQueueError('The status map is still loading; try again in a moment.');
    }
  }

  /**
   * Runs one queue action -- Reopen (confirmed first; PUT) or Dismiss (DELETE) -- then reloads the whole trend, since
   * a reopen also moves the status-change series and the server has just invalidated its cached payload.
   *
   * A refused action reloads too: a 409 means this row is stale (the street is already open), and the reload is what
   * clears it, since the server's queue read filters on the street's current status.
   *
   * @param {HTMLButtonElement} button - The clicked action button, carrying data-action inside a data-street-id row.
   */
  async #actOnReopenCandidate(button) {
    const row = button.closest('tr');
    const streetEdgeId = Number(row?.dataset.streetId);
    if (!Number.isInteger(streetEdgeId)) return;
    const reopen = button.dataset.action === 'reopen';
    if (reopen) {
      const ok = await ConfirmDialog.confirm({
        message: `Reopen street ${streetEdgeId} for auditing? It returns to the labeling pool at full priority, and `
          + 'its region\'s completion percentage drops to match.',
        confirmText: 'Reopen',
        cancelText: 'Cancel',
      });
      if (!ok) return;
    }
    const url = reopen
      ? `/adminapi/streets/${streetEdgeId}/reopen`
      : `/adminapi/streets/${streetEdgeId}/reopenCandidate`;
    const buttons = row.querySelectorAll('button');
    for (const b of buttons) b.disabled = true;
    try {
      const response = await fetch(url, { method: reopen ? 'PUT' : 'DELETE' });
      if (!response.ok) throw new Error(await StreetStatusTrend.#errorMessage(response));
      await this.#load();
      document.getElementById('trend-reopen-candidates')?.focus();
    } catch (e) {
      console.error('Street status: reopen-queue action failed.', e);
      const message = `Could not ${reopen ? 'reopen' : 'dismiss'} street ${streetEdgeId}: ${e.message}`;
      // Reloaded before the message is written, and written after: a 409 means this row is stale (the street is
      // already open), and only a reload clears it, since the server's queue read filters on the street's current
      // status -- but that reload re-renders the queue, taking any message inside it with it.
      await this.#load().catch(() => {});
      this.#setStatus(message, true);
      // Also shown in the queue itself: #trend-status sits at the top of the section, well above these buttons.
      this.#setQueueError(message);
      // A no-op once the reload has re-rendered the row; it matters only when the reload failed too, leaving the
      // original buttons on screen.
      for (const b of buttons) b.disabled = false;
    }
  }

  /**
   * The server's own explanation of a refusal, which is the useful half of a 409 ("Street 555 is 'open', not
   * 'no_imagery'.") and says far more than the status code.
   *
   * @param {Response} response - The failed response.
   * @returns {Promise<string>} Its `message` field, or the status line when the body isn't the JSON we expect.
   */
  static async #errorMessage(response) {
    try {
      const body = await response.json();
      if (body && typeof body.message === 'string') return body.message;
    } catch {
      // Fall through to the status line: a non-JSON body (an HTML error page, say) says nothing worth quoting.
    }
    return `HTTP ${response.status}`;
  }

  /**
   * Shows a message inside the queue, above its table. Written through textContent, which escapes on its own.
   *
   * @param {string} message - What to say.
   */
  #setQueueError(message) {
    const container = document.getElementById('trend-reopen-candidates');
    if (!container) return;
    let note = container.querySelector('.reopen-queue-error');
    if (!note) {
      note = document.createElement('p');
      note.className = 'trend-note error reopen-queue-error';
      note.setAttribute('role', 'alert');
      container.prepend(note);
    }
    note.textContent = message;
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

  /** Panos crossing the expired boundary in each direction, per week. */
  #renderImageryChanges(data, weekStarts, labels) {
    const rows = data.pano_imagery_changes || [];
    const goneByWeek = new Map(rows.map((r) => [r.week_start, r.expired_count]));
    const backByWeek = new Map(rows.map((r) => [r.week_start, r.returned_count]));

    // Both directions, because the pair is the point: a week of expiries that a later week hands back is a provider
    // hiccup, and the same bar with no recoveries after it is imagery that is actually gone.
    MiniLineChart.renderInto(document.getElementById('trend-expiry-chart'), labels, [{
      name: 'Imagery went away',
      key: 'expired',
      values: weekStarts.map((week) => goneByWeek.get(week) || 0),
    }, {
      name: 'Imagery came back',
      key: 'returned',
      values: weekStarts.map((week) => backByWeek.get(week) || 0),
    }], {
      kind: 'bar',
      valueFormat: (v) => `${Math.round(v).toLocaleString()} pano${Math.round(v) === 1 ? '' : 's'}`,
      ariaLabel: 'Panoramas whose imagery went away, and whose imagery came back, per week',
    });

    // These panos have no logged loss but do log their recovery, so "came back" can outrun "went away" until the
    // count drains. Unexplained, that reads as a broken chart.
    const undated = data.panos_expired_undated || 0;
    AdminShell.setText('trend-expiry-note', undated === 0
      ? ''
      : `${AdminShell.num(undated)} panos were already expired before any of this was recorded, so they appear in `
        + 'no week above. If one regains imagery it still charts as a recovery, with no matching loss before it.');
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
