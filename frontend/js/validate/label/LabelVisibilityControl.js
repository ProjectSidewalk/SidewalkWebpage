/**
 * Handles the hiding and showing of labels in the panorama, and owns the label card that hovering one opens.
 */

import { LabelVisibilityToggle } from '../../common/LabelVisibilityToggle.js';
import { Infra3dViewer } from '../../common/pano-viewer/Infra3dViewer.js';
import { util } from '../../common/utilities.js';
import { LabelCard } from './LabelCard.js';
/** @typedef {import('../Main.js').ValidateConfig} ValidateConfig */
/** @typedef {import('../Main.js').ViewerUi} ViewerUi */
/** @typedef {import('./LabelContainer.js').LabelContainer} LabelContainer */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../../common/PanoMarker.js').PanoMarker} PanoMarker */
/** @typedef {import('../Tracker.js').Tracker} Tracker */

export class LabelVisibilityControl {
  // Grace period before the card hides once the cursor leaves the marker. The card is a separate element sitting
  // beside the icon, so without a delay the gap between the two is a dead zone that dismisses the card on the way
  // over — and the card has a button in it that has to be reachable. Matches Explore's hover card (Canvas.js).
  static #CARD_HIDE_DELAY_MS = 200;

  #cardVisible = false;
  #hideCardTimer = null;
  // Infra3d cities (Zurich, Winterthur) asked for each label's tags and description to be on screen as soon as it
  // loads (#5675). Desktop only: on a phone the card would cover much of the small pano.
  #opensOnLoad;
  // True while a card opened on load is up. Mouse movement and keypresses leave it alone; only a press on the pano,
  // hiding the label, Escape, or the next label closes it.
  #heldOpen = false;
  #card;
  #toggle;
  /** @type {HTMLElement} The layer the marker is positioned in, which the card is anchored within. */
  #controlLayer;
  /** @type {LabelCard} */
  #labelCard;
  /** @type {Tracker} */
  #tracker;

  /**
   * @param {ViewerUi} viewerUi - The layer the marker sits in, which the card is anchored within.
   * @param {ValidateConfig} config - The viewer class, which decides whether the card opens as each label loads.
   * @param {LabelContainer} labelContainer - Whose labels the card describes.
   * @param {PanoManager} panoManager - Builds the marker the card hangs off, again on every viewer swap.
   * @param {Tracker} tracker - Logs the toggles and the card's openings.
   */
  constructor(viewerUi, config, labelContainer, panoManager, tracker) {
    this.#card = document.getElementById('label-card');
    this.#controlLayer = viewerUi.controlLayer;
    this.#tracker = tracker;
    this.#opensOnLoad = !util.isMobile() && config.viewerType === Infra3dViewer;
    this.#labelCard = new LabelCard(this.#card, labelContainer, this, tracker);

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
        if (viaClick) tracker.push(visible ? 'Click_UnhideLabel' : 'Click_HideLabel');
        // The marker is briefly absent while the viewer swaps (primary ↔ Pannellum); its replacement is read
        // against the toggle's own state, so nothing is lost by there being none to set here.
        panoManager.getPanoMarker()?.marker_.classList.toggle(LabelVisibilityToggle.HIDDEN_CLASS, !visible);
        if (!visible && this.#heldOpen) this.hideLabelCard();
      },
    });

    // Keep the card up while the cursor is on it, so its Hide-label button can actually be clicked.
    this.#card.addEventListener('mouseenter', () => this.cancelScheduledCardHide());
    this.#card.addEventListener('mouseleave', () => this.scheduleHideLabelCard());

    // Same deal for keyboard focus (#4729): the card holds while focus is inside it, and the grace timer starts
    // when focus leaves. focusout also fires on moves between the card's own controls, so those are filtered.
    this.#card.addEventListener('focusin', () => this.cancelScheduledCardHide());
    this.#card.addEventListener('focusout', (e) => {
      if (!this.#card.contains(/** @type {Node} */ (e.relatedTarget))) this.scheduleHideLabelCard();
    });

    // The card is anchored to the marker of the label being left, so it can't carry over to the next one. Closed as
    // the load starts rather than once the next pano is up: a card opened on load would otherwise sit over the
    // loading pano, and the busy lock blocks every way of closing it.
    labelContainer.onLoadingChange((loading) => {
      if (loading) this.hideLabelCard();
    });
    // Every label starts visible. Without this the toggle keeps saying "Show Label" over a marker that
    // renderPanoMarker just drew in full — you'd have to hide and re-show to get the two back in agreement. The
    // card renders first (its own subscription, from the constructor above), so one opened on load is filled in.
    labelContainer.onLabelShown(() => {
      this.unhideLabel();
      this.openCardOnLoad();
    });

    panoManager.onMarkerCreated((marker) => this.#wireMarker(marker));
    panoManager.onMarkerDrawn(() => this.reanchorLabelCard());
  }

  /** @returns {LabelCard} The card this control shows and hides. */
  getLabelCard() {
    return this.#labelCard;
  }

  /**
   * Makes the marker the control that opens the card, and reports its pointer and keyboard focus to this class,
   * which owns the card's positioning and timing.
   *
   * The marker is a control, not just a hover target (#4729): the card it opens is the only place the label's
   * rating, tags, and description appear. role=button with aria-expanded makes it read as a disclosure, and
   * aria-describedby hands a screen reader the card's contents right off the marker — the card itself never takes
   * focus. Its aria-label (the label's type) is set per label by PanoManager.renderPanoMarker, and #setMarkerExpanded
   * mirrors the card's visibility onto aria-expanded. Both platforms claim the same contract, because both answer
   * the activation an assistive technology sends (a click).
   *
   * @param {PanoMarker} panoMarker - The marker just built, which PanoManager replaces on every viewer swap.
   */
  #wireMarker(panoMarker) {
    const marker = panoMarker.marker_;
    marker.setAttribute('tabindex', '0');
    marker.setAttribute('role', 'button');
    marker.setAttribute('aria-haspopup', 'dialog');
    marker.setAttribute('aria-expanded', 'false');
    marker.setAttribute('aria-describedby', 'label-card');

    if (util.isMobile()) {
      // Three ways in, one path out: a finger, an assistive technology's activate gesture (which arrives as a
      // click, never as a touch), and Enter/Space for a keyboard on a tablet. Mobile Validate builds no
      // KeyboardManager (Main.js), so unlike desktop the keys are handled right here.
      //
      // A touch is the marker's from the moment it lands, so a drag beginning on it can't pan the pano — the same
      // trade the desktop marker makes with the mouse, over a target this small. Answering on touchend, and only
      // when the finger stayed put, at least keeps such a drag from opening the card on its way past.
      // (mobile-validate.css is what lets the touch reach the marker at all: the layer around it is
      // click-through so the pano gets every pan.)
      const TAP_SLOP = 25; // In this page's oversized px — it draws at ~2.5x the screen, so this is ~10 real px.
      const CLICK_AFTER_TOUCH_MS = 700;
      let touchStart = null;
      let lastTouchEndAt = 0;
      const activate = () => this.toggleLabelCard();

      marker.addEventListener('touchstart', (e) => {
        // A second finger means a pinch is starting, not a tap. Drop the tracked touch rather than overwrite it:
        // the marker is the one thing over the pano a finger can land on, so both fingers of a pinch can begin
        // here, and the second one's lift would otherwise read as a tap that started where the first finger did.
        if (e.touches.length > 1) {
          touchStart = null;
          return;
        }
        const touch = e.changedTouches[0];
        touchStart = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
      }, { passive: true });

      marker.addEventListener('touchcancel', () => {
        touchStart = null;
      }, { passive: true });

      marker.addEventListener('touchend', (e) => {
        lastTouchEndAt = Date.now();
        if (!touchStart) return;
        // Only the finger the tap started with, and only once it is the last one down.
        const touch = Array.from(e.changedTouches).find((t) => t.identifier === touchStart.id);
        if (!touch) return;
        const { x, y } = touchStart;
        touchStart = null;
        if (e.touches.length > 0) return;
        if (Math.hypot(touch.clientX - x, touch.clientY - y) <= TAP_SLOP) activate();
      }, { passive: true });

      marker.addEventListener('click', () => {
        // A tap synthesizes a click shortly after its touchend, and that touch has already been judged above —
        // honoured as a tap or turned down as a drag. So this is only for the activations that arrive with no
        // touch behind them, which is how an assistive technology presses a button.
        if (Date.now() - lastTouchEndAt < CLICK_AFTER_TOUCH_MS) return;
        activate();
      });

      marker.addEventListener('keydown', (e) => {
        // role=button brings no native key handling, and there is no KeyboardManager here to supply it.
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); // Space would otherwise scroll the page.
        activate();
      });
    } else {
      // Enter, Space, and Escape are handled in Validate's KeyboardManager, which listens on window with capture
      // and would otherwise submit a validation on the same keys.
      marker.addEventListener('mouseover', (e) => {
        // Don't re-show the hover info if the cursor passes over the marker mid-pan (a mouse button is held).
        if (e.buttons) return;
        this.showLabelCard();
      });

      // Scheduled rather than immediate: the card sits beside the marker, so the cursor has to cross a gap to
      // reach it and an instant hide would make the button inside it unclickable.
      marker.addEventListener('mouseout', () => this.scheduleHideLabelCard());

      // A click focuses the marker too, and that focus must not reopen the card the same press just closed.
      let pressing = false;
      marker.addEventListener('mousedown', () => {
        pressing = true;
        // On the window, since a drag that starts here can end anywhere.
        window.addEventListener('mouseup', () => {
          pressing = false;
        }, { once: true });
      });

      // Keyboard focus opens the card the way hovering does, with the same grace timer on the way out so Tab
      // can travel from the marker onto the card's controls before the hide fires.
      marker.addEventListener('focus', (e) => {
        if (pressing) return;
        // Focus returning from inside the card is not an open request: it is either Escape closing the card
        // (which must stay closed) or Shift+Tab walking back out (whose focusout just scheduled a hide that
        // this cancel undoes).
        const cameFrom = /** @type {Node} */ (e.relatedTarget);
        if (this.#card.contains(cameFrom)) this.cancelScheduledCardHide();
        else this.showLabelCard({ viaKeyboard: true });
      });
      marker.addEventListener('blur', () => this.scheduleHideLabelCard());
    }
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

  /** @returns {boolean} True while a card opened on load is up, which ordinary keypresses shouldn't close. */
  isCardHeldOpen() {
    return this.#heldOpen;
  }

  /** Opens the card for a label that just loaded, on the cities that want it up without a hover (#5675). */
  openCardOnLoad() {
    if (this.#opensOnLoad) this.showLabelCard({ holdOpen: true });
  }

  /**
   * Shows the label card beside the label's marker.
   *
   * @param {object} [options]
   * @param {boolean} [options.viaKeyboard] - The card was opened from the keyboard (Tab onto the marker, or Enter/
   *     Space on it) rather than by pointer. Logged under its own event name, the way the H key's hide is —
   *     see docs/logged-events.md.
   * @param {boolean} [options.holdOpen] - Opened on load rather than by the user, so it stays up until something
   *     deliberate closes it (see openCardOnLoad).
   */
  showLabelCard({ viaKeyboard = false, holdOpen = false } = {}) {
    this.cancelScheduledCardHide();
    if (!this.#anchorCard()) return;
    if (holdOpen) this.#tracker.push('LabelCard_OpenedOnLoad');
    else if (!this.#cardVisible) this.#tracker.push(viaKeyboard ? 'KeyboardShortcut_ShowLabelCard' : 'MouseOver_Label');
    if (holdOpen) this.#heldOpen = true;
    // In immersive mode a held card would otherwise sit over the voting dock (svv-immersive.css).
    this.#card.classList.toggle('label-card--held', this.#heldOpen);
    this.#cardVisible = true;
    this.#card.style.visibility = 'visible';
    this.#setMarkerExpanded(true);
  }

  /**
   * Hides the label card immediately. Used when something definitively supersedes it — a pan starting, the H key,
   * or a move to the next label — as opposed to the cursor merely leaving the marker.
   */
  hideLabelCard() {
    this.cancelScheduledCardHide();
    // The card's popovers hang off it, so they go too. Left open one would be invisible but still armed, and every
    // later scheduleHideLabelCard would defer to it forever.
    this.#labelCard.closePopovers();
    // Hiding the card with focus inside it (its Hide-label button) would drop focus to the page; send it back to the
    // marker the card belongs to. The marker's focus handler sees it came from the card and doesn't reopen it.
    if (this.#card.contains(document.activeElement)) document.getElementById('validate-pano-marker')?.focus();
    this.#heldOpen = false;
    this.#card.classList.remove('label-card--held');
    this.#cardVisible = false;
    this.#card.style.visibility = 'hidden';
    this.#setMarkerExpanded(false);
  }

  /**
   * Hides the label card after a short grace period, giving the cursor time to travel from the marker onto the card.
   * A pending timer is left running rather than reset, so the deadline stays a hard #CARD_HIDE_DELAY_MS from when
   * the pointer first left.
   */
  scheduleHideLabelCard() {
    // An open share popover or type dropdown extends past the card, so the pointer leaving the card doesn't mean the
    // user is done with it. Taking the card down here would take the popover with it, mid-choice —
    // handlePopoverDismissed re-arms the hide once the popover closes.
    if (this.#heldOpen || this.#hideCardTimer !== null || this.#labelCard.isPopoverOpen()) return;
    this.#hideCardTimer = setTimeout(() => {
      this.#hideCardTimer = null;
      this.hideLabelCard();
    }, LabelVisibilityControl.#CARD_HIDE_DELAY_MS);
  }

  /**
   * Re-arms the card's hide once a popover that had been holding it open goes away. The pointer left the card
   * while the popover was up, and no second mouseleave is coming, so without this the card stays until a pan, the
   * H key, or the next label. Left alone if the pointer or the keyboard is back in the card, or it is already gone.
   */
  handlePopoverDismissed() {
    if (!this.#cardVisible) return;
    if (this.#card.matches(':hover') || this.#card.contains(document.activeElement)) return;
    this.scheduleHideLabelCard();
  }

  /**
   * Toggles the card. The mobile pano has no hover, so activating the marker — a tap, an assistive technology's
   * press, or Enter/Space — opens and closes it; on desktop this is Enter/Space on the focused marker.
   *
   * @param {object} [options] - Forwarded to showLabelCard — see its viaKeyboard note.
   */
  toggleLabelCard(options) {
    if (this.#cardVisible) this.hideLabelCard();
    else this.showLabelCard(options);
  }

  /**
   * Re-anchors the card to the marker if it is showing. Called on every draw of the marker, so the card stays glued
   * to the icon through POV changes, zooming, and window resizes rather than being left behind where it opened.
   */
  reanchorLabelCard() {
    if (!this.#cardVisible) return;
    if (!this.#anchorCard()) this.hideLabelCard();
  }

  /**
   * Cancels a pending grace-timer hide. The marker's focus handler needs it when focus walks back out of the card
   * onto the marker: the card should hold, but must not re-open if Escape just closed it — which showLabelCard()
   * would do.
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
   * Guarded on the role rather than the platform: #wireMarker is what decides whether a given marker claims to be a
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
    const layer = this.#controlLayer;
    if (!marker || !layer || marker.offsetLeft < -1000) return false;

    const scale = parseFloat(getComputedStyle(this.#card).getPropertyValue('--ui-scale')) || 1;
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
