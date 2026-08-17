/**
 * Owner-only Health dashboard page (#4561).
 *
 * Polls /adminapi/dbHealth and renders the current database & application operational-health signals — blocking
 * locks, idle-in-transaction sessions, stuck evolutions, table bloat, connection pressure, and pano-backup coverage.
 * All status colors come from server-provided thresholds (never hard-coded here). Admin-only surface, English only.
 */
class HealthPage {
  #healthUrl;
  #pollMs;
  #thresholds = null;
  #loading = false;
  #lastUpdatedMs = null;

  /**
   * @param {Object} opts
   * @param {string} opts.healthUrl - URL of the JSON health endpoint.
   * @param {number} [opts.pollSeconds=20] - Refresh interval in seconds.
   */
  constructor(opts = {}) {
    this.#healthUrl = opts.healthUrl;
    this.#pollMs = (opts.pollSeconds || 20) * 1000;
  }

  /** Loads once, then polls on an interval, pausing while the tab is hidden. */
  async init() {
    await this.#load();
    setInterval(() => {
      if (!document.hidden) this.#load();
    }, this.#pollMs);
    // Tick the "updated Ns ago" age between polls so staleness stays visible — especially after a failed poll, when
    // every panel keeps showing the last good data.
    setInterval(() => this.#renderAge(), 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.#load();
    });
  }

  /**
   * @param {string} url
   * @returns {Promise<Object>} Parsed JSON body.
   */
  async #fetchJson(url) {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`Request failed: ${resp.status}`);
    return resp.json();
  }

  /**
   * Fetches the payload and repaints every panel; on failure marks the pulse without blanking prior data. Guards
   * against overlapping polls: if a fetch is already in flight (e.g. the endpoint is slow under load, or a
   * visibilitychange fires mid-poll), this returns immediately rather than stacking a second concurrent request onto
   * the same DB connection pool — the page must not compound the pressure it is meant to observe.
   */
  async #load() {
    if (this.#loading) return;
    this.#loading = true;
    try {
      const data = await this.#fetchJson(this.#healthUrl);
      // Age is measured from the client clock at response receipt, not the server's generated_at timestamp, so
      // browser/server clock skew can't distort the "updated Ns ago" readout.
      this.#lastUpdatedMs = Date.now();
      this.#thresholds = data.thresholds || {};
      this.#renderPulse(data);
      this.#renderKpis(data);
      this.#renderMeta(data);
      this.#renderLocks(data.blocking_sessions || []);
      this.#renderActive(data.active_queries || []);
      this.#renderIdle(data.idle_in_transaction || []);
      this.#renderEvolutions(data.stuck_evolutions || []);
      this.#renderBloat(data.table_bloat || []);
      this.#renderConnections(data.connections || []);
      this.#renderPanos(data.pano_backups || null);
      this.#renderNightlyJobs(data.nightly_jobs || []);
    } catch (e) {
      this.#setHtml('health-pulse', `<strong>Could not load health data.</strong> ${HealthPage.#esc(e.message)}`);
    } finally {
      this.#loading = false;
    }
  }

  // ---- Panel: overall pulse + KPIs -------------------------------------------------------------------------------

  /** Summarizes the worst signal into a one-line status banner. */
  #renderPulse(data) {
    const t = this.#thresholds;
    const problems = [];
    let tone = 'good';
    const blocking = (data.blocking_sessions || []).length;
    if (blocking > 0) {
      tone = 'bad';
      problems.push(`${blocking} blocking session${blocking === 1 ? '' : 's'}`);
    }
    const badIdle = (data.idle_in_transaction || []).filter((s) => (s.idle_seconds || 0) >= t.idle_txn_bad_seconds).length;
    if (badIdle > 0) {
      tone = tone === 'bad' ? 'bad' : 'warn';
      problems.push(`${badIdle} long idle transaction${badIdle === 1 ? '' : 's'}`);
    }
    const longQ = data.active_queries || [];
    if (longQ.length > 0) {
      const longQBad = longQ.filter((q) => (q.query_seconds || 0) >= t.active_query_bad_seconds).length;
      tone = longQBad > 0 || tone === 'bad' ? 'bad' : 'warn';
      problems.push(`${longQ.length} long-running quer${longQ.length === 1 ? 'y' : 'ies'}`);
    }
    const stuck = (data.stuck_evolutions || []).length;
    if (stuck > 0) {
      tone = 'bad';
      problems.push(`${stuck} stuck evolution${stuck === 1 ? '' : 's'}`);
    }
    const bloated = (data.table_bloat || []).filter((b) => this.#bloatTone(b) !== 'good').length;
    if (bloated > 0) {
      tone = tone === 'bad' ? 'bad' : 'warn';
      problems.push(`${bloated} bloated table${bloated === 1 ? '' : 's'}`);
    }
    const label = tone === 'good' ? 'All clear' : 'Needs attention';
    const detail = problems.length
      ? ` — ${problems.map(HealthPage.#esc).join(', ')}`
      : ' — no blocking locks, stuck evolutions, or long idle transactions right now.';
    this.#setHtml('health-pulse', `<span class="ac-badge ac-badge--${tone}">${label}</span>${detail}`);
  }

  /** Fills the top-line KPI numbers. */
  #renderKpis(data) {
    const t = this.#thresholds;
    const blocking = data.blocking_sessions || [];
    const active = data.active_queries || [];
    const idle = data.idle_in_transaction || [];
    const evolutions = data.stuck_evolutions || [];
    const conns = (data.connections || []).reduce((sum, c) => sum + (c.count || 0), 0);
    const atRisk = data.pano_backups?.at_risk;
    const bloated = (data.table_bloat || []).filter((b) => this.#bloatTone(b) !== 'good').length;
    const longIdle = idle.filter((s) => (s.idle_seconds || 0) >= t.idle_txn_warn_seconds).length;
    const activeBad = active.filter((q) => (q.query_seconds || 0) >= t.active_query_bad_seconds).length;
    this.#setKpi('kpi-blocking', blocking.length, blocking.length > 0 ? 'bad' : 'good');
    this.#setKpi('kpi-active', active.length, activeBad > 0 ? 'bad' : active.length > 0 ? 'warn' : 'good');
    this.#setKpi('kpi-idle', idle.length, longIdle > 0 ? 'warn' : 'good');
    this.#setKpi('kpi-evolutions', evolutions.length, evolutions.length > 0 ? 'bad' : 'good');
    this.#setKpi('kpi-bloat', bloated, bloated > 0 ? 'warn' : 'good');
    this.#setKpi('kpi-connections', conns, 'ok');
    // A missing value ("—") means unknown, not healthy, so tone it neutral ('ok') instead of 'good' (green).
    const panoTone = HealthPage.#nil(atRisk) ? 'ok' : atRisk > 0 ? 'warn' : 'good';
    this.#setKpi('kpi-panos', HealthPage.#nil(atRisk) ? '—' : HealthPage.#compact(atRisk), panoTone);
  }

  /** Renders the "updated Ns ago · db · role" meta line, including whether other sessions' query text is visible. */
  #renderMeta(data) {
    const parts = [`updated <span id="health-meta-age">${this.#ageText()}</span>`];
    if (data.current_database) parts.push(`db <code>${HealthPage.#esc(data.current_database)}</code>`);
    if (data.current_role) parts.push(`role <code>${HealthPage.#esc(data.current_role)}</code>`);
    if (data.can_see_all_queries === false) {
      // Without pg_read_all_stats Postgres nulls out other sessions' state/wait/query, so those rows drop out of the
      // state-filtered panels entirely — say so, rather than implying only the query text is missing.
      parts.push(`role lacks <code>pg_read_all_stats</code> (usually granted via <code>pg_monitor</code>): other
        sessions' state and query are hidden, so the idle-transaction and long-query panels show only this app's own
        sessions`);
    }
    this.#setHtml('health-meta', parts.join(' · '));
  }

  // ---- Panel: blocking locks -------------------------------------------------------------------------------------

  #renderLocks(rows) {
    if (!rows.length) return this.#renderEmpty('health-locks', 'No sessions are blocking others.');
    const t = this.#thresholds;
    const body = rows.map((r) => {
      const wait = r.max_wait_seconds || 0;
      const tone = wait >= t.lock_wait_bad_seconds ? 'bad' : wait >= t.lock_wait_warn_seconds ? 'warn' : 'ok';
      return `
        <tr>
          <td class="ac-num">${r.pid}</td>
          <td>${HealthPage.#esc(r.usename) || '—'}</td>
          <td>${this.#stateBadge(r.state)}</td>
          <td class="ac-num">${HealthPage.#dur(r.xact_seconds)}</td>
          <td class="ac-num"><span class="ac-badge ac-badge--${tone}">${r.blocking_count}</span></td>
          <td class="ac-num">${HealthPage.#dur(r.max_wait_seconds)}</td>
          <td class="ac-muted">${HealthPage.#esc(r.held_locks) || '—'}</td>
          <td class="ac-muted">${this.#queryCell(r.query)}</td>
        </tr>`;
    }).join('');
    this.#table('health-locks',
      [['PID', true], 'Role', 'State', ['Txn age', true], ['Blocks', true], ['Longest wait', true], 'Held locks',
        'Query'], body);
  }

  // ---- Panel: long-running queries -------------------------------------------------------------------------------

  #renderActive(rows) {
    if (!rows.length) return this.#renderEmpty('health-active', 'No long-running queries.');
    const t = this.#thresholds;
    const body = rows.map((r) => {
      const secs = r.query_seconds || 0;
      const tone = secs >= t.active_query_bad_seconds ? 'bad' : secs >= t.active_query_warn_seconds ? 'warn' : 'ok';
      return `
        <tr>
          <td class="ac-num">${r.pid}</td>
          <td>${HealthPage.#esc(r.usename) || '—'}</td>
          <td>${HealthPage.#esc(r.application_name) || '—'}</td>
          <td class="ac-num"><span class="ac-badge ac-badge--${tone}">${HealthPage.#dur(r.query_seconds)}</span></td>
          <td>${HealthPage.#esc(r.wait_event_type) || '—'}</td>
          <td class="ac-muted">${this.#queryCell(r.query)}</td>
        </tr>`;
    }).join('');
    this.#table('health-active',
      [['PID', true], 'Role', 'Application', ['Running for', true], 'Waiting on', 'Query'], body);
  }

  // ---- Panel: idle in transaction --------------------------------------------------------------------------------

  #renderIdle(rows) {
    if (!rows.length) return this.#renderEmpty('health-idle', 'No sessions are idle in a transaction.');
    const t = this.#thresholds;
    const body = rows.map((r) => {
      const idle = r.idle_seconds || 0;
      const tone = idle >= t.idle_txn_bad_seconds ? 'bad' : idle >= t.idle_txn_warn_seconds ? 'warn' : 'ok';
      return `
        <tr>
          <td class="ac-num">${r.pid}</td>
          <td>${HealthPage.#esc(r.usename) || '—'}</td>
          <td>${HealthPage.#esc(r.application_name) || '—'}</td>
          <td class="ac-num"><span class="ac-badge ac-badge--${tone}">${HealthPage.#dur(r.idle_seconds)}</span></td>
          <td class="ac-num">${HealthPage.#dur(r.xact_seconds)}</td>
          <td class="ac-muted">${this.#queryCell(r.query)}</td>
        </tr>`;
    }).join('');
    this.#table('health-idle',
      [['PID', true], 'Role', 'Application', ['Idle for', true], ['Txn age', true], 'Query'], body);
  }

  // ---- Panel: stuck evolutions -----------------------------------------------------------------------------------

  #renderEvolutions(rows) {
    if (!rows.length) return this.#renderEmpty('health-evolutions', 'All evolutions are applied cleanly.');
    const body = rows.map((r) => `
        <tr class="ac-row--flagged">
          <td>${HealthPage.#esc(r.schema)}</td>
          <td class="ac-num">${r.id}</td>
          <td><span class="ac-badge ac-badge--bad">${HealthPage.#esc(r.state) || 'unknown'}</span></td>
          <td class="ac-muted">${HealthPage.#esc((r.applied_at || '').slice(0, 19)) || '—'}</td>
          <td class="ac-muted">${HealthPage.#esc(r.last_problem) || '—'}</td>
        </tr>`).join('');
    this.#table('health-evolutions', ['Schema', ['Evolution', true], 'State', 'Applied at', 'Problem'], body);
  }

  // ---- Panel: table bloat ----------------------------------------------------------------------------------------

  #renderBloat(rows) {
    if (!rows.length) return this.#renderEmpty('health-bloat', 'No stats for the heavyweight tables.');
    const body = rows.map((r) => {
      const tone = this.#bloatTone(r);
      const ratioPct = HealthPage.#nil(r.dead_ratio) ? '—' : `${(r.dead_ratio * 100).toFixed(1)}%`;
      return `
        <tr${tone !== 'good' ? ' class="ac-row--flagged"' : ''}>
          <td>${HealthPage.#esc(r.schema_name)}</td>
          <td>${HealthPage.#esc(r.rel_name)}</td>
          <td class="ac-num">${HealthPage.#compact(r.live_tuples)}</td>
          <td class="ac-num">${HealthPage.#compact(r.dead_tuples)}</td>
          <td class="ac-num"><span class="ac-badge ac-badge--${tone === 'good' ? 'good' : tone}">${ratioPct}</span></td>
          <td class="ac-num">${HealthPage.#nil(r.vacuum_age_seconds) ? 'never' : `${HealthPage.#dur(r.vacuum_age_seconds)} ago`}</td>
        </tr>`;
    }).join('');
    this.#table('health-bloat',
      ['Schema', 'Table', ['Live rows', true], ['Dead rows', true], ['Dead ratio', true], ['Last vacuum', true]],
      body);
  }

  /** Bloat is only meaningful with a real absolute dead-tuple count (post-restore estimates read as 0 live rows). */
  #bloatTone(r) {
    const t = this.#thresholds;
    if (HealthPage.#nil(r.dead_ratio) || (r.dead_tuples || 0) < t.bloat_min_dead_tuples) return 'good';
    if (r.dead_ratio >= t.bloat_bad_ratio) return 'bad';
    if (r.dead_ratio >= t.bloat_warn_ratio) return 'warn';
    return 'good';
  }

  // ---- Panel: connections ----------------------------------------------------------------------------------------

  #renderConnections(rows) {
    if (!rows.length) return this.#renderEmpty('health-connections', 'No client connections.');
    const t = this.#thresholds;
    // Group the (role, state) counts into one row per role.
    const byRole = new Map();
    for (const r of rows) {
      const role = r.usename || '—';
      const entry = byRole.get(role) || { active: 0, idle: 0, total: 0 };
      const n = r.count || 0;
      entry.total += n;
      if (r.state === 'active') entry.active += n;
      else if (r.state === 'idle') entry.idle += n;
      byRole.set(role, entry);
    }
    const body = [...byRole.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([role, e]) => {
        const tone = e.active >= t.conn_bad_active ? 'bad' : e.active >= t.conn_warn_active ? 'warn' : 'ok';
        return `
        <tr>
          <td>${HealthPage.#esc(role)}</td>
          <td class="ac-num"><span class="ac-badge ac-badge--${tone}">${e.active}</span></td>
          <td class="ac-num">${e.idle}</td>
          <td class="ac-num">${e.total}</td>
        </tr>`;
      }).join('');
    // Each city's app instance connects as its own per-city role, so a role's active count is one instance's pool
    // draw — labeled with that instance's pool ceiling so it reads as "17 of 25 in use".
    this.#table('health-connections',
      ['Role', [`Active (pool ${t.conn_pool_max})`, true], ['Idle', true], ['Total', true]], body);
  }

  // ---- Panel: pano downloads -------------------------------------------------------------------------------------

  #renderPanos(p) {
    if (!p) return this.#renderEmpty('health-panos', 'Pano backup stats are unavailable.');
    // Every count is a share of labeled panos, so show its percentage alongside the raw number.
    const share = (n) => (p.labeled_panos > 0 ? Math.round((n / p.labeled_panos) * 100) : 0);
    const atRiskValue = p.at_risk > 0
      ? `<span class="ac-badge ac-badge--warn">${HealthPage.#compact(p.at_risk)}</span>`
      : HealthPage.#compact(p.at_risk);
    const cards = [
      { value: HealthPage.#compact(p.labeled_panos), label: 'Labeled panos',
        title: 'Distinct panos that have at least one label.' },
      { value: HealthPage.#compact(p.backed_up), label: `Backed up (${share(p.backed_up)}%)`,
        title: 'Have a locally-hosted backup image.' },
      { value: HealthPage.#compact(p.unchecked), label: `Unchecked (${share(p.unchecked)}%)`,
        title: 'Backup status not yet determined — refreshed lazily by the nightly imagery job.' },
      { value: HealthPage.#compact(p.no_backup), label: `No backup (${share(p.no_backup)}%)`,
        title: 'Checked, but no local backup exists.' },
      { value: atRiskValue, label: `At risk (${share(p.at_risk)}%)`,
        title: 'Source imagery has expired and there is no local backup, so these labels can no longer be shown.' },
    ];
    const html = cards.map((c) => `
        <div class="coverage-kpi" title="${HealthPage.#esc(c.title)}">
          <span class="coverage-kpi-value">${c.value}</span>
          <span class="coverage-kpi-label">${c.label}</span>
        </div>`).join('');
    this.#setHtml('health-panos', `<div class="coverage-kpis">${html}</div>`);
    this.#setHtml('health-panos-note',
      'Backup status is refreshed lazily by the nightly imagery check, so a large "unchecked" count is normal '
      + 'and these figures approximate what is actually on disk.');
  }

  // ---- Panel: nightly jobs ---------------------------------------------------------------------------------------

  /**
   * Every scheduled job and the state of its last run (#4928).
   *
   * Ordered worst-first rather than by schedule: on a healthy night every row says the same thing, and the whole point
   * of the panel is the one row that doesn't.
   *
   * @param {Array<Object>} jobs - `nightly_jobs` entries from the health payload.
   */
  #renderNightlyJobs(jobs) {
    // The roster is a compile-time constant, so the server always returns a row per job unless the read of
    // background_job_run failed and was recovered to an empty list. An empty panel is therefore a failure, never a
    // healthy "nothing scheduled" — rendering it as the latter would be the exact blind spot this panel exists for.
    if (jobs.length === 0) {
      return this.#renderProblem('health-jobs',
        'Could not read the nightly-job history — this panel is blind, not clear.');
    }
    const t = this.#thresholds;
    const rank = { never_run: 0, abandoned: 1, failed: 2, running: 3, succeeded: 4 };
    const sorted = [...jobs].sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return (rank[a.last_status] ?? 9) - (rank[b.last_status] ?? 9);
    });

    const body = sorted.map((job) => `
      <tr>
        <td>${HealthPage.#esc(job.label)}</td>
        <td class="ac-muted">${HealthPage.#esc(job.scheduled_at)}</td>
        <td>${this.#jobStatusBadge(job)}</td>
        <td>${HealthPage.#esc(HealthPage.#jobLastRun(job))}</td>
        <td class="ac-num">${HealthPage.#jobDuration(job.last_duration_seconds)}</td>
        <td class="ac-muted">${HealthPage.#esc(HealthPage.#jobDetails(job))}</td>
        <td class="ac-num">${job.failures_in_window > 0
          ? `<span class="ac-badge ac-badge--warn">${job.failures_in_window}/${job.runs_in_window}</span>`
          : `${HealthPage.#num(job.failures_in_window)}/${HealthPage.#num(job.runs_in_window)}`}</td>
      </tr>`).join('');
    this.#table('health-jobs',
      ['Job', 'Scheduled', 'Last run', 'When', ['Duration', true], 'Result', [`Failures (${t.job_window_days}d)`, true]],
      body);
    const overdue = jobs.filter((job) => job.overdue).length;
    this.#setHtml('health-jobs-note', overdue === 0
      ? `Every job has succeeded within the last ${t.job_overdue_hours} hours.`
      : `${overdue} job${overdue === 1 ? ' has' : 's have'} not succeeded in the last ${t.job_overdue_hours} hours.`);
  }

  /** A job's last-run state as a toned badge, with overdue outranking whatever that last run reported. */
  #jobStatusBadge(job) {
    const tones = { never_run: 'bad', abandoned: 'bad', failed: 'bad', running: 'ok', succeeded: 'good' };
    const labels = { never_run: 'never run', abandoned: 'abandoned', failed: 'failed', running: 'running',
      succeeded: 'ok' };
    const tone = job.overdue ? (tones[job.last_status] === 'bad' ? 'bad' : 'warn') : (tones[job.last_status] || 'good');
    const label = job.overdue && job.last_status === 'succeeded' ? 'overdue' : (labels[job.last_status] || job.last_status);
    return `<span class="ac-badge ac-badge--${tone}">${HealthPage.#esc(label)}</span>`;
  }

  /**
   * "4h ago" / "3d ago", or an explicit never. A hand-triggered last run says so, because it is the one run that
   * proves nothing about whether the schedule is still firing.
   */
  static #jobLastRun(job) {
    if (job.hours_since_last_run === null || job.hours_since_last_run === undefined) return 'never';
    const hours = job.hours_since_last_run;
    const when = hours < 1 ? 'under an hour ago' : hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
    return job.last_triggered_by === 'manual' ? `${when} (manual)` : when;
  }

  /** A run's wall-clock duration, or an em dash while it is still open. */
  static #jobDuration(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  /**
   * A run's own counts, flattened to `key: value` pairs. Every job reports a different shape, so this renders whatever
   * it stored rather than naming fields the panel would have to be taught one by one.
   */
  static #jobDetails(job) {
    if (job.last_error) return job.last_error;
    const details = job.last_details;
    if (!details || typeof details !== 'object') return '—';
    const parts = Object.entries(details)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${typeof value === 'number' ? value.toLocaleString() : value}`);
    return parts.length > 0 ? parts.join(', ') : '—';
  }

  // ---- Small helpers ---------------------------------------------------------------------------------------------

  /**
   * Renders a standard table into a container. Each header is either a plain string (a text column, left-aligned) or a
   * `[label, true]` pair marking a numeric column, whose header is right-aligned to sit over its `.ac-num` cells.
   *
   * @param {string} id - Container element id.
   * @param {Array<string|[string, boolean]>} headers - Column headers; `[label, true]` right-aligns a numeric column.
   * @param {string} bodyHtml - Pre-rendered `<tr>` rows.
   */
  #table(id, headers, bodyHtml) {
    const head = headers.map((h) => {
      const [label, num] = Array.isArray(h) ? h : [h, false];
      // Default `.ac-table thead th` is right-aligned; a text column opts into left via `ac-th-text`.
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

  /** Renders an "all clear" line for an empty panel. */
  #renderEmpty(id, msg) {
    this.#setHtml(id, `<p class="coverage-status"><span class="ac-badge ac-badge--good">✓</span> ${HealthPage.#esc(msg)}</p>`);
  }

  /** The counterpart to #renderEmpty for a panel with nothing to show *because the read failed*. */
  #renderProblem(id, msg) {
    this.#setHtml(id, `<p class="coverage-status"><span class="ac-badge ac-badge--bad">!</span> `
    + `${HealthPage.#esc(msg)}</p>`);
  }

  /** A session state as a toned badge ("idle in transaction" is the notable one). */
  #stateBadge(state) {
    if (!state) return '—';
    const tone = state.startsWith('idle in transaction') ? 'warn' : state === 'active' ? 'ok' : 'good';
    return `<span class="ac-badge ac-badge--${tone}">${HealthPage.#esc(state)}</span>`;
  }

  /** A query cell: the statement, or a note when the role can't read another session's statement text. */
  #queryCell(query) {
    if (HealthPage.#nil(query)) return '<em>hidden</em>';
    const q = query.length > 160 ? `${query.slice(0, 160)}…` : query;
    return `<code>${HealthPage.#esc(q)}</code>`;
  }

  #setKpi(id, value, tone) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = typeof value === 'number' ? HealthPage.#num(value) : value;
    el.classList.remove('health-kpi--good', 'health-kpi--warn', 'health-kpi--bad', 'health-kpi--ok');
    el.classList.add(`health-kpi--${tone}`);
  }

  #setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  /** True for null or undefined (JSON omits absent Option fields, so they arrive as undefined). */
  static #nil(value) {
    return value === null || value === undefined;
  }

  /** Escapes a value for safe insertion as HTML text. */
  static #esc(value) {
    if (HealthPage.#nil(value)) return '';
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Thousands-separated integer. */
  static #num(n) {
    return Number(n).toLocaleString('en-US');
  }

  /** Compact number ("1.2M", "317k"). */
  static #compact(n) {
    const v = Number(n);
    if (!isFinite(v)) return '—';
    // The M cutoff sits where the k form would round to "1000k" (999,500+), so that never renders.
    if (Math.abs(v) >= 999500) return `${(v / 1e6).toFixed(1)}M`;
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
    return String(v);
  }

  /** Seconds → short human duration ("3m 20s", "2h 5m", "4d 3h"). */
  static #dur(seconds) {
    if (HealthPage.#nil(seconds)) return '—';
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }

  /** Repaints just the "updated Ns ago" text; called on a 1s ticker between polls. */
  #renderAge() {
    const el = document.getElementById('health-meta-age');
    if (el) el.textContent = this.#ageText();
  }

  /**
   * Age of the last successful load as "Ns ago" / "Nm ago".
   *
   * @returns {string} The age text, or "—" before the first successful load.
   */
  #ageText() {
    if (HealthPage.#nil(this.#lastUpdatedMs)) return '—';
    const secs = Math.max(0, Math.round((Date.now() - this.#lastUpdatedMs) / 1000));
    return secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  }
}
