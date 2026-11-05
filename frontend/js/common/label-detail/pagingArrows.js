/**
 * Switched-off state for the label card's paging arrows. They use `aria-disabled`, not `disabled`, because paging to
 * the end switches off the arrow just pressed, and a disabled button loses keyboard focus (#5135). `aria-disabled`
 * blocks nothing itself, so every click handler and shortcut on the arrows checks `isPagingDisabled()`.
 */

/**
 * Switches a paging arrow off or on.
 * @param {?HTMLElement} button - The arrow, or null if the host has none.
 * @param {boolean} off - True to switch it off.
 */
export function setPagingDisabled(button, off) {
  if (!button) return;
  if (off) button.setAttribute('aria-disabled', 'true');
  else button.removeAttribute('aria-disabled');
}

/**
 * Whether a paging arrow is switched off.
 * @param {?HTMLElement} button - The arrow.
 * @returns {boolean}
 */
export function isPagingDisabled(button) {
  return button?.getAttribute('aria-disabled') === 'true';
}
