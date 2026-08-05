/**
 * Shared, design-token-styled tooltip for any element marked with `data-ps-tooltip="text"`.
 *
 * A single fixed-position card (`.ps-tooltip`, styled in main.css) follows the active trigger: it appears near the
 * element after a short hover delay (or immediately on keyboard focus), preferring the space above the trigger and
 * flipping below when there isn't room. Add `data-ps-tooltip-placement="bottom"` to reverse that preference, for a
 * trigger sitting at the bottom of a panel the tooltip must not cover. A tail points back at the trigger; this file
 * places it, and main.css draws it. Escape dismisses it (WCAG 1.4.13). Set the attribute directly, or via i18nDom's
 * `data-i18n-tooltip="ns:key"` so the text stays translated.
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
  // Trigger-to-card gap. The tail is drawn into it, so this has to stay above the tail's height below.
  const TRIGGER_GAP_PX = 8;
  const VIEWPORT_MARGIN_PX = 8;
  // Half the tail's width and the card's corner radius, both matching main.css. Their sum is how far the tail has to
  // stay in from either end of the card for its base to land on a straight run of edge rather than on a corner.
  const TAIL_HALF_WIDTH_PX = 6;
  const CORNER_RADIUS_PX = 6;

  let tooltip = null;
  let activeTrigger = null; // The trigger whose tooltip is visible, or pending via showTimer.
  let showTimer = null;
  // Watches the open trigger's text for changes under it. A toggle button relabels itself on click, and the pointer
  // is still resting on it at that moment, so without this the card sits there describing the state just left.
  let textObserver = null;

  /**
   * Reads the zoom factor `util.applyToolScale` puts on the document root, so the gaps measured here match the tail
   * and corner radius that main.css scales by the same value. Pages outside the Explore/Validate tools never set it.
   * @returns {number} The current --ui-scale, or 1 where it is unset or unusable.
   */
  const uiScale = () => {
    const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  };

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
   * clamped into the viewport, and flipped below the trigger when the space above is too tight. Finally aims the
   * tail back at the trigger.
   * @param {Element} trigger - The element carrying data-ps-tooltip.
   */
  const show = (trigger) => {
    const card = ensureTooltip();
    // Rendered as HTML per the header contract: tooltip strings are first-party translations, never user input.
    card.innerHTML = trigger.getAttribute('data-ps-tooltip');
    card.classList.remove('ps-tooltip--flipped'); // Reset before measuring; the flip below re-adds it if needed.

    const scale = uiScale();
    const triggerRect = trigger.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect(); // Text is set, so this measures the final size while still hidden.
    const left = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(
        triggerRect.left + (triggerRect.width - cardRect.width) / 2,
        window.innerWidth - cardRect.width - VIEWPORT_MARGIN_PX,
      ),
    );
    // Above by default, below when asked for or when there is no room above. "Asked for" still yields to a bottom
    // edge it would run off, so the preference orders the two sides rather than pinning the card to one.
    const gap = TRIGGER_GAP_PX * scale;
    const above = triggerRect.top - cardRect.height - gap;
    const below = triggerRect.bottom + gap;
    const prefersBelow = trigger.getAttribute('data-ps-tooltip-placement') === 'bottom';
    const fitsBelow = below + cardRect.height <= window.innerHeight - VIEWPORT_MARGIN_PX;
    let top = above;
    if (prefersBelow ? fitsBelow : above < VIEWPORT_MARGIN_PX) {
      top = below;
      card.classList.add('ps-tooltip--flipped');
    }
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    // Aim the tail at the trigger's center, not the card's: the clamp above slides the card sideways near a viewport
    // edge, and a tail pinned to the card's middle would then point at empty space.
    const tailInset = (TAIL_HALF_WIDTH_PX + CORNER_RADIUS_PX) * scale;
    card.style.setProperty('--ps-tooltip-tail-left', `${Math.max(
      tailInset,
      Math.min(triggerRect.left + triggerRect.width / 2 - left, cardRect.width - tailInset),
    )}px`);

    card.classList.add('ps-tooltip--visible');
    trigger.setAttribute('aria-describedby', 'ps-tooltip');
    activeTrigger = trigger;

    // Re-run this whole placement if the text changes while the card is up: the new string is a different width, so
    // refreshing the copy alone would leave it centered and tailed for the old one.
    if (textObserver === null) {
      textObserver = new MutationObserver(() => {
        if (activeTrigger !== null && tooltip?.classList.contains('ps-tooltip--visible')) {
          show(activeTrigger);
        }
      });
    }
    textObserver.disconnect();
    textObserver.observe(trigger, { attributes: true, attributeFilter: ['data-ps-tooltip'] });
  };

  /**
   * Hides the tooltip (if visible) and cancels any pending show.
   */
  const hide = () => {
    textObserver?.disconnect();
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
