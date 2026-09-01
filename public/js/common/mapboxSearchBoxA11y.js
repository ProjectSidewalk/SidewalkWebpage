/**
 * ARIA repair for Mapbox Search JS's `MapboxSearchBox`, used by the LabelMap search and the Route Builder's
 * Start/End fields (#5087).
 *
 * The component gives its input `role="combobox"` but only ever writes `aria-expanded` from its own show- and
 * hide-results handlers, so a freshly mounted box that has never opened its suggestion list is a combobox missing
 * the attribute ARIA requires: a screen reader announces the field but never says whether suggestions are open.
 * Seeding the attribute at mount is the whole fix -- the component keeps it accurate from the first suggestion on.
 *
 * Anchored on `input[role="combobox"]` within our own mount element, because the component hashes both its class
 * names and its results-list id per mount (`.mbx0420900a--Input` one load, `.mbx00a6ef43--Input` the next), leaving
 * no stable selector of its own to key off.
 */

/**
 * Seeds `aria-expanded="false"` on a mounted MapboxSearchBox's input, once the component has built it.
 *
 * @param {HTMLElement} root - The element `searchBox.onAdd(map)` returned, already placed in the page.
 * @returns {void}
 */
function seedSearchBoxAriaExpanded(root) {
  if (!root) return;
  const seed = () => {
    const input = root.querySelector('input[role="combobox"]');
    if (!input) return false;
    if (!input.hasAttribute('aria-expanded')) input.setAttribute('aria-expanded', 'false');
    return true;
  };
  if (seed()) return;
  // The input and its role are written as the component connects, which may not have finished by the time the
  // caller returns, so watch for both rather than assuming either is in place yet.
  const observer = new MutationObserver(() => {
    if (seed()) observer.disconnect();
  });
  observer.observe(root, {childList: true, subtree: true, attributes: true, attributeFilter: ['role']});
}
