/**
 * The selected neighborhood's profile beside the map on the city reports page (#6041). The server renders it for the
 * neighborhood the page opens on (app/views/apps/report/cityPanel.scala.html); this redraws the same markup for each
 * later selection. Every value comes from the page's data already in words, so the server stays the one place a
 * neighborhood's sentence, dates and distances are written; only the panel's own labels are translated here.
 */

import { localizeSubtree } from '../common/i18nDom.js';
import { util } from '../common/utilities.js';

/**
 * @typedef {object} CityReportRowText
 * @property {?string} score - The score as the page prints it, or null when there is none.
 * @property {string} why - The sentence saying what lowers it.
 * @property {?string} explored
 * @property {?string} toGo - How much more must be explored before it is scored.
 * @property {?string} reviewed
 * @property {?string} latest
 * @property {?string} imagery
 * @property {?string} labelers
 * @property {?string} density
 * @property {?string} streets
 *
 * @typedef {object} CityReportRow
 * @property {number} id
 * @property {string} name
 * @property {string} report - Its report's address.
 * @property {?string} explore - Explore's address for it, when it asks for help exploring.
 * @property {boolean} scored
 * @property {boolean} provisional
 * @property {boolean} hasStreets
 * @property {?number} score - 0 to 1.
 * @property {Array<{type: string, share: number}>} causes - What lowers it, largest first, on the city's one scale.
 * @property {CityReportRowText} text
 */

/**
 * One fact in the panel's list.
 * @param {string} key - Its label's key in the report namespace.
 * @param {?string} value - The value in words; null for none.
 * @param {boolean} qualityReady - Whether a missing value means "none" or "still counting".
 * @returns {string} Markup.
 */
function fact(key, value, qualityReady) {
  const fallback = qualityReady ? 'report:city.no-data' : 'report:city.counting';
  const dd = value === null
    ? `<dd data-i18n="${util.escapeHTML(fallback)}"></dd>`
    : `<dd>${util.escapeHTML(value)}</dd>`;
  return `<div class="reports-panel__fact"><dt data-i18n="report:city.${util.escapeHTML(key)}"></dt>${dd}</div>`;
}

/**
 * The score, or the words for none.
 * @param {CityReportRow} row
 * @returns {string} Markup.
 */
function headOf(row) {
  if (!row.scored) {
    return '<p class="reports-panel__score reports-panel__score--none" data-i18n="report:city.not-scored"></p>';
  }
  return `<span class="reports-swatch reports-swatch--large" data-score="${Number(row.score)}"
    aria-hidden="true"></span><p class="reports-panel__score">${util.escapeHTML(row.text.score)}</p>`;
}

/**
 * One bar per type that lowers the score, on the city's one scale.
 * @param {CityReportRow} row
 * @param {Record<string, string>} typeNames - Each type's name in the page's language.
 * @returns {string} Markup; empty when nothing lowers it.
 */
function causesOf(row, typeNames) {
  if (!row.causes.length) return '';
  const barClass = row.provisional ? 'reports-bar reports-bar--provisional' : 'reports-bar';
  const items = row.causes.map((c) => `
    <li>
      <span class="reports-panel__cause-name">${util.escapeHTML(typeNames[c.type] ?? c.type)}</span>
      <span class="${barClass}" aria-hidden="true"><span class="reports-bar__seg"
        data-label-type="${util.escapeHTML(c.type)}" data-share="${Number(c.share)}"></span></span>
    </li>`);
  return `<ul class="reports-panel__causes">${items.join('')}</ul>`;
}

/**
 * The links to its report and, when it asks for help, to Explore.
 * @param {CityReportRow} row
 * @returns {string} Markup.
 */
function linksOf(row) {
  const report = `<a class="reports-link" href="${util.escapeHTML(row.report)}" data-city-event="OpenReport"
    data-i18n="report:city.open-report"></a>`;
  if (!row.explore) return report;
  return `${report}<a class="reports-link" href="${util.escapeHTML(row.explore)}" data-city-event="HelpExplore"
    data-i18n="report:city.help-explore"></a>`;
}

/**
 * Redraws the panel for a neighborhood.
 * @param {HTMLElement} panel - The `#reports-panel` section.
 * @param {CityReportRow} row - The neighborhood.
 * @param {{qualityReady: boolean, typeNames: Record<string, string>}} page - What the page knows of the city.
 */
export function renderPanel(panel, row, page) {
  const { text } = row;
  const explored = text.toGo ? `${text.explored} · ${text.toGo}` : text.explored;
  const provisional = row.provisional ? '<p class="reports-provisional" data-i18n="report:city.provisional"></p>' : '';
  const facts = [
    row.hasStreets ? fact('explored', explored, true) : '',
    fact('reviewed', text.reviewed, page.qualityReady),
    fact('latest', text.latest, page.qualityReady),
    fact('imagery', text.imagery, page.qualityReady),
    fact('labelers', text.labelers, page.qualityReady),
    fact('observations', text.density, page.qualityReady),
    row.hasStreets ? fact('streets', text.streets, true) : '',
  ];
  panel.dataset.regionId = String(row.id);
  panel.innerHTML = `
    <div class="reports-panel__head">
      ${headOf(row)}
      <h2 class="reports-panel__name" id="reports-panel-name">${util.escapeHTML(row.name)}</h2>
    </div>
    <p class="reports-panel__why">${util.escapeHTML(text.why)}</p>
    ${provisional}
    ${causesOf(row, page.typeNames)}
    <dl class="reports-panel__facts">${facts.join('')}</dl>
    <p class="reports-panel__links">${linksOf(row)}</p>`;
  localizeSubtree(panel);
}
