/**
 * The Google Analytics "new visitors" line shown above an engagement funnel (#5996), shared by the per-city funnels
 * and the Across Cities funnels.
 *
 * It sits apart from the funnel's bars because the two counts don't nest: GA counts browsers and skips most bots,
 * while the funnel's first step counts every account made, so it is usually far larger than GA's number.
 */

import { util } from '../common/utilities.js';

const TIP = 'First-time visitors counted by Google Analytics. A separate count from the accounts below: GA counts '
  + 'browsers and skips most bots, while every account made is counted here.';

/**
 * @param {number} frac - A 0–1 fraction (or above 1).
 * @returns {string} A percent, with one decimal below 10% so small conversion rates don't all read "1%".
 */
function pct(frac) {
  const p = (frac || 0) * 100;
  return `${p < 10 ? Math.round(p * 10) / 10 : Math.round(p)}%`;
}

/**
 * @typedef {{count: number, since: ?string, rate: ?number, rate_step: ?string}} GaVisitors A funnel's `ga_visitors`
 *   payload: `rate` is the share of the visitors that reached the step `rate_step`, and `since` is set only when GA
 *   covers less than the window.
 */

/**
 * @param {GaVisitors} ga - The funnel's `ga_visitors` payload.
 * @param {(stepKey: string) => string} stepLabel - Gives a funnel step's display name.
 * @returns {string} What the visitors line says after its count; empty when there is nothing to add.
 */
function detail(ga, stepLabel) {
  if (ga.rate !== null && ga.rate !== undefined) return `${pct(ga.rate)} reached “${stepLabel(ga.rate_step)}”`;
  const since = ga.since ? util.parseDate(ga.since) : null;
  if (!since || isNaN(since.getTime())) return '';
  return `since ${since.toLocaleDateString(undefined, util.SHORT_DATE)}`;
}

/**
 * @param {GaVisitors} ga - The funnel's `ga_visitors` payload.
 * @param {(stepKey: string) => string} stepLabel - Gives a funnel step's display name.
 * @returns {string} One sentence describing the funnel's GA visitors, for a table cell's tooltip.
 */
export function funnelVisitorsText(ga, stepLabel) {
  const extra = detail(ga, stepLabel);
  return `${(ga.count || 0).toLocaleString()} first-time visitors per Google Analytics${extra ? `; ${extra}` : ''}`;
}

/**
 * @param {?GaVisitors} ga - The funnel's `ga_visitors` payload.
 * @param {(stepKey: string) => string} stepLabel - Gives a funnel step's display name.
 * @returns {string} The visitors row for the top of a funnel panel, or '' when GA has nothing for this funnel.
 */
export function funnelVisitorsRowHtml(ga, stepLabel) {
  if (!ga) return '';
  const extra = detail(ga, stepLabel);
  const text = `${(ga.count || 0).toLocaleString()}${extra ? ` · ${extra}` : ''}`;
  return `
    <div class="ac-funnel-step ac-funnel-step--ga">
      <div class="ac-funnel-step-label">New visitors (Google Analytics)</div>
      <div class="ac-funnel-ga" tabindex="0" data-ps-tooltip="${util.escapeHTML(TIP)}">${util.escapeHTML(text)}</div>
    </div>`;
}
