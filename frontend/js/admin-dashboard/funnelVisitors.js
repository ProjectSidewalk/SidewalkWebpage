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
 * What the visitors line says after its count: the share that reached the funnel's second step, or, for all time,
 * the day GA's history starts.
 *
 * @param {{count: number, since: ?string, second_step_rate: ?number}} ga - The funnel's `ga_visitors` payload.
 * @param {string} secondStepLabel - Display name of the funnel's second step.
 * @returns {string} Plain text; empty when there is nothing to add.
 */
function detail(ga, secondStepLabel) {
  if (ga.second_step_rate !== null && ga.second_step_rate !== undefined) {
    return `${pct(ga.second_step_rate)} reached “${secondStepLabel}”`;
  }
  const since = ga.since ? util.parseDate(ga.since) : null;
  if (!since || isNaN(since.getTime())) return '';
  return `since ${since.toLocaleDateString(undefined, util.SHORT_DATE)}`;
}

/**
 * @param {{count: number, since: ?string, second_step_rate: ?number}} ga - The funnel's `ga_visitors` payload.
 * @param {string} secondStepLabel - Display name of the funnel's second step.
 * @returns {string} One sentence describing the funnel's GA visitors, for a table cell's tooltip.
 */
export function funnelVisitorsText(ga, secondStepLabel) {
  const extra = detail(ga, secondStepLabel);
  return `${(ga.count || 0).toLocaleString()} first-time visitors per Google Analytics${extra ? `; ${extra}` : ''}`;
}

/**
 * @param {?{count: number, since: ?string, second_step_rate: ?number}} ga - The funnel's `ga_visitors` payload.
 * @param {string} secondStepLabel - Display name of the funnel's second step.
 * @returns {string} The visitors row for the top of a funnel panel, or '' when GA has nothing for this funnel.
 */
export function funnelVisitorsRowHtml(ga, secondStepLabel) {
  if (!ga) return '';
  const extra = detail(ga, secondStepLabel);
  const text = `${(ga.count || 0).toLocaleString()}${extra ? ` · ${extra}` : ''}`;
  return `
    <div class="ac-funnel-step ac-funnel-step--ga">
      <div class="ac-funnel-step-label">New visitors (Google Analytics)</div>
      <div class="ac-funnel-ga" tabindex="0" data-ps-tooltip="${util.escapeHTML(TIP)}">${util.escapeHTML(text)}</div>
    </div>`;
}
