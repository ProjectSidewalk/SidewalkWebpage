/**
 * DOM helpers for applying i18next translations to elements declaratively.
 *
 * Mark elements in templates with one of:
 *   - data-i18n="ns:key"             -> sets textContent
 *   - data-i18n-placeholder="ns:key" -> sets the `placeholder` attribute
 *   - data-i18n-aria-label="ns:key"  -> sets the `aria-label` attribute
 *   - data-i18n-title="ns:key"       -> sets the `title` attribute (native tooltip)
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

  const selector = '[data-i18n], [data-i18n-placeholder], [data-i18n-aria-label], [data-i18n-title], [data-i18n-alt]';

  // querySelectorAll doesn't include `root` itself; check it explicitly so callers can pass an element that itself
  // carries a data-i18n attribute.
  if (root.nodeType === Node.ELEMENT_NODE && root.matches && root.matches(selector)) {
    localizeElement(root);
  }
  if (typeof root.querySelectorAll === 'function') {
    for (const el of root.querySelectorAll(selector)) {
      localizeElement(el);
    }
  }
};

/**
 * Apply any data-i18n* attributes on a single element.
 * @param {Element} el
 */
window.localizeElement = function (el) {
  const textKey = el.getAttribute('data-i18n');
  if (textKey) el.textContent = i18next.t(textKey);

  const placeholderKey = el.getAttribute('data-i18n-placeholder');
  if (placeholderKey) el.setAttribute('placeholder', i18next.t(placeholderKey));

  const ariaLabelKey = el.getAttribute('data-i18n-aria-label');
  if (ariaLabelKey) el.setAttribute('aria-label', i18next.t(ariaLabelKey));

  const titleKey = el.getAttribute('data-i18n-title');
  if (titleKey) el.setAttribute('title', i18next.t(titleKey));

  const altKey = el.getAttribute('data-i18n-alt');
  if (altKey) el.setAttribute('alt', i18next.t(altKey));
};
