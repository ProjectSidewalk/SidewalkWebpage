/**
 * Runs a handler each time a link is followed. A middle click opens it in a new tab without firing `click`, so it is
 * caught through `auxclick`. A right-click "Open in new tab" never reaches the page, so it goes unseen.
 *
 * @param {HTMLAnchorElement} link - The link to watch.
 * @param {(e: MouseEvent) => void} handler - Called with the click.
 */
export function onLinkFollow(link, handler) {
  link.addEventListener('click', handler);
  link.addEventListener('auxclick', (e) => {
    if (e.button === 1) handler(e);
  });
}
