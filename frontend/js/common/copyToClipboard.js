/**
 * The site's one way to copy text and say so (#5830). The confirmation shows at the button just pressed, not in a
 * toast: the user is already looking there, and "Copied!" doesn't earn a card elsewhere on the page.
 *
 * A text button swaps its label for a moment; an icon-only one says it in its tooltip. Either way a live region reads
 * it out too, since screen readers don't reliably announce a label change.
 */

import i18next from 'i18next';

const CONFIRM_MS = 1500;

// Button -> its pending restore. A second click during the confirmation restarts it rather than saving "Copied!" as
// the label to go back to.
const pending = new WeakMap();

/**
 * Copies `text` to the clipboard and confirms it at `button`.
 * @param {HTMLElement} button - The control the user pressed.
 * @param {string} text - What to copy.
 * @param {object} [opts]
 * @param {HTMLElement} [opts.labelEl] - The element holding the button's visible label, when that isn't the button
 *     itself (an icon and a label inside one button).
 * @returns {Promise<boolean>} Whether the copy worked.
 */
export async function copyToClipboard(button, text, opts = {}) {
  let ok = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // Also lands here where there is no clipboard API at all (a page served over plain http).
    console.warn('Copy to clipboard failed.', e);
    ok = false;
  }
  confirmAtButton(button, i18next.t(ok ? 'common:copy.copied' : 'common:copy.failed'), ok, opts.labelEl);
  return ok;
}

/**
 * Shows `message` at the button for a moment, then puts the button back as it was.
 * @param {HTMLElement} button - The control the user pressed.
 * @param {string} message - What to say.
 * @param {boolean} ok - False styles it as a failure.
 * @param {HTMLElement} [labelEl] - The element holding the visible label, if not the button.
 */
function confirmAtButton(button, message, ok, labelEl) {
  pending.get(button)?.();

  let restore;
  if (!labelEl && button.hasAttribute('data-ps-tooltip')) {
    const tip = button.getAttribute('data-ps-tooltip');
    button.setAttribute('data-ps-tooltip', message);
    // The pointer may have clicked before the hover delay opened the card, so ask for it now.
    button.dispatchEvent(new CustomEvent('ps-tooltip:show', { bubbles: true }));
    restore = () => button.setAttribute('data-ps-tooltip', tip);
  } else {
    const el = labelEl || button;
    const label = el.textContent;
    el.textContent = message;
    restore = () => {
      el.textContent = label;
    };
  }
  button.classList.add(ok ? 'is-copied' : 'is-copy-failed');
  announce(button, message);

  const timer = setTimeout(() => pending.get(button)?.(), CONFIRM_MS);
  pending.set(button, () => {
    clearTimeout(timer);
    restore();
    button.classList.remove('is-copied', 'is-copy-failed');
    pending.delete(button);
  });
}

/**
 * Reads `message` out through a hidden live region. The region goes in the button's open modal dialog when there is
 * one, since everything outside a modal dialog is hidden from screen readers while it is open.
 * @param {HTMLElement} button - The control the user pressed.
 * @param {string} message - What to say.
 */
function announce(button, message) {
  const host = button.closest('dialog[open]') ?? document.body;
  let region = host.querySelector(':scope > .ps-copy-status');
  if (!region) {
    region = document.createElement('div');
    region.className = 'ps-copy-status sr-only';
    region.setAttribute('role', 'status');
    host.appendChild(region);
  }
  // Clearing first makes a second copy in a row announce again rather than look like no change.
  region.textContent = '';
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}
