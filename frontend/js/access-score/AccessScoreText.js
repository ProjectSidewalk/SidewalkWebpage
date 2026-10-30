/**
 * The AccessScore tool's shared wording helpers (#5748): the figures and titles the map's tooltips, the street panel
 * and the region popup all print, so a score reads the same everywhere. Every helper that returns markup escapes
 * what it interpolates; the ones that return plain text say so.
 */

import i18next from 'i18next';
import { util } from '../common/utilities.js';
import { AccessScoreGradeRamp } from '../common/AccessScoreGradeRamp.js';
/** @typedef {import('./AccessScoreModel.js').AccessScoreStreetExplanation} AccessScoreStreetExplanation */

/**
 * A score in [0, 1] as the 0–100 figure people see, to one decimal. Plain text.
 * @param {number} score - The score.
 * @returns {string} "81.8".
 */
export function formatScore(score) {
  return (score * 100).toFixed(1);
}

/**
 * A length in meters in the reader's unit system, through i18next's distance formatter. Escaped for markup.
 * @param {number} meters - The length.
 * @returns {string} "375 ft".
 */
export function formatLength(meters) {
  return i18next.t('accessscore:length', { meters, interpolation: { escapeValue: true } });
}

/**
 * An elevation, a rise, or a short stretch of street in meters, to the whole meter or foot. Not `formatLength`: its
 * nearest-25 rounding suits a street's length and would turn a 7 ft drop into "0 ft".
 * @param {number} meters - The height or length.
 * @param {{escape?: boolean}} [options] - `escape` false for a text sink (the elevation profile escapes what it is
 *   given where that meets its own markup).
 * @returns {string} "7 ft".
 */
export function formatElevation(meters, { escape = true } = {}) {
  return i18next.t('accessscore:elevation', { meters, interpolation: { escapeValue: escape } });
}

/**
 * A signed effect on a score, as text ("+1.43", "−7.24").
 * @param {number} value - The term.
 * @returns {string} Two decimals with a sign; the minus is the typographic one.
 */
export function signed(value) {
  return (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(2);
}

/**
 * A grade as a percentage, escaped for markup.
 * @param {number} grade - A grade as a fraction (0.05 is 5%).
 * @returns {string} "5.0%".
 */
export function percentHtml(grade) {
  return util.escapeHTML(AccessScoreGradeRamp.percent(grade));
}

/**
 * "Tuxedo Square · Street 1932", or just the id for an unnamed way. Escaped for markup: the name is OSM's.
 * @param {{name: ?string, streetId: number}} s - A street explanation, or anything with its name and id.
 * @returns {string} The title.
 */
export function streetTitle(s) {
  return s.name
    ? i18next.t('accessscore:popup-street-named', {
        name: s.name, id: s.streetId, interpolation: { escapeValue: true },
      })
    : i18next.t('accessscore:popup-street', { id: s.streetId, interpolation: { escapeValue: true } });
}

/**
 * The three numbers behind a street's headline: its block and the crossings at either end ("—" for none).
 * @param {AccessScoreStreetExplanation} s - An audited street.
 * @returns {string} A line of markup.
 */
export function componentsHtml(s) {
  const end = (e) => (e && e.score !== null ? formatScore(e.score) : '—');
  return `<div class="acs-popup__components">${i18next.t('accessscore:score-components', {
    segment: formatScore(s.segmentScore), start: end(s.startIntersection), end: end(s.endIntersection),
    interpolation: { escapeValue: true },
  })}</div>`;
}

/**
 * The one call to action a card has: go and see the sidewalks there in Explore.
 * @param {{lat: number, lng: number}} lngLat - Where Explore should open.
 * @returns {string} The link's markup, logged through `data-acs-hop`.
 */
export function hopLinksHtml(lngLat) {
  const lat = lngLat.lat.toFixed(5);
  const lng = lngLat.lng.toFixed(5);
  return `<div class="acs-popup__links">
    <a href="/explore?lat=${lat}&lng=${lng}" class="button button--small button--primary"
       data-acs-hop="ExploreHere">${i18next.t('accessscore:explore-here')}</a>
  </div>`;
}
