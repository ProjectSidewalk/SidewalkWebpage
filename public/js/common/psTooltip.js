/**
 * Shared, design-token-styled tooltip for any element marked with `data-ps-tooltip="text"`.
 *
 * A single fixed-position card (`.ps-tooltip`, styled in main.css) follows the active trigger: it appears near the
 * element after a short hover delay (or immediately on keyboard focus), preferring the space above the trigger and
 * flipping below when there isn't room. Escape dismisses it (WCAG 1.4.13). Set the attribute directly, or via
 * i18nDom's `data-i18n-tooltip="ns:key"` so the text stays translated.
 *
 * The attribute value renders as HTML so translation strings can carry inline emphasis (<b>, <i>). That makes it a
 * hard rule that `data-ps-tooltip` only ever holds first-party strings (our translation files) — never user-supplied
 * or third-party text.
 *
 * Loaded globally from main.scala.html (like i18nDom.js); no per-app setup needed — listeners are delegated on the
 * document, so triggers added at any time just work.
 */
(() => {
  const SHOW_DELAY_MS = 250;
  const TRIGGER_GAP_PX = 8;
  const VIEWPORT_MARGIN_PX = 8;

  let tooltip = null;
  let activeTrigger = null; // The trigger whose tooltip is visible, or pending via showTimer.
  let showTimer = null;

  /**
   * Lazily creates the single shared tooltip element.
   * @returns {HTMLElement} The tooltip card.
   */
  const ensureTooltip = () => {
    if (tooltip === null) {
      tooltip = document.createElement('div');
      tooltip.id = 'ps-tooltip';
      tooltip.className = 'ps-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      document.body.appendChild(tooltip);
    }
    return tooltip;
  };

  /**
   * Shows the tooltip for a trigger: fills in its text, sizes it, then places it centered above the trigger —
   * clamped into the viewport, and flipped below the trigger when the space above is too tight.
   * @param {Element} trigger - The element carrying data-ps-tooltip.
   */
  const show = (trigger) => {
    const card = ensureTooltip();
    // Rendered as HTML per the header contract: tooltip strings are first-party translations, never user input.
    card.innerHTML = trigger.getAttribute('data-ps-tooltip');

    const triggerRect = trigger.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect(); // Text is set, so this measures the final size while still hidden.
    const left = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(
        triggerRect.left + (triggerRect.width - cardRect.width) / 2,
        window.innerWidth - cardRect.width - VIEWPORT_MARGIN_PX,
      ),
    );
    let top = triggerRect.top - cardRect.height - TRIGGER_GAP_PX;
    if (top < VIEWPORT_MARGIN_PX) {
      top = triggerRect.bottom + TRIGGER_GAP_PX;
    }
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    card.classList.add('ps-tooltip--visible');
    trigger.setAttribute('aria-describedby', 'ps-tooltip');
    activeTrigger = trigger;
  };

  /**
   * Hides the tooltip (if visible) and cancels any pending show.
   */
  const hide = () => {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (activeTrigger !== null) {
      activeTrigger.removeAttribute('aria-describedby');
      activeTrigger = null;
    }
    tooltip?.classList.remove('ps-tooltip--visible');
  };

  /**
   * Reacts to the pointer/focus landing on `target`: starts (or keeps) the tooltip for its trigger, or hides it.
   * @param {EventTarget} target - The element the pointer or focus moved onto.
   * @param {boolean} immediate - True to skip the hover delay (keyboard focus).
   */
  const onEnter = (target, immediate) => {
    const trigger = target instanceof Element ? target.closest('[data-ps-tooltip]') : null;
    if (trigger === activeTrigger) {
      return; // Still on the same trigger (e.g. moving between its children); leave the tooltip as is.
    }
    hide();
    if (trigger !== null) {
      if (immediate) {
        show(trigger);
      } else {
        activeTrigger = trigger;
        showTimer = setTimeout(() => {
          showTimer = null;
          show(trigger);
        }, SHOW_DELAY_MS);
      }
    }
  };

  document.addEventListener('mouseover', (event) => onEnter(event.target, false));
  document.addEventListener('mouseleave', hide); // Pointer left the page entirely; mouseover alone would miss it.
  document.addEventListener('focusin', (event) => onEnter(event.target, true));
  document.addEventListener('focusout', hide);
  // Hide on scroll (the fixed-position card would drift from its trigger) and on Escape (WCAG 1.4.13 dismissable).
  window.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hide();
    }
  });
})();
