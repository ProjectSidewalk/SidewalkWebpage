/**
 * A neighborhood's card on the city reports map (#6041). Hovering a shape shows it beside the pointer; a click pins
 * it with the neighborhood's links, the map's way to its report. Its words come from the page's data, as the panel's
 * do, so only the card's own labels are translated here.
 */

import { localizeSubtree } from '../common/i18nDom.js';
import { util } from '../common/utilities.js';
import { linksOf } from './cityReportPanel.js';

/**
 * Builds the card.
 * @param {import('./cityReportPanel.js').CityReportRow} row - The neighborhood.
 * @param {{scoresReady: boolean, pinned: boolean}} options - Whether the city's scores are in (until then a missing
 *   score goes unsaid, as in the table), and whether the card is pinned, which swaps the click hint for the links.
 * @returns {HTMLElement} The card, localized.
 */
export function mapCard(row, { scoresReady, pinned }) {
  let score = '';
  if (row.scored) {
    score = `<p class="reports-map-card__score">${util.escapeHTML(row.text.score)}</p>`;
  } else if (scoresReady && row.hasStreets) {
    score = '<p class="reports-map-card__score reports-map-card__score--none" data-i18n="report:city.not-scored"></p>';
  }
  // Once scores are in, an unscored neighborhood's sentence already says how much is explored.
  const explored = row.hasStreets && row.text.explored && (row.scored || !scoresReady)
    ? `<p class="reports-map-card__explored"><span data-i18n="report:city.explored"></span>
      ${util.escapeHTML(row.text.explored)}</p>`
    : '';
  const foot = pinned
    // eslint-disable-next-line ps/escape-in-markup -- linksOf escapes its own values.
    ? `<p class="reports-map-card__links">${linksOf(row)}</p>`
    : '<p class="reports-map-card__hint" data-i18n="report:city.map-hint"></p>';

  const card = document.createElement('div');
  card.className = 'reports-map-card';
  card.dataset.regionId = String(row.id);
  card.innerHTML = `
    <p class="reports-map-card__name">${util.escapeHTML(row.name)}</p>
    ${score}
    <p class="reports-map-card__why">${util.escapeHTML(row.text.why)}</p>
    ${explored}
    ${foot}`;
  localizeSubtree(card);
  return card;
}
