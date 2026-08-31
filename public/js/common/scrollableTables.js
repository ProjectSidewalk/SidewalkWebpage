/**
 * Keyboard access for the server-rendered `.ps-table-wrapper` horizontal scrollers on the page-shell surfaces (API
 * docs, admin dashboard, user dashboard).
 *
 * A wide table's wrapper scrolls, but its content is plain text with nothing focusable inside, so a keyboard user has
 * no way to reach the columns past the right edge (WCAG 2.1.1). A tab stop on the wrapper gives them one, and arrow
 * keys then scroll it.
 *
 * Only wrappers that actually overflow get the tab stop: on a wide viewport most of these tables fit, and a stop that
 * scrolls nothing is one more press between a keyboard reader and the content. That makes it viewport-dependent, so
 * it is re-evaluated on resize.
 *
 * Wrappers carrying a `role` are left alone — the api-docs preview tables (`apiTableWrapper.js`) build their own with
 * `role="region"` and a name, which is the better treatment where a name is available to give.
 */
(() => {
  const syncTabStops = () => {
    for (const wrapper of document.querySelectorAll('.ps-table-wrapper:not([role])')) {
      // A sub-pixel difference is layout rounding, not a scrollable overflow.
      if (wrapper.scrollWidth - wrapper.clientWidth > 1) wrapper.setAttribute('tabindex', '0');
      else wrapper.removeAttribute('tabindex');
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncTabStops);
  else syncTabStops();

  // Debounced: a drag-resize fires continuously, and each pass reads layout on every wrapper on the page.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncTabStops, 150);
  });
})();
