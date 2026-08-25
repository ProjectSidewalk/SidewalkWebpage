/**
 * Shared horizontal scroller for the JS-rendered api-docs preview tables.
 *
 * Loaded by apiDocs/layout.scala.html ahead of the page content so it is guaranteed to exist before any
 * embedded preview script's render callback fires.
 */

/**
 * Wraps a preview table in the same `.api-table-wrapper` scroller the server-rendered api-docs tables sit in:
 * on a narrow viewport a wide table scrolls inside it instead of being clipped unreachable by the page's
 * overflow-x clipping (#4883).
 *
 * @param {HTMLTableElement} table - The table to wrap.
 * @param {string} label - Accessible name for the scroll region.
 * @returns {HTMLElement} The wrapper, with the table inside it.
 */
window.createApiTableWrapper = (table, label) => {
  const wrapper = document.createElement('div');
  wrapper.className = 'api-table-wrapper';
  // A scroll region needs keyboard focus so off-screen columns stay reachable without a pointer (WCAG 2.1.1),
  // and a role + name so the focus stop announces as something rather than nothing.
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', label);
  wrapper.appendChild(table);
  return wrapper;
};
