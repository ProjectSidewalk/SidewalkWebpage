/**
 * Canvas Module. Owns the label canvas: drawing labels, hit-testing the cursor, pano pan/cursor handling, and the
 * hover card a hovered label gets.
 */

import { ShareWidget } from '../../common/share/ShareWidget.js';
import { Gate } from '../../common/Gate.js';
import { util } from '../../common/utilities.js';
import { Label } from '../label/Label.js';
import '../../common/pano-viewer/panoUtilities.js';
import '../../common/utilitiesSidewalk.js';
/** @typedef {import('../Main.js').CanvasUi} CanvasUi */
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('../Main.js').StreetviewUi} StreetviewUi */
/** @typedef {import('../game/AudioEffect.js').AudioEffect} AudioEffect */
/** @typedef {import('./CanvasFrame.js').CanvasFrame} CanvasFrame */
/** @typedef {import('./ContextMenu.js').ContextMenu} ContextMenu */
/** @typedef {import('../data/Form.js').Form} Form */
/** @typedef {import('../../common/LabelCardView.js').LabelCardView} LabelCardView */
/** @typedef {import('../label/LabelContainer.js').LabelContainer} LabelContainer */
/** @typedef {import('../mission/MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../menu/LabelModes.js').LabelModes} LabelModes */
/** @typedef {import('../navigation/NavigationService.js').NavigationService} NavigationService */
/** @typedef {import('../task/TaskContainer.js').TaskContainer} TaskContainer */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class Canvas {
  // Widest crop we store, in px: what the boxed tool's HiDPI canvas has always produced (1440x960), and the size the
  // share images and ML crops are cut from.
  static CROP_MAX_WIDTH = 1440;
  // Grace period before the hover card hides once the cursor leaves the label, giving the pointer time to
  // travel from the icon onto the card (e.g. to reach its Edit/Delete buttons) without the card vanishing mid-way.
  static #HOVER_CARD_HIDE_DELAY_MS = 200;

  #ui;
  #streetviewUi;
  #config;
  #frame;
  #labelCardView;
  #labelModes;
  #contextMenu;
  #labelContainer;
  #missionContainer;
  #taskContainer;
  #panoManager;
  #form;
  #audioEffect;
  #tracker;

  #ctx;
  #hoverCardHideTimer = null;
  #shareWidget = null;
  #shareUrl = null;
  // The pano the labels were last filtered for, so a re-render only re-filters once the pano changes.
  #currPanoId;
  #status = {
    currentLabel: null,
  };

  /**
   * Whether a click on the drawing layer places a label: held by a move in flight and by a pop-up.
   * @type {Gate}
   */
  labeling = new Gate();

  // Mouse status and mouse event callback functions.
  #mouseStatus = {
    prevX: 0,
    prevY: 0,
    isLeftDown: false,
  };

  /**
   * @param {CanvasUi} ui - The drawing layer and the hover card's elements.
   * @param {StreetviewUi} streetviewUi - The pano's layers; panning happens on its control layer.
   * @param {ExploreConfig} config
   * @param {CanvasFrame} frame - The frame labels are placed in.
   * @param {LabelCardView} labelCardView - Fills the hover card's content.
   * @param {LabelModes} labelModes - Says which label type is armed; arming one takes the hover card down.
   * @param {ContextMenu} contextMenu - Opened for a clicked label; its changes re-render the canvas.
   * @param {LabelContainer} labelContainer - Owns the labels; a placed or removed label re-renders the canvas.
   * @param {MissionContainer} missionContainer - Whose current mission a new label belongs to.
   * @param {TaskContainer} taskContainer - Whose current street a new label belongs to.
   * @param {PanoManager} panoManager - Whose view is panned and projected through, and redrawn for as it changes.
   * @param {NavigationService} navigationService - Whose moves pause labeling and take the hover card down.
   * @param {Form} form - Submits a placed label, and saves one before it is shared.
   * @param {AudioEffect} audioEffect - The placement sound.
   * @param {Tracker} tracker
   */
  constructor(ui, streetviewUi, config, frame, labelCardView, labelModes, contextMenu, labelContainer,
    missionContainer, taskContainer, panoManager, navigationService, form, audioEffect, tracker) {
    this.#ui = ui;
    this.#streetviewUi = streetviewUi;
    this.#config = config;
    this.#frame = frame;
    this.#labelCardView = labelCardView;
    this.#labelModes = labelModes;
    this.#contextMenu = contextMenu;
    this.#labelContainer = labelContainer;
    this.#missionContainer = missionContainer;
    this.#taskContainer = taskContainer;
    this.#panoManager = panoManager;
    this.#form = form;
    this.#audioEffect = audioEffect;
    this.#tracker = tracker;
    this.#init();

    labelModes.onModeChanged((mode) => {
      if (mode === 'Walk') return;
      // A lingering hover card would sit above the drawing layer and swallow the label-placement click.
      this.showLabelHoverInfo(undefined);
      // Change the cursor before the mouse moves. Doesn't bubble, so the tracker never logs it.
      ui.drawingLayer.dispatchEvent(new MouseEvent('mousemove'));
      // Safari requires audio to be loaded before each play, which takes time, so the placement sound loads when a
      // label type is armed rather than when the label is placed.
      this.#audioEffect.load('drip');
    });
    panoManager.onPovChanged(() => this.update());
    navigationService.onMoveStarted(() => {
      this.hideHoverCard();
      this.labeling.hold('move');
    });
    navigationService.onMoveFinished(() => this.labeling.release('move'));
    contextMenu.onChange(() => this.clear().render());
    labelContainer.onLabelPlaced((label) => this.#saveCropFor(label));
    labelContainer.onLabelRemoved(() => {
      this.hideHoverCard();
      this.setCurrentLabel(undefined);
      this.clear().render();
    });
  }

  /**
   * Initialization: set up the canvas context and attach listeners to DOM elements.
   */
  #init() {
    // Set up the canvas context.
    const el = document.getElementById('label-canvas');
    if (!el) {
      return;
    }
    this.#ctx = /** @type {HTMLCanvasElement} */ (el).getContext('2d');

    // Render the canvas at its on-screen (and HiDPI) resolution now that pano may be displayed at a different size
    // than the 720x480 logical frame, while keeping all drawing code in that logical frame via a context transform.
    util.sizeCanvasToDisplay(/** @type {HTMLCanvasElement} */ (el), this.#ctx);

    // Attach listeners to dom elements. view-control-layer handles panning, drawing-layer handles adding labels.
    const ui = this.#ui;
    const viewControlLayer = this.#streetviewUi.viewControlLayer;
    ui.drawingLayer.addEventListener('mousedown', (e) => this.#handleDrawingLayerMouseDown(e));
    ui.drawingLayer.addEventListener('mouseup', (e) => this.#handleDrawingLayerMouseUp(e));
    ui.drawingLayer.addEventListener('mousemove', (e) => this.#handleDrawingLayerMouseMove(e));
    Canvas.watchPanoExit(document.getElementById('interaction-area-holder'), () => this.#handleDrawingLayerMouseOut());
    ui.hoverCard.addEventListener('click', () => this.#handleHoverCardClick('card'));
    ui.hoverCard.addEventListener('mouseenter', () => this.#cancelScheduledHoverCardHide());
    ui.hoverCard.addEventListener('mouseleave', () => this.#scheduleHoverCardHide());
    ui.hoverCardEdit.addEventListener('click', (e) => {
      e.stopPropagation(); // So the card's own click handler doesn't open the menu a second time.
      this.#handleHoverCardClick('edit-button');
    });
    ui.hoverCardDelete.addEventListener('click', (e) => this.#handleHoverCardDeleteClick(e));
    this.#initShareWidget();
    viewControlLayer.addEventListener('mousedown', (e) => this.#handlerViewControlLayerMouseDown(e));
    viewControlLayer.addEventListener('mouseup', (e) => this.#handlerViewControlLayerMouseUp(e));
    viewControlLayer.addEventListener('mousemove', (e) => this.#handlerViewControlLayerMouseMove(e));
    viewControlLayer.addEventListener('mouseleave', () => this.#handlerViewControlLayerMouseLeave());
    viewControlLayer.onselectstart = () => false;
  }

  /**
   * Create a label at the given X/Y canvas coordinate.
   * @param {number} canvasX
   * @param {number} canvasY
   */
  #createLabel(canvasX, canvasY) {
    // Generate some metadata for the new label.
    const labelType = this.#labelModes.getSelectedLabelType();
    const pov = this.#panoManager.getPov();
    // The click is projected through the frame it was made in, and the label keeps that frame (#5085): it is stored
    // beside canvas_x/canvas_y so every later reader can project the point the same way.
    const frame = this.#frame;
    const hFov = frame.renderedHFov(pov.zoom);
    const povOfLabel = util.pano.canvasCoordToCenteredPov(pov, canvasX, canvasY, frame.width, frame.height, hFov);
    const rerenderCanvasCoord = util.pano.centeredPovToCanvasCoord(
      povOfLabel, pov, frame.width, frame.height, frame.iconRadius, hFov,
    );
    const param = {
      tutorial: this.#config.isOnboarding,
      missionId: this.#missionContainer.getCurrentMission().getProperty('missionId'),
      auditTaskId: this.#taskContainer.getCurrentTask().getAuditTaskId(),
      labelType,
      originalCanvasXY: { x: canvasX, y: canvasY },
      originalCanvasFrame: { width: frame.width, height: frame.height },
      currCanvasXY: rerenderCanvasCoord,
      povOfLabelIfCentered: povOfLabel,
      panoId: this.#panoManager.getPanoId(),
      originalPov: pov,
    };

    this.#status.currentLabel = this.#labelContainer.createLabel(param, true);
    this.#contextMenu.show(this.#status.currentLabel);

    // Log the labeling event.
    this.#tracker.push('LabelingCanvas_FinishLabeling', {
      labelType,
      canvasX,
      canvasY,
      canvasWidth: frame.width,
      canvasHeight: frame.height,
    }, this.#status.currentLabel);

    this.#audioEffect.play('drip');

    // The tutorial checks where the label landed.
    if (this.#config.isOnboarding) {
      const customEvent = new CustomEvent('addTutorialLabel', {
        detail: { label: this.#status.currentLabel },
      });
      document.dispatchEvent(customEvent);
    }

    // Wait for the crop to be saved before switching back to walk mode.
    // We are hiding the 'road labels' in the labeling mode as we don't want them to show in the crop.
    // So we need to ensure we don't switch back to explore mode until the crop is saved.
    // Trying to keep the timeout as low as possible to avoid any delay in switching back to walk mode for now.
    // Can try increasing it if we save crops with the road labels.
    setTimeout(() => {
      this.#labelModes.backToWalk();
    }, 20);
  }

  /**
   * Sets the cursor over the street view image.
   * @param {string} type - One of 'OpenHand', 'ClosedHand', or 'Pointer'; uses 'default' for any other input.
   */
  #setViewControlLayerCursor(type) {
    const layer = this.#streetviewUi.viewControlLayer;
    switch (type) {
      case 'OpenHand':
        layer.style.cursor = `url(${util.assetPath('images/icons/openhand.cur')}) 4 4, move`;
        break;
      case 'ClosedHand':
        layer.style.cursor = `url(${util.assetPath('images/icons/closedhand.cur')}) 4 4, move`;
        break;
      case 'Pointer':
        layer.style.cursor = 'pointer';
        break;
      default:
        layer.style.cursor = 'default';
    }
  }

  /**
   * Returns the cursor position in the logical canvas frame (720 px wide, see util.exploreCanvasFrame).
   *
   * The street view is displayed larger than the logical frame (see the --pano-width CSS variable), so we
   * divide the on-screen position by the display scale.
   *
   * @param {MouseEvent} e - The mouse event, measured against the element its listener is bound to.
   * @returns {{x: number, y: number}}
   */
  #canvasMousePosition(e) {
    const pos = util.mousePosition(e, e.currentTarget);
    const scale = util.exploreDisplayScale();
    return { x: Math.round(pos.x / scale), y: Math.round(pos.y / scale) };
  }

  /**
   * Callback fired with the mousedown event on the view control layer (where you control street view angle).
   * @param {MouseEvent} e
   */
  #handlerViewControlLayerMouseDown(e) {
    const currMousePosition = this.#canvasMousePosition(e);
    this.#mouseStatus.isLeftDown = true;
    this.#tracker.push('ViewControl_MouseDown', currMousePosition);
    this.#setViewControlLayerCursor('ClosedHand');
  }

  /**
   * Callback on mouse up event on the view control layer (where you change the Google Street view angle).
   * @param {MouseEvent} e
   */
  #handlerViewControlLayerMouseUp(e) {
    const currMousePosition = this.#canvasMousePosition(e);
    this.#mouseStatus.isLeftDown = false;
    this.#tracker.push('ViewControl_MouseUp', currMousePosition);
    const currTime = new Date();

    const selectedLabel = this.onLabel(currMousePosition.x, currMousePosition.y);
    if (selectedLabel && selectedLabel.className === 'Label') {
      this.setCurrentLabel(selectedLabel);
      this.#setViewControlLayerCursor('Pointer');
      this.#contextMenu.show(selectedLabel);
    } else {
      this.#setViewControlLayerCursor('OpenHand');
      if (currTime.getTime() - this.#mouseStatus.prevMouseUpTime < 300) {
        // Continue logging double click. We don't have any features for it now, but it's good to know how
        // frequently people are trying to double-click. They might be trying to zoom?
        this.#tracker.push('ViewControl_DoubleClick');
      }
    }
    this.#mouseStatus.prevMouseUpTime = currTime;
  }

  #handlerViewControlLayerMouseLeave() {
    this.#setViewControlLayerCursor('OpenHand');
    this.#mouseStatus.isLeftDown = false;

    // Catches the pointer exiting the pano while still over a label, which never fires the layer's mousemove.
    this.#scheduleHoverCardHide();
  }

  /**
   * Callback fired when a user moves a mouse on the view control layer where you change the pov.
   * @param {MouseEvent} e
   */
  #handlerViewControlLayerMouseMove(e) {
    const currMousePosition = this.#canvasMousePosition(e);

    const item = this.onLabel(currMousePosition.x, currMousePosition.y);
    if (this.#mouseStatus.isLeftDown && !this.#panoManager.panning.isHeld()) {
      // If a mouse is being dragged on the control layer, move the pano.
      const pov = this.#panoManager.getPov();
      const zoomScaling = Math.pow(2, pov.zoom);
      const dx = (currMousePosition.x - this.#mouseStatus.prevX) / zoomScaling;
      const dy = (currMousePosition.y - this.#mouseStatus.prevY) / zoomScaling;
      this.#panoManager.updatePov(dx, dy);
      this.#setViewControlLayerCursor('ClosedHand');

      // Hide any label hover info while panning so it doesn't linger over the moving pano.
      this.showLabelHoverInfo(undefined);
      this.setCurrentLabel(undefined);
    } else if (item && item.className === 'Label') {
      // Show the hover card and update the cursor when hovering over a label.
      this.#setViewControlLayerCursor('Pointer');
      const selectedLabel = item;
      this.setCurrentLabel(selectedLabel);
      this.showLabelHoverInfo(selectedLabel);
      this.clear().render();
    } else {
      // Hide the hover card after a grace period, so the pointer can travel from the icon onto the card.
      this.#setViewControlLayerCursor('OpenHand');
      this.#scheduleHoverCardHide();
    }

    this.#mouseStatus.prevX = currMousePosition.x;
    this.#mouseStatus.prevY = currMousePosition.y;
  }

  /**
   * Calls `onExit` when the pointer leaves the pano. Toasts float over the pano but mount on <body> (#5496). While
   * labeling their card is click-through (svl-canvas.css), but their buttons are not, so the pointer reaching the
   * close X fires `mouseleave` although it never left the pano; the real exit is then when it leaves the toast for
   * somewhere outside the pano. Only a toast reached from the pano counts: Explore raises toasts elsewhere too (the
   * badge-unlock toast over the mission-complete modal), and crossing one of those says nothing about the pano.
   *
   * A toast removed from under the pointer fires no mouseout, so an exit made straight off it goes unseen and the
   * label type stays armed. That is the state right after picking a type from the ribbon, so it's left alone.
   * @param {HTMLElement|null} holder - The element wrapping the pano and its drawing layers; null watches nothing.
   * @param {() => void} onExit - Called once per exit.
   * @param {{signal?: AbortSignal}} [opts] - `signal` removes the listeners when aborted.
   */
  static watchPanoExit(holder, onExit, { signal } = {}) {
    if (!holder) return;
    const isToast = (el) => el instanceof Element && el.closest('.ps-toast') !== null;
    const isOverPano = (el) => isToast(el) || (el instanceof Node && holder.contains(el));
    let onToastFromPano = false;
    holder.addEventListener('mouseenter', () => {
      onToastFromPano = false;
    }, { signal });
    holder.addEventListener('mouseleave', (e) => {
      if (isToast(e.relatedTarget)) onToastFromPano = true;
      else onExit();
    }, { signal });
    // mouseout rather than mouseleave: it bubbles, so one listener covers toasts created after this runs.
    document.addEventListener('mouseout', (e) => {
      if (!onToastFromPano || !isToast(e.target) || isOverPano(e.relatedTarget)) return;
      onToastFromPano = false;
      onExit();
    }, { signal });
  }

  /**
   * When mousing out of the canvas, stop trying to add a label type, switching back to Explore mode.
   */
  #handleDrawingLayerMouseOut() {
    this.#tracker.push('LabelingCanvas_MouseOut');
    if (!this.#config.isOnboarding) this.#labelModes.backToWalk();
  }

  /**
   * Record locations of mouse-down event. Most functionality happens on mouse-up, but mouse-down context matters.
   * @param {MouseEvent} e
   */
  #handleDrawingLayerMouseDown(e) {
    this.#tracker.push('LabelingCanvas_MouseDown', this.#canvasMousePosition(e));
  }

  /**
   * Create a new label on mouse-up if we are in a labeling mode.
   * @param {MouseEvent} e
   */
  async #handleDrawingLayerMouseUp(e) {
    const currMousePosition = this.#canvasMousePosition(e);

    if (!this.labeling.isHeld()) {
      this.#createLabel(currMousePosition.x, currMousePosition.y);
      this.clear();
      this.setOnlyLabelsOnPanoAsVisible(this.#panoManager.getPanoId());
      this.render();
    }

    this.#tracker.push('LabelingCanvas_MouseUp', currMousePosition);
    await this.#form.submitData(); // Submit the label to the back end.
  }

  /**
   * Update the canvas based on a mouse-move event: changing cursor, re-rendering, etc.
   * @param {MouseEvent} e
   */
  #handleDrawingLayerMouseMove(e) {
    // Change the cursor according to the label type.
    const cursorUrl = Label.getCursorImageUrl(this.#labelModes.getMode());
    if (cursorUrl) {
      const hotspot = Label.CURSOR_ICON_SIZE / 2;
      // Need to reset the cursor first, otherwise Safari strangely doesn't update the cursor.
      const layer = /** @type {HTMLElement} */ (e.currentTarget);
      layer.style.cursor = '';
      layer.style.cursor = `url(${cursorUrl}) ${hotspot} ${hotspot}, auto`;
    }
  }

  /**
   * Delete a label. Called when a user clicks the Delete button on a label's hover card.
   * @param {MouseEvent} e
   */
  #handleHoverCardDeleteClick(e) {
    e.stopPropagation(); // Deleting must not also trigger the card's open-context-menu click.
    const currLabel = this.getCurrentLabel();
    if (!this.#labelContainer.canDelete(currLabel)) return;
    this.#tracker.push('Click_LabelDelete', { labelType: currLabel.getProperty('labelType') }, currLabel);
    this.#labelContainer.removeLabel(currLabel);
  }

  /**
   * Opens the hovered label's context menu — fired by the card's Edit button, and by a click anywhere else on the
   * card, which is one big click target for the same action as clicking the label icon itself.
   * @param {string} via - What was clicked ('card' or 'edit-button'), logged with the event.
   */
  #handleHoverCardClick(via) {
    const currLabel = this.getCurrentLabel();
    if (currLabel && currLabel.getLabelType() !== 'Occlusion') {
      this.#tracker.push('Click_LabelHoverCard', { labelType: currLabel.getLabelType(), via });
      this.showLabelHoverInfo(undefined);
      this.#contextMenu.show(currLabel);
    }
  }

  /**
   * Builds the hover card's share control. One widget, re-pointed at whichever label is hovered.
   *
   * A label placed this session has no server-side id until the next form submit, so rather than hiding the button
   * or greying it out, clicking it submits first and then shares — beforeOpen holds the popover until the id is
   * back. Onboarding labels are the exception: the server never issues ids for them, so there is nothing to wait
   * for and the button is hidden instead (see #pointShareAtLabel).
   */
  #initShareWidget() {
    const trigger = this.#ui.hoverCardShare;
    if (!trigger) return;

    // The card as a whole opens the context menu; nothing in the share control may also do that. The listener goes
    // on the wrapper, not the trigger: ShareWidget builds its popover inside the wrapper, so the menu items are
    // descendants of the card too, and a guard on the trigger alone lets "Copy link" open the context menu.
    trigger.parentElement?.addEventListener('click', (e) => e.stopPropagation());

    trigger.addEventListener('click', () => {
      // Only the opening click. The same handler runs on the click that dismisses the popover, which is not a share.
      if (this.#shareWidget?.isOpen()) return;
      this.#tracker.push('Click_LabelCardShare', { labelType: this.getCurrentLabel()?.getLabelType() });
    });

    this.#shareWidget = new ShareWidget(trigger, {
      // The card is anchored to a label icon, which can sit anywhere in the pano, so the menu has to work out which
      // side it fits on each time it opens.
      fitToViewport: true,
      onDismiss: () => this.#handleShareDismissed(),
      beforeOpen: async () => {
        const label = this.getCurrentLabel();
        await this.#form.ensureLabelSaved(label);
        // The label now has an id it didn't have a moment ago, so re-point past the no-op guard.
        this.#shareUrl = null;
        if (label) this.#pointShareAtLabel(label);
      },
    });
  }

  /**
   * Re-arms the card's hide once the share popover that had been holding it open goes away.
   *
   * #scheduleHoverCardHide is only reached from a pointer leaving the card or a label, and while the popover was up
   * it declined to schedule anything. The pointer is long gone by then and no second mouseleave is coming, so
   * without this the card would sit there until an unrelated event took it down. Skipped when the pointer is back
   * on the card, where it is meant to stay.
   */
  #handleShareDismissed() {
    if (!this.#ui.hoverCard.matches(':hover')) this.#scheduleHoverCardHide();
  }

  /**
   * Points the share control at a label, or hides the button when that label can never have a public URL.
   *
   * Re-run on every canvas frame while a label is hovered, so this only touches the widget when the target actually
   * changes. setTarget closes an open popover, which on every frame would make the popover impossible to use at all.
   *
   * @param {Label} label - The hovered label.
   */
  #pointShareAtLabel(label) {
    // Tutorial labels are never submitted, so no id is coming and the button would be a dead end.
    const shareable = !this.#config.isOnboarding && !label.isDeleted();
    this.#ui.hoverCard.classList.toggle('label-hover-card--no-share', !shareable);
    if (!this.#shareWidget || !shareable) return;

    const id = label.getProperty('labelId');
    // 'DefaultValue' until the label has been submitted; the widget's beforeOpen step fills the URL in on click.
    const url = Number.isInteger(id) ? `${window.location.origin}/label/${id}` : '';
    if (url === this.#shareUrl) return;
    this.#shareUrl = url;
    this.#setShareTarget(label, url);
  }

  /** Writes the share target for a label. */
  #setShareTarget(label, url) {
    const labelTypeName = util.misc.labelTypeName(label.getLabelType());
    const text = i18next.t('common:share.text', { labelType: labelTypeName });
    this.#shareWidget.setTarget({ url, title: text, text });
  }

  /**
   * Populates and positions the hover card next to a label, showing its type, severity, tags, and description,
   * plus its Delete/Edit action buttons. The populate itself lives in the shared LabelCardView (#4730); what stays
   * here is everything Explore-specific — the context-menu guard, the card's mode classes, and the anchoring.
   *
   * The card is a single shared DOM element positioned in on-screen pixels, so the label's logical canvas
   * coordinate is scaled to the displayed pano size (see util.exploreDisplayScale).
   * @param {Label} label - The hovered label.
   */
  #updateHoverCard(label) {
    // Don't show the hover card while the context menu is open or before the label has a canvas position.
    if (this.#contextMenu.isOpen() || !label.getCanvasXY()) {
      this.hideHoverCard();
      return;
    }

    const ui = this.#ui;
    this.#labelCardView.render({
      labelType: label.getLabelType(),
      severity: label.getProperty('severity'),
      tagNames: this.#tagNamesOf(label),
      description: label.getProperty('description'),
    });

    // Occlusion labels have no context menu, so the card isn't a click target and the Edit button is hidden.
    ui.hoverCard.classList.toggle('label-hover-card--static', label.getLabelType() === 'Occlusion');
    // The tutorial's delete lock hides the Delete button.
    ui.hoverCard.classList.toggle('label-hover-card--no-delete', !this.#labelContainer.canDelete(label));
    // Aims the share control at this label (and hides it for labels that can never have a public URL).
    this.#pointShareAtLabel(label);

    // The card and the context menu it opens into share one anchor so the panel expands roughly in place.
    util.anchorPanelToLabel(ui.hoverCard, label.getCanvasXY(), this.#frame.iconRadius);
    ui.hoverCard.style.visibility = 'visible';
  }

  /**
   * The localized, plain-text names of a label's tags.
   * @param {Label} label
   * @returns {Array<string>}
   */
  #tagNamesOf(label) {
    const allTags = this.#contextMenu.labelTags;
    if (!allTags) return [];
    const tagInfo = util.misc.getLabelDescriptions(label.getLabelType())?.tagInfo ?? {};
    return label.getProperty('tagIds')
      .map((tagId) => allTags.find((tag) => tag.tag_id === tagId))
      .filter(Boolean)
      // The localized tag texts embed <tag-underline> keyboard-shortcut markup; the pills show plain text.
      .map((tag) => util.htmlToText(tagInfo[tag.tag]?.text ?? tag.tag));
  }

  /**
   * Schedules hiding the hover card after a short grace period. A pending timer is left running rather than reset,
   * so the deadline stays a hard 200ms from when the pointer left the label — the stream of mousemoves that follows
   * it off the label must not keep pushing the hide back. The hide is aborted if the pointer reaches the card
   * (mouseenter) or returns to a label before the timer fires.
   */
  #scheduleHoverCardHide() {
    // An open share popover hangs off the card, so the pointer leaving the card doesn't mean the user is done with
    // it. Hiding here would take the popover down mid-choice; #handleShareDismissed re-arms once it closes.
    if (this.#hoverCardHideTimer !== null || this.#shareWidget?.isOpen()) return;
    this.#hoverCardHideTimer = setTimeout(() => {
      this.#hoverCardHideTimer = null;
      this.showLabelHoverInfo(undefined);
      this.setCurrentLabel(undefined);
    }, Canvas.#HOVER_CARD_HIDE_DELAY_MS);
  }

  #cancelScheduledHoverCardHide() {
    if (this.#hoverCardHideTimer !== null) {
      clearTimeout(this.#hoverCardHideTimer);
      this.#hoverCardHideTimer = null;
    }
  }

  /**
   * Hides the hover card immediately, without the grace period.
   */
  hideHoverCard() {
    this.#ui.hoverCard.style.visibility = 'hidden';
  }

  /**
   * Clear what's on the canvas.
   * @returns {Canvas} this.
   */
  clear() {
    // clearRect() operates in the logical frame thanks to the context transform set in util.sizeCanvasToDisplay.
    this.#ctx.clearRect(0, 0, this.#frame.width, this.#frame.height);
    return this;
  }

  /**
   * Returns the label that the mouse is over.
   * @returns {?Label}
   */
  getCurrentLabel() {
    return this.#status.currentLabel;
  }

  getStatus(key) {
    return this.#status[key];
  }

  /**
   * Takes cursor coordinates x and y on the canvas and returns the label right below the cursor, or false if none.
   * @param {number} x
   * @param {number} y
   * @returns {Label|false}
   */
  onLabel(x, y) {
    const labels = this.#labelContainer.getCanvasLabels();

    // Walked back to front, because render() draws this same list in order and so the *last* match is the one the
    // user can actually see. Searching forward returned the label underneath. That was mostly hidden while the click
    // target was smaller than the icon; now that the target is the icon (#4838), two icons that visually touch have
    // overlapping targets, which makes it the ordinary case rather than a corner one.
    for (let i = labels.length - 1; i >= 0; i -= 1) {
      if (labels[i].isOn(x, y)) {
        this.#status.currentLabel = labels[i];
        return labels[i];
      }
    }
    return false;
  }

  /**
   * Renders labels on the canvas, and the hover card beside the hovered one.
   * @returns {Canvas} this.
   */
  render() {
    if (!this.#ctx) {
      return this;
    }
    const labels = this.#labelContainer.getCanvasLabels();
    const pov = this.#panoManager.getPov();
    const dialogTarget = this.#contextMenu.isOpen() ? this.#contextMenu.getTargetLabel() : null;

    for (let i = 0; i < labels.length; i += 1) {
      labels[i].render(this.#ctx, pov, labels[i] === dialogTarget);
      // The card follows the label's freshly projected position, so it keeps up as the pano pans.
      if (labels[i].isVisible() && !labels[i].isDeleted() && labels[i].getHoverInfoVisibility() === 'visible') {
        this.#updateHoverCard(labels[i]);
      }
    }
    return this;
  }

  /**
   * Redraws for the current view, re-filtering which labels show once the pano has changed under it.
   */
  update() {
    this.clear();
    const panoId = this.#panoManager.getPanoId();
    if (this.#currPanoId !== panoId) {
      this.setOnlyLabelsOnPanoAsVisible(panoId);
    }
    this.#currPanoId = panoId;
    this.render();
  }

  /**
   * Re-rasterizes the label canvas to the current displayed pano size and redraws all labels.
   * Call this after the UI scale changes (e.g. on window resize) so the canvas stays crisp and correctly placed.
   */
  resize() {
    const el = document.getElementById('label-canvas');
    if (!el || !this.#ctx) return;
    util.sizeCanvasToDisplay(/** @type {HTMLCanvasElement} */ (el), this.#ctx);
    this.clear().render();
  }

  setCurrentLabel(label) {
    this.#status.currentLabel = label;
  }

  setStatus(key, value) {
    if (key in this.#status) {
      this.#status[key] = value;
    } else {
      throw new Error('Canvas: Illegal status name.');
    }
  }

  /**
   * Sets the passed label's hoverInfoVisibility to 'visible' and all the others to 'hidden'.
   * @param {?Label} label
   */
  showLabelHoverInfo(label) {
    let needToRerender = false;

    // A definitive show/hide supersedes any pending grace-period hide.
    this.#cancelScheduledHoverCardHide();

    // Take the share popover down with the card. It is a child of the card, so hiding the card alone would leave it
    // invisible but still open — blocking every later #scheduleHoverCardHide, which waits on isOpen(). The
    // grace-period hide is the one path that must not do this; it defers to the open popover instead.
    if (!label) this.#shareWidget?.close();

    // Hide the hover info on all the labels.
    const labels = this.#labelContainer.getCanvasLabels();
    let hoverVisibility;
    for (let i = 0; i < labels.length; i += 1) {
      hoverVisibility = labels[i].getHoverInfoVisibility();

      // If this is the label being hovered, set its visibility.
      if (label) {
        needToRerender = true;
        if (label === labels[i]) {
          labels[i].setHoverInfoVisibility('visible');
        }
      } else if (hoverVisibility === 'visible') {
        // If not hovered but was being hovered, hide it and rerender.
        needToRerender = true;
        labels[i].setHoverInfoVisibility('hidden');

        // Hide the hover card when no label is hovered.
        this.hideHoverCard();
      }
    }

    if (needToRerender) {
      this.clear().render();
    }
  }

  /** @returns {Canvas} this. */
  setVisibility(visibility) {
    const labels = this.#labelContainer.getCanvasLabels();
    for (let i = 0; i < labels.length; i += 1) {
      labels[i].setVisibility(visibility);
    }
    return this;
  }

  /**
   * Sets labels on the given pano as visible, all others as hidden.
   * @param {string} panoId
   */
  setOnlyLabelsOnPanoAsVisible(panoId) {
    const labels = this.#labelContainer.getCanvasLabels();
    for (let i = 0; i < labels.length; i += 1) {
      if (labels[i].getPanoId() === panoId && !labels[i].isDeleted()) {
        labels[i].setVisibility('visible');
      } else {
        labels[i].setVisibility('hidden');
      }
    }
  }

  /**
   * Saves a screenshot of the pano for a label just placed, to be uploaded to the server later. Off the UI thread's
   * path, so the placement never waits on it.
   * @param {Label} label
   */
  #saveCropFor(label) {
    if (!this.#config.makeCrops || label.getProperty('tutorial')) return;
    setTimeout(() => {
      try {
        this.saveCanvasScreenshot(label);
      } catch (e) {
        // todo: better logging
        console.log('Error saving pano screenshot: ', e);
      }
    }, 0);
  }

  /**
   * Saves a screenshot of the canvas when the label was placed, to be uploaded to the server later.
   * @param {Label} label
   */
  saveCanvasScreenshot(label) {
    // If there is no label to associate this crop with, don't save the crop.
    if (!label) {
      console.log('No label found when making a crop.');
      return;
    }

    // Save a high-res version of the image to the label object. Uploaded after label is saved to the db.
    const source = /** @type {HTMLCanvasElement} */ (document.querySelector(
      `.${this.#panoManager.panoViewer.getCanvasClass()}`,
    ));
    label.setProperty('crop', Canvas.#cropDataUrl(source));
  }

  /**
   * The crop as a JPEG data URL, no wider than CROP_MAX_WIDTH.
   *
   * The pano's canvas is its on-screen box times the device pixel ratio: 1440 px wide for the boxed tool at its
   * largest, but 5000+ px for a fill-window viewport on a HiDPI display (#5085), which would make every crop 6-10x
   * the bytes for no gain to the card surfaces and ML pipeline that consume them. Wider canvases are downscaled,
   * keeping their aspect ratio, which the card surfaces read from the label's frame.
   *
   * @param {HTMLCanvasElement} source - The pano viewer's canvas.
   * @returns {string} A JPEG data URL.
   */
  static #cropDataUrl(source) {
    if (source.width <= Canvas.CROP_MAX_WIDTH) return source.toDataURL('image/jpeg', 1);
    const scaled = document.createElement('canvas');
    scaled.width = Canvas.CROP_MAX_WIDTH;
    scaled.height = Math.round(source.height * Canvas.CROP_MAX_WIDTH / source.width);
    const ctx = scaled.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, scaled.width, scaled.height);
    return scaled.toDataURL('image/jpeg', 1);
  }
}
