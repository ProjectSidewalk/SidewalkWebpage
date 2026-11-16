/**
 * Renders this deployment's own Google Analytics traffic on the admin Activity page (#5996): headline numbers, weekly
 * sessions, and where visitors came from. The per-city counterpart of the Across Cities traffic table; it reads
 * /adminapi/traffic (this city's GA property only).
 *
 * GA being unconfigured or down leaves a one-line note in place of the section's contents, never a broken page.
 */

import { util } from '../common/utilities.js';
import { AdminShell } from './AdminShell.js';
import { MiniLineChart } from './MiniLineChart.js';

export class TrafficSection {
  #trafficUrl;
  #bodyId;
  #statusId;

  /** @param {{trafficUrl: string, bodyId: string, statusId: string}} opts */
  constructor(opts) {
    this.#trafficUrl = opts.trafficUrl;
    this.#bodyId = opts.bodyId;
    this.#statusId = opts.statusId;
  }

  /** Fetches this city's traffic and renders it, or leaves a note when there is none to show. */
  async init() {
    AdminShell.setText(this.#statusId, 'Loading traffic…');
    try {
      const data = await util.fetchJson(this.#trafficUrl);
      if (!data || !data.available) {
        this.#setUnavailable();
        return;
      }
      this.#render(data);
    } catch (err) {
      console.error('Traffic load failed:', err);
      this.#setUnavailable();
    }
  }

  #setUnavailable() {
    document.getElementById(this.#bodyId).hidden = true;
    AdminShell.setText(this.#statusId, 'Traffic data unavailable.');
  }

  /**
   * @param {{fetched_at: string, traffic: Record<string, any>,
   *   top_sources: ?Array<{source: string, medium: string, sessions: number}>}} data - The /adminapi/traffic answer.
   */
  #render(data) {
    const t = data.traffic;
    const body = document.getElementById(this.#bodyId);
    body.querySelector('[data-traffic="kpis"]').innerHTML = [
      this.#kpi(AdminShell.num(t.sessions_7d), 'Sessions', this.#change(t.sessions_7d, t.sessions_prior_7d)),
      this.#kpi(AdminShell.num(t.active_users_7d), 'Visitors',
        this.#change(t.active_users_7d, t.active_users_prior_7d)),
      this.#kpi(this.#pct(t.engagement_rate_7d), 'Engaged sessions', 'last 7 days'),
      this.#kpi(AdminShell.num(t.new_visitors_30d), 'New visitors', 'last 30 days'),
      this.#kpi(this.#pct(t.mobile_share_30d), 'On mobile or tablet', 'last 30 days'),
    ].join('');
    this.#renderWeekly(body.querySelector('[data-traffic="weekly"]'), t.weekly_sessions || [],
      t.weekly_sessions_end);
    this.#renderSources(body.querySelector('[data-traffic="sources"]'), data.top_sources);
    const asOf = new Date(data.fetched_at);
    AdminShell.setText(this.#statusId, isNaN(asOf.getTime())
      ? ''
      : `Data as of ${asOf.toLocaleString(undefined, util.SHORT_DATE_TIME)}.`);
  }

  /**
   * @param {string} value - The headline figure, already formatted.
   * @param {string} label - What it counts.
   * @param {string} note - The small line under the label.
   * @returns {string} One KPI tile's HTML.
   */
  #kpi(value, label, note) {
    return `
      <div class="ps-kpi">
        <span class="ps-kpi-value">${util.escapeHTML(value)}</span>
        <span class="ps-kpi-label">${util.escapeHTML(label)}</span>
        <span class="ps-kpi-note">${util.escapeHTML(note)}</span>
      </div>`;
  }

  /**
   * @param {number} current - The last 7 days' count.
   * @param {number} prior - The count for the 7 days before.
   * @returns {string} The KPI note comparing the two.
   */
  #change(current, prior) {
    if (!prior) return 'last 7 days';
    const delta = Math.round(((current - prior) / prior) * 100);
    const dir = delta > 0 ? 'up' : 'down';
    return delta === 0 ? 'last 7 days, same as the week before' : `last 7 days, ${dir} ${Math.abs(delta)}%`;
  }

  /**
   * Draws the weekly sessions bars, each labeled by the day its 7-day block ends.
   *
   * @param {HTMLElement} host - Where the chart goes.
   * @param {number[]} weeks - Sessions per trailing week, oldest first.
   * @param {?string} weeksEnd - Last day of the last block, as `YYYY-MM-DD`; absent with no sessions at all.
   */
  #renderWeekly(host, weeks, weeksEnd) {
    const end = weeksEnd ? util.parseDate(weeksEnd) : null;
    if (weeks.length < 2 || !end || isNaN(end.getTime())) {
      host.innerHTML = '<p class="dq-empty">Not enough traffic history to chart yet.</p>';
      return;
    }
    const labels = weeks.map((_, i) => {
      const d = new Date(end);
      d.setDate(d.getDate() - 7 * (weeks.length - 1 - i));
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });
    host.innerHTML = '<div class="mini-host"></div>';
    MiniLineChart.renderInto(host.querySelector('.mini-host'), labels, [{
      name: 'Sessions',
      key: 'activity',
      values: weeks,
      tooltips: weeks.map((v, i) => `Week to ${labels[i]}: ${AdminShell.count(v, 'session')}`),
    }], { kind: 'bar', ariaLabel: 'Sessions per week' });
  }

  /**
   * @param {HTMLElement} host - Where the table goes.
   * @param {?Array<{source: string, medium: string, sessions: number}>} sources - Busiest sources first; null when
   *   only that report failed.
   */
  #renderSources(host, sources) {
    if (!sources) {
      host.innerHTML = '<p class="dq-empty">Sources unavailable.</p>';
      return;
    }
    if (!sources.length) {
      host.innerHTML = '<p class="dq-empty">No sessions in the last 30 days.</p>';
      return;
    }
    const rows = sources.map((s) => `
      <tr>
        <td>${util.escapeHTML(s.source)}</td>
        <td>${util.escapeHTML(s.medium)}</td>
        <td class="ac-num">${AdminShell.num(s.sessions)}</td>
      </tr>`).join('');
    host.innerHTML = AdminShell.tableHtml(['Source', 'Medium', ['Sessions', true]], rows);
  }

  /** A 0–1 fraction as a rounded percent. */
  #pct(frac) {
    return `${Math.round((frac || 0) * 100)}%`;
  }
}
