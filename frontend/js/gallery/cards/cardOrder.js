/**
 * The client's half of the Gallery's admin "Sort by" (#2705): the order the server's `GallerySort` puts cards in,
 * re-applied to the cards the page holds.
 *
 * Cards from several fetches sit in per-type buckets, so a page is assembled by sorting what has been loaded. That
 * only shows the server's order if this comparator is the server's ordering exactly — same keys, same direction,
 * unrated and unvalidated labels last, `label_id` descending as the tiebreak — so a change to one has to be made to
 * `app/models/gallery/GallerySort.scala` as well. The option names are the enum's wire names; the page never lists
 * them itself (the `<select>` is rendered from the enum).
 */

/** The sort the Gallery is in when no order has been asked for, and the only one a non-admin ever sees. */
export const RANDOM_SORT = 'random';

/**
 * Whether a sort name asks for a strict order, as opposed to the random default.
 * @param {string|undefined|null} sort - A `GallerySort` wire name.
 * @returns {boolean}
 */
export function isSorted(sort) {
  return Boolean(sort) && sort !== RANDOM_SORT;
}

/**
 * Compares two optional numbers so that values come first in `inner`'s order and absent ones (null/undefined) last,
 * the way Postgres `NULLS LAST` does.
 * @param {(a: number, b: number) => number} inner
 * @returns {(a: ?number, b: ?number) => number}
 */
function nullsLast(inner) {
  return (a, b) => {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    return inner(a, b);
  };
}

const ascending = (a, b) => a - b;
const descending = (a, b) => b - a;

/**
 * The share of a label's votes that disagree, or null for a label nobody has voted on (which sorts last).
 * @param {Record<string, any>} props - A card's label properties (`val_counts` is how Card keeps the three counts).
 * @returns {?number}
 */
function disputeRatio(props) {
  const counts = props.val_counts ?? {};
  const total = (counts.Agree ?? 0) + (counts.Disagree ?? 0) + (counts.Unsure ?? 0);
  return total === 0 ? null : (counts.Disagree ?? 0) / total;
}

/** The primary key of each sort, over a card's label properties, before the `label_id` tiebreak. */
const PRIMARY = {
  newest: (a, b) => descending(Date.parse(a.label_timestamp), Date.parse(b.label_timestamp)),
  oldest: (a, b) => ascending(Date.parse(a.label_timestamp), Date.parse(b.label_timestamp)),
  most_severe: (a, b) => nullsLast(descending)(a.severity, b.severity),
  least_severe: (a, b) => nullsLast(ascending)(a.severity, b.severity),
  most_disputed: (a, b) => nullsLast(descending)(disputeRatio(a), disputeRatio(b)),
};

/** @typedef {{getProperties: () => Record<string, any>}} Comparable A card, or anything that answers like one. */

/**
 * A comparator over cards for a sort, or null for the random default (which is not an order to re-apply).
 *
 * @param {string} sort - A `GallerySort` wire name.
 * @returns {?((a: Comparable, b: Comparable) => number)}
 */
export function compareCards(sort) {
  const primary = PRIMARY[sort];
  if (!primary) return null;
  return (cardA, cardB) => {
    const a = cardA.getProperties();
    const b = cardB.getProperties();
    return primary(a, b) || descending(a.label_id, b.label_id);
  };
}
