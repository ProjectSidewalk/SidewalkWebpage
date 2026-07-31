/**
 * Handles the hiding and showing of labels in the panorama, and owns the label card that hovering one opens.
 */
class LabelVisibilityControl {
  // Grace period before the card hides once the cursor leaves the marker. The card is a separate element sitting
  // beside the icon, so without a delay the gap between the two is a dead zone that dismisses the card on the way
  // over — and the card has a button in it that has to be reachable. Matches Explore's hover card (Canvas.js).
  static #CARD_HIDE_DELAY_MS = 200;

  // Feather-style eye / eye-off, inline so they take the button's colour through currentColor. The two icons this
  // replaced were exports with a baked-in #2D2A3F fill, which read as a dark smudge on a dark button (#4726).
  static #ICON_EYE_OFF = `<svg class="hide-label-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1
      12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>`;

  static #ICON_EYE_ON = `<svg class="hide-label-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>`;

  #visible = true;
  #cardVisible = false;
  #hideCardTimer = null;
  #labelVisibilityControlButton;
  #labelVisibilityButtonOnPano;
  #card;
  #hideText;
  #showText;
  #hideTooltip;
  #showTooltip;

  constructor() {
    this.#labelVisibilityControlButton = $('#label-visibility-control-button');
    this.#labelVisibilityButtonOnPano = $('#label-visibility-button-on-label');
    this.#card = $('#label-card');
    this.#hideText = i18next.t('top-ui.visibility-control-hide');
    this.#showText = i18next.t('top-ui.visibility-control-show');
    this.#hideTooltip = i18next.t('top-ui.visibility-control-tooltip-short-hide');
    this.#showTooltip = i18next.t('top-ui.visibility-control-tooltip-short-show');

    // Set up the event listeners.
    this.#labelVisibilityControlButton.on('click', this.#clickAdjustLabel);
    this.#labelVisibilityButtonOnPano.on('click', this.#clickAdjustLabel);

    // Keep the card up while the cursor is on it, so its Hide-label button can actually be clicked.
    this.#card.on('mouseenter', () => this.#cancelScheduledCardHide());
    this.#card.on('mouseleave', () => this.scheduleHideLabelCard());

    // Call unhideLabel() to start the page with showing the 'hide label' button.
    this.unhideLabel();
  }

  /**
   * Logs interaction when the hide label button is clicked.
   */
  #clickAdjustLabel = () => {
    if (this.#visible) {
      svv.tracker.push('Click_HideLabel');
      this.hideLabel();
    } else {
      svv.tracker.push('Click_UnhideLabel');
      this.unhideLabel();
    }
  };

  /**
   * Unhides label in the panorama depending on current state.
   */
  unhideLabel() {
    this.#visible = true;
    this.#setVisibilityButtons(this.#hideText, LabelVisibilityControl.#ICON_EYE_OFF, this.#hideTooltip);
    // The marker is briefly absent while the viewer swaps (primary ↔ Pannellum); the button state above is what
    // renderPanoMarker's replacement will be read against, so it is set either way.
    svv.panoManager.getPanoMarker()?.marker_.classList.remove('label-marker--hidden');
  }

  /**
   * Hides label in the panorama.
   *
   * Both directions are a class toggle and nothing else: the icon and its ring live in CSS (see
   * .label-marker--hidden), which crossfades them rather than swapping one asset for another, so the label visibly
   * steps aside instead of blinking into a different shape. Hiding is meant to reveal the sidewalk underneath, so
   * the marker gets out of the way — but not so far that you lose which label you are being asked about, or where to
   * put the cursor to bring it back.
   */
  hideLabel() {
    this.#visible = false;
    this.#setVisibilityButtons(this.#showText, LabelVisibilityControl.#ICON_EYE_ON, this.#showTooltip);
    svv.panoManager.getPanoMarker()?.marker_.classList.add('label-marker--hidden');
  }

  /**
   * Relabels both toggles — the always-visible one in the pano's top-left and the one in the label card's footer.
   * They run the same action, so they always read the same way.
   *
   * The label is inserted as HTML, not text: the translations underline the keyboard shortcut inline (the English
   * ones are "<u>H</u>ide Label" / "S<u>h</u>ow Label"). It is a locale string, not user input.
   *
   * Only the card's button gets a tooltip here. The top-left control carries a fuller sentence set from Twirl, and
   * it does not reverse the way this one does — the tooltip has to turn over with the action, or it describes the
   * opposite of what clicking now does.
   *
   * @param {string} text    The action the buttons now offer, as translated markup.
   * @param {string} icon    Inline SVG for the eye icon that goes with it.
   * @param {string} tooltip That same action spelled out, for the card button's tooltip.
   */
  #setVisibilityButtons(text, icon, tooltip) {
    const htmlString = `${icon}<span>${text}</span>`;
    this.#labelVisibilityControlButton.html(htmlString);
    this.#labelVisibilityButtonOnPano.html(htmlString);
    this.#labelVisibilityButtonOnPano.attr('data-ps-tooltip', tooltip);
  }

  /**
   * Returns true if label is currently not hidden, false otherwise.
   */
  isVisible() {
    return this.#visible;
  }

  /**
   * Shows the label card beside the label's marker.
   */
  showLabelCard() {
    this.#cancelScheduledCardHide();
    if (!this.#anchorCard()) return;
    if (!this.#cardVisible) svv.tracker.push('MouseOver_Label');
    this.#cardVisible = true;
    this.#card[0].style.visibility = 'visible';
  }

  /**
   * Hides the label card immediately. Used when something definitively supersedes it — a pan starting, the H key,
   * or a move to the next label — as opposed to the cursor merely leaving the marker.
   */
  hideLabelCard() {
    this.#cancelScheduledCardHide();
    // The share popover hangs off the card, so it goes too. Left open it would be invisible but still armed, and
    // every later scheduleHideLabelCard would defer to it forever.
    svv.labelCard?.closeSharePopover();
    this.#cardVisible = false;
    this.#card[0].style.visibility = 'hidden';
  }

  /**
   * Hides the label card after a short grace period, giving the cursor time to travel from the marker onto the card.
   * A pending timer is left running rather than reset, so the deadline stays a hard #CARD_HIDE_DELAY_MS from when
   * the pointer first left.
   */
  scheduleHideLabelCard() {
    // An open share popover extends past the card, so the pointer leaving the card doesn't mean the user is done
    // with it. Taking the card down here would take the popover with it, mid-choice — handleSharePopoverDismissed
    // re-arms the hide once the popover closes.
    if (this.#hideCardTimer !== null || svv.labelCard?.isSharePopoverOpen()) return;
    this.#hideCardTimer = setTimeout(() => {
      this.#hideCardTimer = null;
      this.hideLabelCard();
    }, LabelVisibilityControl.#CARD_HIDE_DELAY_MS);
  }

  /**
   * Re-arms the card's hide once the share popover that had been holding it open goes away.
   *
   * scheduleHideLabelCard is only ever reached from the card's own mouseleave, and while the popover was up it
   * declined to schedule anything. The pointer left the card back then and no second mouseleave is coming, so
   * without this the card would stay up until a pan, the H key, or the next label took it down. Copy link is the
   * common way in: it leaves the popover open behind its "Copied!" state, so the pointer usually wanders off well
   * before the popover closes. Skipped when the pointer is back on the card, where it is meant to stay.
   */
  handleSharePopoverDismissed() {
    if (!this.#card[0].matches(':hover')) this.scheduleHideLabelCard();
  }

  /**
   * Toggles the card. The mobile pano has no hover, so a tap on the marker opens and closes it.
   */
  toggleLabelCard() {
    if (this.#cardVisible) this.hideLabelCard();
    else this.showLabelCard();
  }

  /**
   * Re-anchors the card to the marker if it is showing. Called from PanoMarker.draw(), so the card stays glued to
   * the icon through POV changes, zooming, and window resizes rather than being left behind where it opened.
   */
  reanchorLabelCard() {
    if (!this.#cardVisible) return;
    if (!this.#anchorCard()) this.hideLabelCard();
  }

  #cancelScheduledCardHide() {
    if (this.#hideCardTimer === null) return;
    clearTimeout(this.#hideCardTimer);
    this.#hideCardTimer = null;
  }

  /**
   * Positions the card beside the marker using the shared routine Explore's panels use.
   *
   * The routine works in a logical frame that it scales up to on-screen pixels, but the marker is already positioned
   * in on-screen pixels within the pano's marker layer — so the marker's geometry is divided by the same scale on
   * the way in. That scale is read off the card itself rather than from util.uiScale(), because mobile overrides it
   * per-card (see LabelCard); the gap the routine leaves has to match the tail width the card actually renders.
   *
   * @returns {boolean} False if there is nothing to anchor to — including a marker parked off-screen because the
   *      label is behind the camera, which is PanoMarker.draw()'s way of hiding it.
   */
  #anchorCard() {
    const marker = document.getElementById('validate-pano-marker');
    const layer = svv.ui.viewer.controlLayer[0];
    if (!marker || !layer || marker.offsetLeft < -1000) return false;

    const scale = parseFloat(getComputedStyle(this.#card[0]).getPropertyValue('--ui-scale')) || 1;
    const radius = marker.offsetWidth / 2;
    util.anchorPanelToLabel(
      this.#card,
      { x: (marker.offsetLeft + radius) / scale, y: (marker.offsetTop + marker.offsetHeight / 2) / scale },
      radius / scale,
      { scale, originEl: layer, boundsEl: layer, frameHeight: layer.getBoundingClientRect().height },
    );
    return true;
  }
}
