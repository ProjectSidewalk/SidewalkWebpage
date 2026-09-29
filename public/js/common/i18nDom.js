/**
 * DOM helpers for applying i18next translations to elements declaratively.
 *
 * Mark elements in templates with one of:
 *   - data-i18n="ns:key"             -> sets textContent
 *   - data-i18n-placeholder="ns:key" -> sets the `placeholder` attribute
 *   - data-i18n-aria-label="ns:key"  -> sets the `aria-label` attribute
 *   - data-i18n-tooltip="ns:key"     -> sets the `data-ps-tooltip` attribute (styled tooltip via psTooltip.js)
 *   - data-i18n-alt="ns:key"         -> sets the `alt` attribute
 *
 * Convention: include English fallback text in the markup for elements that are visible during initial render (graceful
 * degradation if i18next fails to load, and avoids layout shift). Elements that are hidden until user interaction may
 * be left empty.
 *
 * `localizeSubtree` is called once on `document.body` from AppManager after i18next finishes initializing, so static
 * markup is localized automatically. It can also be called on a freshly-inserted subtree if a module dynamically
 * injects elements that use these attributes.
 */

/**
 * Localize every element under `root` (inclusive) that has a `data-i18n*` attribute.
 * @param {ParentNode} root - The element (or document) to walk.
 */
window.localizeSubtree = function (root) {
  if (!root || typeof i18next === 'undefined' || !i18next.isInitialized) return;

  const selector = '[data-i18n], [data-i18n-placeholder], [data-i18n-aria-label], [data-i18n-tooltip], [data-i18n-alt]';

  // querySelectorAll doesn't include `root` itself; check it explicitly so callers can pass an element that itself
  // carries a data-i18n attribute.
  const rootEl = /** @type {Element} */ (root);
  if (root.nodeType === Node.ELEMENT_NODE && rootEl.matches && rootEl.matches(selector)) {
    localizeElement(rootEl);
  }
  if (typeof root.querySelectorAll === 'function') {
    for (const el of root.querySelectorAll(selector)) {
      localizeElement(el);
    }
  }
};

/**
 * A translation with its `&shy;` break points made safe for plain text. Some translations (the German label types)
 * carry the entity so long words can wrap, but these setters write text, where it would print literally. Element text
 * keeps them as real soft hyphens; attributes aren't laid out as wrapping text, so they drop them.
 * @param {string} key - The i18next key.
 * @param {boolean} keepBreaks - Swap each entity for a soft-hyphen character rather than dropping it.
 * @returns {string}
 */
function translatedText(key, keepBreaks) {
  return i18next.t(key).replaceAll('&shy;', keepBreaks ? '\u00AD' : '');
}

/**
 * Apply any data-i18n* attributes on a single element.
 * @param {Element} el
 */
window.localizeElement = function (el) {
  const textKey = el.getAttribute('data-i18n');
  if (textKey) el.textContent = translatedText(textKey, true);

  const placeholderKey = el.getAttribute('data-i18n-placeholder');
  if (placeholderKey) el.setAttribute('placeholder', translatedText(placeholderKey, false));

  const ariaLabelKey = el.getAttribute('data-i18n-aria-label');
  if (ariaLabelKey) el.setAttribute('aria-label', translatedText(ariaLabelKey, false));

  const tooltipKey = el.getAttribute('data-i18n-tooltip');
  if (tooltipKey) el.setAttribute('data-ps-tooltip', translatedText(tooltipKey, false));

  const altKey = el.getAttribute('data-i18n-alt');
  if (altKey) el.setAttribute('alt', translatedText(altKey, false));
};
