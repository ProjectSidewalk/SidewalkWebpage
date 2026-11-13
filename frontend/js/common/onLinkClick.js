/**
 * Adds a click listener to a link that also hears middle clicks, which open the link in a new tab without a `click`.
 *
 * @param {HTMLAnchorElement} link - The link to watch.
 * @param {(e: MouseEvent) => void} handler - Called on each click.
 */
export function onLinkClick(link, handler) {
  link.addEventListener('click', handler);
  link.addEventListener('auxclick', (e) => {
    if (e.button === 1) handler(e);
  });
}
