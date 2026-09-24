/**
 * The canned reasons a validator can give for a Disagree or Unsure vote, per label type (#5475).
 *
 * Read from the catalog `ValidationReason` stamps onto every page as `window.validationReasons` (main.scala.html),
 * in the shape `{CurbRamp: {Disagree: ['wrong-type', …], Unsure: […]}, …}`. That stamp is the only copy the
 * frontend gets — the Validate menus, the label detail card and the Gallery cards all build their reason lists
 * here rather than keeping a parallel set of literals that could drift from the backend, and the id a validator
 * picks is stored beside their comment as `validation_task_comment.reason`.
 *
 * Text and tooltips come from the locale files under the same ids (`common:validation-reason.<id>.text`, `.tooltip`,
 * and a per-type `.tooltip-<label-type>` where one type needs its own wording), so the stamp stays language-free.
 * A page that doesn't stamp the catalog (jsdom, the error pages) gets empty lists rather than an error.
 */
window.util = window.util || {};

util.validationReasons = (() => {
  const self = {};

  /** @returns {Record<string, Record<string, string[]>>} The stamped catalog, or an empty one off the page. */
  const catalog = () => (window.validationReasons && typeof window.validationReasons === 'object'
    ? window.validationReasons
    : {});

  /** @returns {string[]} The label types with any canned reason, in the backend's canonical order. */
  self.labelTypes = () => Object.keys(catalog());

  /**
   * @param {string} labelType - A label type name, e.g. 'CurbRamp'.
   * @param {string} vote - 'Disagree' or 'Unsure' ('Agree' carries no reasons).
   * @returns {string[]} The reason ids that type offers for that vote, in menu order; empty when it offers none.
   */
  self.idsFor = (labelType, vote) => {
    const ids = catalog()[labelType]?.[vote];
    return Array.isArray(ids) ? [...ids] : [];
  };

  /**
   * @param {string} labelType - A label type name.
   * @param {string} vote - 'Disagree' or 'Unsure'.
   * @returns {boolean} Whether that type offers any canned reason for that vote.
   */
  self.hasReasons = (labelType, vote) => self.idsFor(labelType, vote).length > 0;

  /**
   * @param {string} id - A reason id from the catalog.
   * @returns {?string} Its text in the current language, or null for an id the locale files don't know (a stale
   *     stamp, or a comment tagged by a newer vocabulary than this page's).
   */
  self.text = (id) => {
    const key = `common:validation-reason.${id}.text`;
    return i18next.exists(key) ? i18next.t(key) : null;
  };

  /**
   * @param {string} id - A reason id from the catalog.
   * @param {string} labelType - The label type it is being offered on; a type with its own wording wins.
   * @returns {?string} The tooltip explaining when the reason applies, or null when the reason has none.
   */
  self.tooltip = (id, labelType) => {
    const perType = `common:validation-reason.${id}.tooltip-${util.camelToKebab(labelType)}`;
    if (i18next.exists(perType)) return i18next.t(perType);
    const generic = `common:validation-reason.${id}.tooltip`;
    return i18next.exists(generic) ? i18next.t(generic) : null;
  };

  /**
   * The reasons to offer, with their strings resolved.
   *
   * @param {string} labelType - A label type name.
   * @param {string} vote - 'Disagree' or 'Unsure'.
   * @returns {{id: string, text: string, tooltip: ?string}[]} In menu order; a reason whose text the locale files
   *     lack is left out rather than shown as a raw key.
   */
  self.forLabel = (labelType, vote) => self.idsFor(labelType, vote)
    .map((id) => ({ id, text: self.text(id), tooltip: self.tooltip(id, labelType) }))
    .filter((reason) => reason.text !== null);

  return self;
})();
