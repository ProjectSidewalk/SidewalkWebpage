/**
 * The client's knowledge of the Gallery's admin "Sort by" (#2705): which sort names mean an order at all, and when
 * the filters leave a sort nothing to rank.
 *
 * The order itself is never re-derived here. The server's `GallerySort` ranks the labels and the page keeps them in
 * the sequence they arrived in (`CardContainer`), so a card's severity or votes changing under the admin can't move
 * it between pages. The sort names are the enum's wire names; the page never lists them itself (the `<select>` is
 * rendered from the enum).
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
 * Why a sort can't tell the filtered labels apart, if it can't; null when it can.
 *
 * Filters narrow and the sort orders what is left, so some pairs leave the sort nothing to do: every label in a
 * pool of unvalidated labels has the same (absent) dispute ratio, and every label in one severity level, or of an
 * unrated type, has the same rating. The sort then falls through to its tiebreak (newest first), which is correct
 * but silent; this is what lets the page say so rather than claim an order it isn't applying. Newest and Oldest
 * always have something to rank.
 *
 * @param {string} sort - A `GallerySort` wire name.
 * @param {{validations: string[], severities: (string[]|undefined), anyRatedType: boolean}} filters - What the
 *      sidebar has applied: the validation options checked, the severity levels checked (`undefined` when no selected
 *      type carries a rating, as CardContainer sends it), and whether any selected type carries a rating.
 * @returns {?('no-validated'|'no-rated-type'|'one-severity')} The reason, as the suffix of its `gallery:sort-moot-*`
 *      message key, or null.
 */
export function sortMootReason(sort, { validations, severities, anyRatedType }) {
  if (sort === 'most_disputed') {
    return validations.length === 1 && validations[0] === 'unvalidated' ? 'no-validated' : null;
  }
  if (sort === 'most_severe' || sort === 'least_severe') {
    if (!anyRatedType) return 'no-rated-type';
    // One level checked, the "N/A" bucket included, is one rating for every label shown.
    return severities !== undefined && severities.length === 1 ? 'one-severity' : null;
  }
  return null;
}
