/**
 * The canned reasons a validator can give for a Disagree or Unsure vote, per label type (#5475).
 *
 * Read from the catalog `ValidationReason` stamps onto every page as `window.validationReasons` (main.scala.html),
 * in the shape `{CurbRamp: {Disagree: ['wrong-type', …], Unsure: […]}, …}`. That stamp is the only copy the
 * frontend gets: the Validate menus, the label detail card and the Gallery cards all build their reason lists
 * here rather than keeping a parallel set of literals that could drift from the backend, and the id a validator
 * picks is stored beside their comment as `validation_task_comment.reason`.
 *
 * Text and tooltips come from the locale files under the same ids (`common:validation-reason.<id>.text`, `.tooltip`,
 * and a per-type `.tooltip-<label-type>` where one type needs its own wording), so the stamp stays language-free.
 * A page that doesn't stamp the catalog (jsdom, the error pages) gets empty lists rather than an error.
 */

import i18next from 'i18next';
import { camelToKebab } from './utilities.js';

/** @returns {Record<string, Record<string, string[]>>} The stamped catalog, or an empty one off the page. */
const catalog = () => (window.validationReasons && typeof window.validationReasons === 'object'
  ? window.validationReasons
  : {});

/**
 * @param {string} key - An i18next key.
 * @returns {?string} Its translation, or null for a key the locale files don't carry. A test double without
 *     `exists` is taken at its word, so a suite that never looks at a reason's text needn't model the catalog.
 */
const translate = (key) => {
  if (typeof i18next.exists === 'function' && !i18next.exists(key)) return null;
  return i18next.t(key);
};

export const validationReasons = {
  /** @returns {string[]} The label types with any canned reason, in the backend's canonical order. */
  labelTypes: () => Object.keys(catalog()),

  /**
   * @param {string} labelType - A label type name, e.g. 'CurbRamp'.
   * @param {string} vote - 'Disagree' or 'Unsure' ('Agree' carries no reasons).
   * @returns {string[]} The reason ids that type offers for that vote, in menu order; empty when it offers none.
   */
  idsFor(labelType, vote) {
    const ids = catalog()[labelType]?.[vote];
    return Array.isArray(ids) ? [...ids] : [];
  },

  /**
   * @param {string} labelType - A label type name.
   * @param {string} vote - 'Disagree' or 'Unsure'.
   * @returns {boolean} Whether that type offers any canned reason for that vote.
   */
  hasReasons(labelType, vote) {
    return this.idsFor(labelType, vote).length > 0;
  },

  /**
   * Whether a comment outlives a card's vote change, restating `ValidationService`'s rule (#5475): typed words
   * always do, since they describe the label; a canned reason only when the new vote offers it too.
   * @param {string} labelType - The label's type.
   * @param {?string} reason - The comment's canned reason id, or null/undefined for typed words.
   * @param {string} vote - The vote it changed to.
   * @returns {boolean}
   */
  survivesVoteChange(labelType, reason, vote) {
    return typeof reason !== 'string' || this.idsFor(labelType, vote).includes(reason);
  },

  /**
   * @param {string} id - A reason id from the catalog.
   * @returns {?string} Its text in the current language, or null for an id the locale files don't know (a stale
   *     stamp, or a comment tagged by a newer vocabulary than this page's).
   */
  text(id) {
    return translate(`common:validation-reason.${id}.text`);
  },

  /**
   * @param {string} id - A reason id from the catalog.
   * @param {string} labelType - The label type it is being offered on; a type with its own wording wins.
   * @returns {?string} The tooltip explaining when the reason applies, or null when the reason has none.
   */
  tooltip(id, labelType) {
    return translate(`common:validation-reason.${id}.tooltip-${camelToKebab(labelType)}`)
      ?? translate(`common:validation-reason.${id}.tooltip`);
  },

  /**
   * The reasons to offer, with their strings resolved.
   *
   * @param {string} labelType - A label type name.
   * @param {string} vote - 'Disagree' or 'Unsure'.
   * @returns {{id: string, text: string, tooltip: ?string}[]} In menu order; a reason whose text the locale files
   *     lack is left out rather than shown as a raw key.
   */
  forLabel(labelType, vote) {
    return this.idsFor(labelType, vote)
      .map((id) => ({ id, text: this.text(id), tooltip: this.tooltip(id, labelType) }))
      .filter((reason) => reason.text !== null);
  },
};
