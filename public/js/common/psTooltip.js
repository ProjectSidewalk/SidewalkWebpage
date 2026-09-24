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
 * **The attribute value renders as HTML** (`innerHTML`), so translation strings can carry inline emphasis (<b>, <i>)
 * and a caller can build a small rich card. That makes escaping the caller's responsibility, and the requirement is
 * *double* escaping for anything user-supplied — a username, a label description, any third-party text:
 *
 *   1. Escape the value, and interpolate it into the card markup.
 *   2. Escape that whole markup string again when writing it into the `data-ps-tooltip` attribute.
 *
 * Parsing the attribute consumes one level and `innerHTML` here consumes the other, so a username of
 * `<img onerror=...>` arrives as text. One level of escaping is a stored-XSS hole, not a cosmetic bug: skip step 2 and
 * the attribute closes early, letting the value inject arbitrary markup into the host page.
 * `AcrossCitiesPage.#dayTipHtml` is the worked example, and `test/js/acrossCitiesBreakdowns.test.js` pins it.
 * Plain-text callers need none of this — pass first-party text and it renders as-is.
 *
 * **Pinning (opt-in).** A trigger that also carries `data-ps-tooltip-pinnable` can be clicked (or given Enter/Space
 * from the keyboard) to pin its card open (#5495). A pinned card stops following the pointer and takes pointer events,
 * so links inside it work; it becomes a non-modal dialog, and pinning from the keyboard moves focus into it so its
 * links are reachable with Tab. Escape, a click outside, focus leaving, or clicking the trigger again unpins it, and
 * Escape hands focus back to the trigger. Give such a trigger `aria-haspopup="dialog"` and it gets `aria-expanded`
 * kept in step. Everything else about the tooltip is unchanged for triggers that don't opt in.
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
  let pinned = false; // True while the visible card is pinned open for its links (see the header).
  let refocusing = false; // True while Escape hands focus back to the trigger of the card it closed.
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
    // A modal <dialog> paints in the top layer, above every z-index in the page's normal stacking order, so a card
    // parked on <body> opens behind it. Follow the trigger into its dialog (the label detail popup) instead. The
    // dialog sets no transform/filter, so the card stays fixed to the viewport and escapes the dialog's overflow.
    const host = trigger.closest('dialog[open]') ?? document.body;
    if (card.parentElement !== host) host.appendChild(card);
    // Rendered as HTML per the header contract, which is also why that contract requires callers to double-escape any
    // user-supplied text they interpolate: this is the second of the two levels being consumed.
    card.innerHTML = trigger.getAttribute('data-ps-tooltip');
    place(card, trigger);

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
   * Positions an already-filled card against its trigger: centered above it, clamped into the viewport, and flipped
   * below when the space above is too tight. Finally aims the tail back at the trigger. Separate from `show` so a
   * pinned card can follow its trigger through a scroll without re-rendering, which would drop focus from its links.
   * @param {HTMLElement} card - The tooltip card, holding its final content.
   * @param {Element} trigger - The element it describes.
   */
  const place = (card, trigger) => {
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
    // Clamp vertically the same way as horizontally, because a tall card near the middle of a short viewport fits on
    // neither side and would otherwise run off the bottom with its lower rows unreachable. A card taller than the
    // viewport still overflows, but pins to the top so it is read from the beginning.
    const clampedTop = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(top, window.innerHeight - cardRect.height - VIEWPORT_MARGIN_PX),
    );
    // A clamp moves the card off the trigger's edge, so its tail would point at empty space; drop the tail instead.
    if (clampedTop !== top) card.classList.add('ps-tooltip--untailed');
    else card.classList.remove('ps-tooltip--untailed');
    card.style.left = `${left}px`;
    card.style.top = `${clampedTop}px`;

    // Aim the tail at the trigger's center, not the card's: the clamp above slides the card sideways near a viewport
    // edge, and a tail pinned to the card's middle would then point at empty space.
    const tailInset = (TAIL_HALF_WIDTH_PX + CORNER_RADIUS_PX) * scale;
    card.style.setProperty('--ps-tooltip-tail-left', `${Math.max(
      tailInset,
      Math.min(triggerRect.left + triggerRect.width / 2 - left, cardRect.width - tailInset),
    )}px`);
  };

  /**
   * Hides the tooltip (if visible) and cancels any pending show.
   */
  const hide = () => {
    unpin();
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
   * Pins the active trigger's card open, so it holds still and its links can be used (see the header).
   * @param {boolean} moveFocus - True to move focus into the card, for a keyboard pin: otherwise its links sit at the
   *   end of the document, many Tab stops away from the trigger that opened them.
   */
  const pin = (moveFocus) => {
    if (activeTrigger === null || tooltip === null) return;
    pinned = true;
    tooltip.classList.add('ps-tooltip--pinned');
    tooltip.setAttribute('role', 'dialog');
    tooltip.setAttribute('aria-label', activeTrigger.getAttribute('aria-label') || 'Details');
    tooltip.setAttribute('tabindex', '-1');
    if (activeTrigger.hasAttribute('aria-haspopup')) activeTrigger.setAttribute('aria-expanded', 'true');
    if (moveFocus) tooltip.focus({ preventScroll: true });
  };

  /** Returns a pinned card to an ordinary tooltip. A no-op when nothing is pinned. */
  const unpin = () => {
    if (!pinned) return;
    pinned = false;
    tooltip.classList.remove('ps-tooltip--pinned');
    tooltip.setAttribute('role', 'tooltip');
    tooltip.removeAttribute('aria-label');
    tooltip.removeAttribute('tabindex');
    if (activeTrigger?.hasAttribute('aria-haspopup')) activeTrigger.setAttribute('aria-expanded', 'false');
  };

  /**
   * Whether an event target sits on the pinned card or on the trigger that pinned it — the two places a pinned card
   * stays open through.
   * @param {EventTarget} target - The event's target.
   * @returns {boolean} True when the target is inside either.
   */
  const withinPinned = (target) => target instanceof Node
    && (tooltip?.contains(target) || activeTrigger?.contains(target));

  /**
   * Pins the pinnable trigger's card, or unpins it when it is already the pinned one.
   * @param {Element} trigger - A `[data-ps-tooltip-pinnable]` trigger.
   * @param {boolean} fromKeyboard - True when Enter/Space did this, so focus follows into the card.
   */
  const togglePin = (trigger, fromKeyboard) => {
    if (pinned && trigger === activeTrigger) {
      hide();
      return;
    }
    // Show straight away rather than through the hover delay: the click is an explicit request.
    if (trigger !== activeTrigger || !tooltip?.classList.contains('ps-tooltip--visible')) {
      hide();
      show(trigger);
    }
    pin(fromKeyboard);
  };

  /**
   * Reacts to the pointer/focus landing on `target`: starts (or keeps) the tooltip for its trigger, or hides it.
   * @param {EventTarget} target - The element the pointer or focus moved onto.
   * @param {boolean} immediate - True to skip the hover delay (keyboard focus).
   */
  const onEnter = (target, immediate) => {
    if (pinned) {
      // A pinned card ignores the pointer entirely — it is being read, and passing over another trigger on the way to
      // one of its links must not swap it out. Focus is different: focus landing somewhere else means the reader has
      // moved on, so it closes and the new target gets its own tooltip as usual.
      if (!immediate || withinPinned(target)) return;
      hide();
    }
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
  // Pointer left the page entirely; mouseover alone would miss it. A pinned card stays, since it was asked for.
  document.addEventListener('mouseleave', () => {
    if (!pinned) hide();
  });
  document.addEventListener('focusin', (event) => {
    if (!refocusing) onEnter(event.target, true);
  });
  // Focus moving from the trigger into its pinned card fires this first; the focusin that follows decides instead.
  document.addEventListener('focusout', () => {
    if (!pinned) hide();
  });
  // Hide on scroll, since the fixed-position card would drift from its trigger. A pinned card follows its trigger
  // instead, and closes only once the trigger has scrolled out of view.
  window.addEventListener('scroll', () => {
    if (!pinned) {
      hide();
      return;
    }
    const r = activeTrigger.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) hide();
    else place(tooltip, activeTrigger);
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (pinned && !withinPinned(event.target)) hide();
  });
  document.addEventListener('click', (event) => {
    const trigger = event.target instanceof Element ? event.target.closest('[data-ps-tooltip-pinnable]') : null;
    if (trigger !== null && !tooltip?.contains(trigger)) togglePin(trigger, false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      // Escape from inside a pinned card returns focus to where the reader was, rather than dropping it on <body>.
      const returnTo = pinned && tooltip.contains(document.activeElement) ? activeTrigger : null;
      hide();
      // Focus events fire synchronously, so this flag covers exactly the focusin that returning focus causes, which
      // would otherwise reopen the card Escape just closed.
      refocusing = true;
      try {
        returnTo?.focus({ preventScroll: true });
      } finally {
        refocusing = false;
      }
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element
      && event.target.matches('[data-ps-tooltip-pinnable]')) {
      event.preventDefault(); // Space would otherwise scroll the page out from under the card it just pinned.
      togglePin(event.target, true);
    }
  });
})();
