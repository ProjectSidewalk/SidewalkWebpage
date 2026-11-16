/**
 * Gallery's card, on a report. Gallery's own endpoint supplies what a card is drawn from, so a card here reads
 * the same as one there, votes the same way, and credits its imagery the same way.
 */

import { Card } from '../gallery/cards/Card.js';

const LABELS_URL = '/label/labels';
const VOTE_SOURCE = 'Report';
// Gallery's filter asks which tags to show first; a report has no tag filter.
const NO_FILTER = { getAppliedTagNames: () => [] };

/**
 * Asks for the labels behind some cards.
 * @param {number[]} labelIds - In the order to get them back.
 * @returns {Promise<Map<number, Record<string, any>>>} What each card is built from, by label id. An id the server
 *   can't serve is simply missing.
 */
export async function fetchCardData(labelIds) {
  if (labelIds.length === 0) return new Map();
  const response = await fetch(LABELS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ n: labelIds.length, label_ids: labelIds, loaded_labels: [] }),
  });
  if (!response.ok) throw new Error(`${LABELS_URL} responded ${response.status}`);
  const { labelsOfType } = await response.json();
  return new Map(labelsOfType.map((entry) => [entry.label.label_id, entry]));
}

/**
 * Builds a card from what the endpoint returned, using the small thumbnail and never the billable Street View still a
 * Gallery card falls back to: with no crop, a report's card shows its placeholder.
 * @param {Record<string, any>} entry - One entry from `fetchCardData`.
 * @param {(action: string) => void} log - Records what the reader does with the card.
 * @returns {Card} The card, not yet rendered.
 */
export function buildCard(entry, log) {
  const tracker = { push: (action) => log(`Report_Card_${action}`) };
  return new Card(
    /** @type {any} */ ({ ...entry, cropUrl: entry.thumbnailUrl ?? entry.cropUrl, gsvImageUrl: null }),
    {},
    /** @type {any} */ (tracker),
    /** @type {any} */ (NO_FILTER),
    { voteSource: VOTE_SOURCE },
  );
}
