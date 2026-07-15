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
      this.#thresholds = data.thresholds || {};
      this.#renderPulse(data);
      this.#renderKpis(data);
      this.#renderMeta(data);
      this.#renderLocks(data.blocking_sessions || []);
      this.#renderIdle(data.idle_in_transaction || []);
      this.#renderEvolutions(data.stuck_evolutions || []);
      this.#renderBloat(data.table_bloat || []);
      this.#renderConnections(data.connections || []);
      this.#renderPanos(data.pano_backups || null);
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
    const idle = data.idle_in_transaction || [];
    const evolutions = data.stuck_evolutions || [];
    const conns = (data.connections || []).reduce((sum, c) => sum + (c.count || 0), 0);
    const atRisk = data.pano_backups?.at_risk;
    const bloated = (data.table_bloat || []).filter((b) => this.#bloatTone(b) !== 'good').length;
    const longIdle = idle.filter((s) => (s.idle_seconds || 0) >= t.idle_txn_warn_seconds).length;
    this.#setKpi('kpi-blocking', blocking.length, blocking.length > 0 ? 'bad' : 'good');
    this.#setKpi('kpi-idle', idle.length, longIdle > 0 ? 'warn' : 'good');
    this.#setKpi('kpi-evolutions', evolutions.length, evolutions.length > 0 ? 'bad' : 'good');
    this.#setKpi('kpi-bloat', bloated, bloated > 0 ? 'warn' : 'good');
    this.#setKpi('kpi-connections', conns, 'ok');
    this.#setKpi('kpi-panos', HealthPage.#nil(atRisk) ? '—' : HealthPage.#compact(atRisk), atRisk > 0 ? 'warn' : 'good');
  }

  /** Renders the "updated Ns ago · db · role" meta line, including whether other sessions' query text is visible. */
  #renderMeta(data) {
    const parts = [];
    if (data.generated_at) parts.push(`updated ${HealthPage.#ago(data.generated_at)}`);
    if (data.current_database) parts.push(`db <code>${HealthPage.#esc(data.current_database)}</code>`);
    if (data.current_role) parts.push(`role <code>${HealthPage.#esc(data.current_role)}</code>`);
    if (data.can_see_all_queries === false) {
      parts.push('statement text of other sessions is hidden (role lacks <code>pg_monitor</code>)');
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
      ['PID', 'Role', 'State', 'Txn age', 'Blocks', 'Longest wait', 'Held locks', 'Query'], body);
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
    this.#table('health-idle', ['PID', 'Role', 'Application', 'Idle for', 'Txn age', 'Query'], body);
  }

  // ---- Panel: stuck evolutions -----------------------------------------------------------------------------------

  #renderEvolutions(rows) {
    if (!rows.length) return this.#renderEmpty('health-evolutions', 'All evolutions are applied cleanly.');
    const body = rows.map((r) => `
        <tr class="ac-row--flagged">
          <td>${HealthPage.#esc(r.schema)}</td>
          <td class="ac-num">${r.id}</td>
          <td><span class="ac-badge ac-badge--bad">${HealthPage.#esc(r.state) || 'unknown'}</span></td>
          <td class="ac-muted">${HealthPage.#esc(r.last_problem) || '—'}</td>
        </tr>`).join('');
    this.#table('health-evolutions', ['Schema', 'Evolution', 'State', 'Problem'], body);
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
      ['Schema', 'Table', 'Live rows', 'Dead rows', 'Dead ratio', 'Last vacuum'], body);
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
    this.#table('health-connections',
      ['Role', `Active (pool ${t.conn_pool_max})`, 'Idle', 'Total'], body);
  }

  // ---- Panel: pano downloads -------------------------------------------------------------------------------------

  #renderPanos(p) {
    if (!p) return this.#renderEmpty('health-panos', 'Pano backup stats are unavailable.');
    const pct = p.labeled_panos > 0 ? Math.round((p.backed_up / p.labeled_panos) * 100) : 0;
    const atRisk = p.at_risk > 0
      ? `<span class="ac-badge ac-badge--warn">${HealthPage.#compact(p.at_risk)}</span>`
      : HealthPage.#compact(p.at_risk);
    const cards = [
      { value: HealthPage.#compact(p.labeled_panos), label: 'Labeled panos' },
      { value: HealthPage.#compact(p.backed_up), label: `Backed up (${pct}%)` },
      { value: HealthPage.#compact(p.unchecked), label: 'Unchecked' },
      { value: HealthPage.#compact(p.no_backup), label: 'No backup' },
      { value: HealthPage.#compact(p.missing_metadata), label: 'No metadata row' },
      { value: atRisk, label: 'At risk (expired, no backup)' },
    ];
    const html = cards.map((c) => `
        <div class="coverage-kpi">
          <span class="coverage-kpi-value">${c.value}</span>
          <span class="coverage-kpi-label">${c.label}</span>
        </div>`).join('');
    this.#setHtml('health-panos', `<div class="coverage-kpis">${html}</div>`);
    this.#setHtml('health-panos-note',
      'Backup status is refreshed lazily by the nightly imagery check, so a large "unchecked" count is normal '
      + 'and these figures approximate what is actually on disk.');
  }

  // ---- Small helpers ---------------------------------------------------------------------------------------------

  /** Renders a standard table into a container. */
  #table(id, headers, bodyHtml) {
    const head = headers.map((h) => `<th class="ac-th-text">${h}</th>`).join('');
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
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
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

  /** ISO timestamp → "Ns ago" / "Nm ago". */
  static #ago(iso) {
    const then = Date.parse(iso);
    if (isNaN(then)) return '—';
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    return secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  }
}
