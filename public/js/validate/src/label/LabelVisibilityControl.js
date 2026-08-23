/**
 * Handles the hiding and showing of labels in the panorama, and owns the label card that hovering one opens.
 */
class LabelVisibilityControl {
  // Grace period before the card hides once the cursor leaves the marker. The card is a separate element sitting
  // beside the icon, so without a delay the gap between the two is a dead zone that dismisses the card on the way
  // over — and the card has a button in it that has to be reachable. Matches Explore's hover card (Canvas.js).
  static #CARD_HIDE_DELAY_MS = 200;

  #cardVisible = false;
  #hideCardTimer = null;
  #card;
  #toggle;

  constructor() {
    this.#card = $('#label-card');

    // Two buttons, one action: the pill in the pano's top-left and the one in the label card's footer.
    this.#toggle = new LabelVisibilityToggle({
      buttons: [
        document.getElementById('label-visibility-control-button'),
        document.getElementById('label-visibility-button-on-label'),
      ],
      text: {
        hide: i18next.t('top-ui.visibility-control-hide'),
        show: i18next.t('top-ui.visibility-control-show'),
        hideTooltip: i18next.t('top-ui.visibility-control-tooltip-hide'),
        showTooltip: i18next.t('top-ui.visibility-control-tooltip-show'),
      },
      onChange: (visible, { viaClick }) => {
        if (viaClick) svv.tracker.push(visible ? 'Click_UnhideLabel' : 'Click_HideLabel');
        // The marker is briefly absent while the viewer swaps (primary ↔ Pannellum); its replacement is read
        // against the toggle's own state, so nothing is lost by there being none to set here.
        svv.panoManager.getPanoMarker()?.marker_.classList.toggle(LabelVisibilityToggle.HIDDEN_CLASS, !visible);
      },
    });

    // Keep the card up while the cursor is on it, so its Hide-label button can actually be clicked.
    this.#card.on('mouseenter', () => this.cancelScheduledCardHide());
    this.#card.on('mouseleave', () => this.scheduleHideLabelCard());

    // Same deal for keyboard focus (#4729): the card holds while focus is inside it, and the grace timer starts
    // when focus leaves. focusout also fires on moves between the card's own controls, so those are filtered.
    this.#card.on('focusin', () => this.cancelScheduledCardHide());
    this.#card.on('focusout', (e) => {
      if (!this.#card[0].contains(e.relatedTarget)) this.scheduleHideLabelCard();
    });
  }

  /** Shows the label in the panorama. */
  unhideLabel() {
    this.#toggle.setVisible(true);
  }

  /** Hides the label in the panorama, leaving the dashed ring main.css's .label-marker--hidden draws. */
  hideLabel() {
    this.#toggle.setVisible(false);
  }

  /** @returns {boolean} True if the label is currently not hidden. */
  isVisible() {
    return this.#toggle.isVisible();
  }

  /**
   * True while the label card is showing. Distinct from isVisible(), which is about the label itself.
   */
  isCardVisible() {
    return this.#cardVisible;
  }

  /**
   * Shows the label card beside the label's marker.
   *
   * @param {Object} [options]
   * @param {boolean} [options.viaKeyboard] The card was opened from the keyboard (Tab onto the marker, or Enter/
   *     Space on it) rather than by pointer. Logged under its own event name, the way the H key's hide is —
   *     see docs/logged-events.md.
   */
  showLabelCard({ viaKeyboard = false } = {}) {
    this.cancelScheduledCardHide();
    if (!this.#anchorCard()) return;
    if (!this.#cardVisible) svv.tracker.push(viaKeyboard ? 'KeyboardShortcut_ShowLabelCard' : 'MouseOver_Label');
    this.#cardVisible = true;
    this.#card[0].style.visibility = 'visible';
    this.#setMarkerExpanded(true);
  }

  /**
   * Hides the label card immediately. Used when something definitively supersedes it — a pan starting, the H key,
   * or a move to the next label — as opposed to the cursor merely leaving the marker.
   */
  hideLabelCard() {
    this.cancelScheduledCardHide();
    // The share popover hangs off the card, so it goes too. Left open it would be invisible but still armed, and
    // every later scheduleHideLabelCard would defer to it forever.
    svv.labelCard?.closeSharePopover();
    this.#cardVisible = false;
    this.#card[0].style.visibility = 'hidden';
    this.#setMarkerExpanded(false);
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
   * Toggles the card. The mobile pano has no hover, so activating the marker — a tap, an assistive technology's
   * press, or Enter/Space — opens and closes it; on desktop this is Enter/Space on the focused marker.
   *
   * @param {Object} [options] Forwarded to showLabelCard — see its viaKeyboard note.
   */
  toggleLabelCard(options) {
    if (this.#cardVisible) this.hideLabelCard();
    else this.showLabelCard(options);
  }

  /**
   * Re-anchors the card to the marker if it is showing. Called from PanoMarker.draw(), so the card stays glued to
   * the icon through POV changes, zooming, and window resizes rather than being left behind where it opened.
   */
  reanchorLabelCard() {
    if (!this.#cardVisible) return;
    if (!this.#anchorCard()) this.hideLabelCard();
  }

  /**
   * Cancels a pending grace-timer hide. Public because the marker's focus handler needs it when focus walks back
   * out of the card onto the marker (PanoMarker): the card should hold, but must not re-open if Escape just
   * closed it — which showLabelCard() would do.
   */
  cancelScheduledCardHide() {
    if (this.#hideCardTimer === null) return;
    clearTimeout(this.#hideCardTimer);
    this.#hideCardTimer = null;
  }

  /**
   * Mirrors the card's visibility onto the marker's aria-expanded, so a screen reader hears whether pressing the
   * marker will open or close the card. Looked up fresh each time: the marker is recreated on viewer swaps.
   *
   * Guarded on the role rather than the platform: PanoMarker is what decides whether a given marker claims to be a
   * disclosure button, and only one that does should carry the state.
   */
  #setMarkerExpanded(expanded) {
    const marker = document.getElementById('validate-pano-marker');
    if (marker?.getAttribute('role') === 'button') marker.setAttribute('aria-expanded', String(expanded));
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
