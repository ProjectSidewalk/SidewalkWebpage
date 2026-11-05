/**
 * The switched-off state of the label card's prev/next paging arrows (`.label-detail__paging`), in one place.
 *
 * The arrows switch themselves off while focused: paging to the last reachable label greys out the very arrow the
 * user pressed, and on LabelMap a viewport refetch or a sidebar filter change can do it at any moment (#5068, #5124).
 * The native `disabled` attribute would make the browser drop focus to the body there, silently, so the arrows take
 * `aria-disabled="true"` instead (#5135): they stay focusable, and a screen reader announces them as unavailable.
 * The price is that `aria-disabled` blocks nothing on its own, so every click handler and shortcut on the arrows
 * checks `isPagingDisabled()` before acting.
 *
 * @example
 * setPagingDisabled(nextBtn, !nav.hasNext(labelId));
 * nextBtn.addEventListener('click', () => { if (!isPagingDisabled(nextBtn)) goNext(); });
 */

/**
 * Switches a paging arrow off or back on, without taking it out of the tab order.
 * @param {?HTMLElement} button - The arrow; a host that renders no arrows passes null.
 * @param {boolean} off - True to switch it off.
 */
export function setPagingDisabled(button, off) {
  if (!button) return;
  if (off) button.setAttribute('aria-disabled', 'true');
  else button.removeAttribute('aria-disabled');
}

/**
 * Whether a paging arrow is switched off, so its click and its keyboard shortcut must do nothing.
 * @param {?HTMLElement} button - The arrow.
 * @returns {boolean}
 */
export function isPagingDisabled(button) {
  return button?.getAttribute('aria-disabled') === 'true';
}
