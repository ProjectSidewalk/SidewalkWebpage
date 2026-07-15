/**
 * Onboarding module.
 * Todo. So many dependencies! If possible, break the module down into pieces.
 */
class Onboarding {
  #svl;
  #compass;
  #handAnimation;
  #navigationService;
  #missionContainer;
  #panoOverlayControls;
  #ribbon;
  #tracker;
  #canvas;
  #uiCanvas;
  #contextMenu;
  #uiOnboarding;
  #zoomControl;

  #ctx;
  #blinkTimer = 0;
  #blinkFunctionIdentifier = [];
  #states;
  #statesWithProgress;
  #savedAnnotations = [];
  #mouseDownCanvasDrawingHandler;
  #map;
  #currentLabelId;
  #tutorialMinimapResizeObserver = null;

  // Floating UI autoUpdate cleanup for the currently anchored message, if any.
  #floatingCleanup = null;

  /**
   * @param svl
   * @param compass
   * @param handAnimation
   * @param navigationService
   * @param missionContainer
   * @param panoOverlayControls
   * @param onboardingStates
   * @param ribbon
   * @param tracker
   * @param canvas
   * @param uiCanvas
   * @param contextMenu
   * @param uiOnboarding
   * @param zoomControl
   */
  constructor(svl, compass, handAnimation, navigationService, missionContainer, panoOverlayControls, onboardingStates,
    ribbon, tracker, canvas, uiCanvas, contextMenu, uiOnboarding, zoomControl) {
    this.#svl = svl;
    this.#compass = compass;
    this.#handAnimation = handAnimation;
    this.#navigationService = navigationService;
    this.#missionContainer = missionContainer;
    this.#panoOverlayControls = panoOverlayControls;
    this.#ribbon = ribbon;
    this.#tracker = tracker;
    this.#canvas = canvas;
    this.#uiCanvas = uiCanvas;
    this.#contextMenu = contextMenu;
    this.#uiOnboarding = uiOnboarding;
    this.#zoomControl = zoomControl;

    this.#states = onboardingStates.get();
    this.#statesWithProgress = this.#states.filter((state) => state.progression);
    this.#map = svl.minimap.getMap();
  }

  start() {
    const svl = this.#svl;
    this.#tracker.push('Onboarding_Start');

    this.#adjustMap();

    $('#navbar-retake-tutorial-btn').css('display', 'none');

    const canvasUI = this.#uiOnboarding.canvas.get(0);
    if (canvasUI) this.#ctx = canvasUI.getContext('2d');
    this.#uiOnboarding.holder.css('visibility', 'visible');

    svl.panoManager.lockShowingNavArrows();

    this.#canvas.unlockDisableLabelDelete();
    this.#canvas.disableLabelDelete();
    this.#canvas.lockDisableLabelDelete();

    this.#navigationService.unlockDisableWalking().disableWalking().lockDisableWalking();

    this.#zoomControl.unlockDisableZoomIn();
    this.#zoomControl.disableZoomIn();
    this.#zoomControl.lockDisableZoomIn();

    this.#zoomControl.unlockDisableZoomOut();
    this.#zoomControl.disableZoomOut();
    this.#zoomControl.lockDisableZoomOut();

    this.#ribbon.unlockDisableModeSwitch();
    this.#ribbon.disableModeSwitch();
    this.#ribbon.lockDisableModeSwitch();

    this.#ribbon.unlockDisableMode();

    this.#panoOverlayControls.disableButtons();

    this.#compass.hideMessage();
    this.#compass.disableCompassClick();
    this.#compass.lockDisableCompassClick();

    this.#contextMenu.disableRatingSeverity();
    this.#contextMenu.disableTagging();

    // Make sure that the context menu covers instructions when hovering over the context menu.
    svl.ui.contextMenu.holder.on('mouseover', () => {
      this.#uiOnboarding.messageHolder.css('z-index', 2);
    });
    svl.ui.contextMenu.holder.on('mouseout', () => {
      this.#uiOnboarding.messageHolder.css('z-index', 1100);
    });

    this.#visit(this.#getState('initialize'));
    this.#handAnimation.initializeHandAnimation();
  }

  /**
   * Sets the mini map to be transparent for everything except for yellow pin.
   */
  #adjustMap() {
    const svl = this.#svl;
    // Render the minimap at its native square size and zoom the whole holder uniformly (see .minimap-tutorial) so
    // the static screenshot, the Google label markers, and the fog all share one coordinate frame and stay aligned.
    svl.ui.minimap.holder.addClass('minimap-tutorial');
    svl.ui.minimap.holder.css({
      backgroundImage: `url('${svl.imageDirectory}onboarding/TutorialMiniMap.jpg')`,
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
    });

    // Fit the square to the available sidebar height now and whenever the sidebar resizes (e.g. UI-scale changes).
    this.#sizeTutorialMinimap();
    if (window.ResizeObserver && !this.#tutorialMinimapResizeObserver) {
      this.#tutorialMinimapResizeObserver = new ResizeObserver(() => this.#sizeTutorialMinimap());
      this.#tutorialMinimapResizeObserver.observe(svl.ui.minimap.holder[0].parentElement);
    }

    // TODO use cloud-based maps styling for this potentially as well..? Hiding something in dom as workaround.
    // map.setOptions({styles: [{ featureType: 'all', stylers: [{ visibility: 'off' }] }]});
    setTimeout(() => {
      // TODO extra hacky to set a timeout because the div wasn't ready even though map theoretically loaded.
      const mapToHide = document.querySelector('#minimap')?.firstChild?.children[2]?.firstChild?.firstChild;
      mapToHide.style.display = 'none';
    }, 1000);
  }

  /**
   * Sizes the tutorial minimap to the largest square that fits the sidebar space below the neighborhood heading.
   *
   * The minimap renders at a native square size and is zoomed up uniformly, which keeps the screenshot, Google
   * markers, and fog aligned. We cap that zoom at the available height so the whole rounded square stays visible and
   * the peg stays centered, rather than overflowing the sidebar and getting clipped.
   */
  #sizeTutorialMinimap() {
    const holder = this.#svl.ui.minimap.holder[0];
    const sidebar = document.getElementById('explore-sidebar');
    if (!holder || !sidebar) return;

    const baseSize = parseFloat(getComputedStyle(holder).getPropertyValue('--minimap-base-size'));
    const uiScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;

    // The holder sits just below the heading; its space runs from its top down to the bottom of the sidebar. Its
    // top is anchored at the (unscaled) heading above it, so it's stable regardless of the transform we apply.
    const availableWidth = holder.parentElement.getBoundingClientRect().width;
    const availableHeight = sidebar.getBoundingClientRect().bottom - holder.getBoundingClientRect().top;
    if (availableWidth <= 0 || availableHeight <= 0) return;

    // Stretch horizontally to fill the column's full width, but cap the vertical scale at what fits the available
    // height (less 2px so the bottom corners stay visible). When the space is shorter than it is wide this squishes
    // the minimap a little, which is an acceptable trade for using the full width. The whole holder is scaled, so
    // the screenshot, markers, peg, and fog all stretch together and stay aligned with one another.
    const scaleX = availableWidth / baseSize;
    const scaleY = Math.min(uiScale, (availableHeight - 2) / baseSize);
    holder.style.transform = `scale(${scaleX}, ${scaleY})`;
    holder.style.transformOrigin = 'top left';
  }

  /**
   * Clear the onboarding canvas.
   * @returns {Onboarding}
   */
  clear() {
    if (this.#ctx) this.#ctx.clearRect(0, 0, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT);
    return this;
  }

  /**
   * Draw a label on the onboarding canvas. Draws only static labels as examples in the tutorial.
   * @param labelType {string} Label type that selects the correct icon
   * @param x {number} canvas x-position of the center of the label
   * @param y {number} canvas y-position of the center of the label
   */
  #drawStaticLabel(labelType, x, y) {
    if (this.#ctx) {
      this.#ctx.save();
      Label.renderLabelIcon(this.#ctx, labelType, x, y);
      this.#ctx.restore();
    }
  }

  /**
   * Draw a box on the onboarding canvas.
   * @param x {number} top-left x coordinate
   * @param y {number} top-left y coordinate
   * @param width {number} pixel width
   * @param height {number} pixel height
   * @param parameters {object} parameters
   */
  #drawBox(x, y, width, height, parameters) {
    if (this.#ctx) {
      this.#ctx.save();
      this.#ctx.strokeStyle = parameters.strokeStyle;
      this.#ctx.lineWidth = parameters.lineWidth;
      this.#ctx.strokeRect(x, y, width, height);
      this.#ctx.restore();
    }
    return this;
  }

  /**
   * Draw an arrow on the onboarding canvas.
   * @param x1 {number} Starting x coordinate
   * @param y1 {number} Starting y coordinate
   * @param x2 {number} Ending x coordinate
   * @param y2 {number} Ending y coordinate
   * @param parameters {object} parameters
   * @returns {Onboarding}
   */
  #drawArrow(x1, y1, x2, y2, parameters) {
    const ctx = this.#ctx;
    if (ctx) {
      const lineWidth = parameters.lineWidth;
      const lineCap = parameters.lineCap;
      const arrowWidth = parameters.arrowWidth;
      const strokeStyle = parameters.strokeStyle;
      let fill = parameters.fill;

      if (!parameters.fill) {
        fill = 'rgba(255,255,255,1)';
      }

      const dx = x2 - x1;
      const dy = y2 - y1;
      const theta = Math.atan2(dy, dx);

      ctx.save();
      ctx.fillStyle = fill;
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = lineCap;

      ctx.translate(x1, y1);
      ctx.beginPath();
      ctx.moveTo(arrowWidth * Math.sin(theta), -arrowWidth * Math.cos(theta));
      ctx.lineTo(dx + arrowWidth * Math.sin(theta), dy - arrowWidth * Math.cos(theta));

      // Draw an arrow head
      ctx.lineTo(dx + 3 * arrowWidth * Math.sin(theta), dy - 3 * arrowWidth * Math.cos(theta));
      ctx.lineTo(dx + 3 * arrowWidth * Math.cos(theta), dy + 3 * arrowWidth * Math.sin(theta));
      ctx.lineTo(dx - 3 * arrowWidth * Math.sin(theta), dy + 3 * arrowWidth * Math.cos(theta));

      ctx.lineTo(dx - arrowWidth * Math.sin(theta), dy + arrowWidth * Math.cos(theta));
      ctx.lineTo(-arrowWidth * Math.sin(theta), +arrowWidth * Math.cos(theta));

      ctx.fill();
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    return this;
  }

  #drawBlinkingArrow(x1, y1, x2, y2, parameters, blink_frequency_modifier) {
    const max_frequency = 60 * blink_frequency_modifier;
    const blink_period = 0.5;
    const originalFillColor = parameters.fill;

    const helperBlinkingArrow = () => {
      this.#blinkTimer = (this.#blinkTimer + 1) % max_frequency;
      if (this.#blinkTimer < blink_period * max_frequency) {
        parameters.fill = originalFillColor;
      } else {
        parameters.fill = 'white';
      }
      this.#drawArrow(x1, y1, x2, y2, parameters);

      // requestAnimationFrame usually calls the function argument at the refresh rate of the screen (max_frequency)
      // Assume this is 60fps. We want to have an arrow flashing period of 0.5s (blink period)
      const function_identifier = window.requestAnimationFrame(helperBlinkingArrow);
      this.#blinkFunctionIdentifier.push(function_identifier);
    };
    helperBlinkingArrow();
  }

  #removeFlashingFromArrow() {
    while (this.#blinkFunctionIdentifier.length !== 0) {
      window.cancelAnimationFrame(this.#blinkFunctionIdentifier.pop());
    }
  }

  #stopAllBlinking() {
    this.#svl.minimap.stopBlinkingMinimap();
    this.#compass.stopBlinking();
    this.#zoomControl.stopBlinking();
    this.#panoOverlayControls.stopBlinkingStuckButton();
  }

  #drawAnnotations(state) {
    const svl = this.#svl;
    let imX;
    let imY;
    let lineLength;
    let lineAngle;
    let x1;
    let x2;
    let y1;
    let y2;
    let centeredPov;
    let params;
    let i;
    let len;

    const currentPov = svl.panoViewer.getPov();

    this.clear();

    // Get the full list of annotations, including those from previous states that should remain.
    const currAnnotations = state.annotations
      ? this.#savedAnnotations.concat(state.annotations)
      : this.#savedAnnotations;

    let blink_frequency_modifier = 0;
    for (i = 0, len = currAnnotations.length; i < len; i++) {
      if (currAnnotations[i].type === 'arrow') {
        blink_frequency_modifier = blink_frequency_modifier + 1;
      }
    }

    for (const annotation of currAnnotations) {
      imX = annotation.x;
      imY = annotation.y;
      centeredPov = null;

      // Setting the original POV and mapping an image coordinate to a canvas coordinate.
      if (currentPov.heading < 180) {
        if (imX > svl.TUTORIAL_PANO_WIDTH - 3328 && imX > 3328) {
          imX -= svl.TUTORIAL_PANO_WIDTH;
        }
      } else if (imX < 3328 && imX < svl.TUTORIAL_PANO_WIDTH - 3328) {
        imX += svl.TUTORIAL_PANO_WIDTH;
      }
      centeredPov = util.pano.panoCoordToPov(imX, imY, svl.TUTORIAL_PANO_WIDTH, svl.TUTORIAL_PANO_HEIGHT);
      const canvasCoord = util.pano.centeredPovToCanvasCoord(
        centeredPov, currentPov, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT, svl.LABEL_ICON_RADIUS,
      ) || { x: null, y: null };
      const onCanvas = canvasCoord.x !== null;

      if (annotation.type === 'arrow') {
        if (!onCanvas) continue;
        lineLength = annotation.length;
        lineAngle = annotation.angle;
        x2 = canvasCoord.x;
        y2 = canvasCoord.y;
        x1 = x2 - lineLength * Math.sin(util.math.toRadians(lineAngle));
        y1 = y2 - lineLength * Math.cos(util.math.toRadians(lineAngle));

        // The color of the arrow will by default alternate between white and the fill specified in annotation.
        params = {
          lineWidth: 1,
          fill: annotation.fill,
          lineCap: 'round',
          arrowWidth: 6,
          strokeStyle: 'rgba(0, 0, 0, 1)',
        };

        if (annotation.fill === null || annotation.fill === undefined || annotation.fill === 'white') {
          this.#drawArrow(x1, y1, x2, y2, params);
        } else {
          this.#drawBlinkingArrow(x1, y1, x2, y2, params, blink_frequency_modifier);
        }
      } else if (annotation.type === 'box') {
        if (!onCanvas) continue;
        lineAngle = annotation.angle;
        params = {
          lineWidth: 4,
          strokeStyle: 'rgba(255, 255, 255, 1)',
        };
        this.#drawBox(canvasCoord.x, canvasCoord.y, annotation.width, annotation.height, params);
      } else if (annotation.type === 'label') {
        // Only draw the label icon when it's on-screen; the minimap marker is still created below regardless.
        if (onCanvas) {
          this.#drawStaticLabel(annotation.labelType, canvasCoord.x, canvasCoord.y);
        }
        // The first time we encounter the label, create the marker on the minimap.
        if (!annotation.firstDraw) {
          const googleMarker = Label.createMinimapMarker(
            annotation.labelType, { lat: annotation.lat, lng: annotation.lng },
          );
          googleMarker.map = svl.minimap.getMap();
          annotation.firstDraw = true;
        }
      }
    }

    // Save any annotations that should be sticking around.
    this.#savedAnnotations = currAnnotations.filter((a) => a.keepUntil && a.keepUntil !== state.id);
  }

  #getState(stateId) {
    return this.#states.find((state) => state.id === stateId);
  }

  /**
   * Hide the message box.
   */
  #hideMessage() {
    if (this.#floatingCleanup) {
      this.#floatingCleanup();
      this.#floatingCleanup = null;
    }
    if (this.#uiOnboarding.messageHolder.is(':visible')) this.#uiOnboarding.messageHolder.hide();
  }

  /**
   * Transition to the next state.
   * @param nextState
   * @param params Optional parameters that might be used by transition function.
   */
  next(nextState, params) {
    this.#transitionTo(nextState, params);
  }

  /**
   * Resolve and visit the next state, passing `thisArg` through to a function-valued transition (which reads it as
   * the DOM element the user interacted with).
   * @param nextState State id, or a function returning a state id.
   * @param params Optional parameters that might be used by the transition function.
   * @param [thisArg] The `this` context for a function-valued transition.
   */
  #transitionTo(nextState, params, thisArg) {
    if (typeof nextState === 'function') {
      this.#visit(this.#getState(nextState.call(thisArg, params)));
    } else if (this.#states.find((state) => state.id === nextState)) {
      this.#visit(this.#getState(nextState));
    } else {
      this.#visit(null);
    }
  }

  /**
   * Position the onboarding message box beside a live UI element using Floating UI lib, with an arrow pointing at it.
   * @param {string} anchorSelector CSS selector of the element to point the box at.
   * @param {string} placement Preferred Floating UI placement (e.g. 'left', 'right', 'top', 'bottom').
   */
  #anchorMessageTo(anchorSelector, placement) {
    const reference = document.querySelector(anchorSelector);
    const floating = this.#uiOnboarding.messageHolder.get(0);
    if (!reference || !floating || typeof FloatingUIDOM === 'undefined') return;

    // (Re)create the arrow element Floating UI positions; showMessage's html() call wipes the box's contents.
    let arrowEl = floating.querySelector('.fui-arrow');
    if (!arrowEl) {
      arrowEl = document.createElement('div');
      arrowEl.className = 'fui-arrow';
      floating.appendChild(arrowEl);
    }
    floating.style.position = 'absolute';

    // Recompute on scroll/resize/layout changes so the box keeps tracking the element.
    const update = () => {
      // The arrow is a square rotated 45deg centered on the box edge, so its tip protrudes by half its diagonal.
      // Gap the box from the element by that distance so the tip just reaches the near edge. Re-measured each
      // update since the arrow scales with --ui-scale.
      const arrowHalf = arrowEl.offsetWidth / 2;
      const arrowProtrusion = arrowHalf * Math.SQRT2;
      FloatingUIDOM.computePosition(reference, floating, {
        placement,
        middleware: [
          FloatingUIDOM.offset(arrowProtrusion),
          FloatingUIDOM.flip(),
          FloatingUIDOM.shift({ padding: 8 }),
        ],
      }).then(({ x, y, placement: finalPlacement }) => {
        Object.assign(floating.style, { left: `${x}px`, top: `${y}px`, transform: 'none' });

        // Point the arrow at the center of the element's near edge, computed from live rects so it stays
        // centered even when shift() nudged the box along that axis.
        const side = finalPlacement.split('-')[0];
        const staticSide = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[side];
        const refRect = reference.getBoundingClientRect();
        const floatRect = floating.getBoundingClientRect();
        Object.assign(arrowEl.style, { left: '', top: '', right: '', bottom: '' });
        if (side === 'left' || side === 'right') {
          arrowEl.style.top = `${refRect.top + refRect.height / 2 - floatRect.top - arrowHalf}px`;
        } else {
          arrowEl.style.left = `${refRect.left + refRect.width / 2 - floatRect.left - arrowHalf}px`;
        }
        arrowEl.style[staticSide] = `${-arrowHalf}px`;
      });
    };

    this.#floatingCleanup = FloatingUIDOM.autoUpdate(reference, floating, update);
  }

  /**
   * Show a message box.
   * @param parameters
   */
  #showMessage(parameters) {
    const message = parameters.message;
    // Flash the box yellow once to catch the user's attention.
    this.#uiOnboarding.messageHolder.toggleClass('onboarding-message-flash');
    setTimeout(() => this.#uiOnboarding.messageHolder.toggleClass('onboarding-message-flash'), 100);

    // Tear down anchor positioning from the previous message.
    if (this.#floatingCleanup) {
      this.#floatingCleanup();
      this.#floatingCleanup = null;
    }

    // Reset positioning state so each message starts clean.
    this.#uiOnboarding.messageHolder
      .removeClass('animated fadeIn fadeInLeft fadeInRight fadeInDown fadeInUp callout-floating '
        + 'onboarding-message-takeover onboarding-message-top-right')
      .css({ position: '', top: '', left: '', transform: '', width: '' });
    this.#uiOnboarding.background.css('visibility', 'hidden');

    this.#uiOnboarding.messageHolder.show();

    if ('fade-direction' in parameters) {
      this.#uiOnboarding.messageHolder.addClass(`animated ${parameters['fade-direction']}`);
    }

    // Width is authored in logical (pre-scale) pixels; scale it to on-screen pixels.
    if ('width' in parameters) {
      this.#uiOnboarding.messageHolder.css('width', parameters.width * util.exploreDisplayScale());
    }

    this.#uiOnboarding.messageHolder.html(typeof message === 'function' ? message() : message);

    // Place the message in one of three coordinate-free modes; otherwise it keeps its default top-left corner.
    if (parameters.background) {
      // Full-page intro/outro takeover: dim the viewport and center the panel on it.
      this.#uiOnboarding.background.css('visibility', 'visible');
      this.#uiOnboarding.messageHolder.addClass('onboarding-message-takeover');
    } else if (parameters.anchor) {
      // Anchor to a live UI element; Floating UI computes the position and arrow.
      this.#uiOnboarding.messageHolder.addClass('callout-floating');
      this.#anchorMessageTo(parameters.anchor, parameters.placement || 'right');
    } else if (parameters.position === 'top-right') {
      // Pin to the pano's top-right corner (used when the default top-left would cover the labeled feature).
      this.#uiOnboarding.messageHolder.addClass('onboarding-message-top-right');
    }
  }

  #endTheOnboarding(skip) {
    const svl = this.#svl;
    const mapStyleOptions = [
      {
        featureType: 'all',
        stylers: [
          { visibility: 'off' },
        ],
      },
      {
        featureType: 'road',
        stylers: [
          { visibility: 'on' },
        ],
      },
      {
        elementType: 'labels',
        stylers: [
          { visibility: 'off' },
        ],
      },
    ];
    if (this.#map) this.#map.setOptions({ styles: mapStyleOptions });
    this.#map.setOptions({ styles: mapStyleOptions });
    if (skip) {
      this.#tracker.push('Onboarding_Skip');
      this.#missionContainer.getCurrentMission().setProperty('skipped', true);
    }
    this.#tracker.push('Onboarding_End');
    this.#missionContainer.getCurrentMission().setProperty('isComplete', true);

    // Makes sure all data has been submitted to server, then refreshes the page.
    svl.form.submitData().then(() => {
      window.location.replace('/explore');
    });
  }

  #onboardingStateAnnotationExists(state) {
    return 'annotations' in state && state.annotations;
  }

  #onboardingStateMessageExists(state) {
    return 'message' in state && state.message;
  }

  #blinkInterface(state) {
    const svl = this.#svl;
    // Blink parts of the interface.
    if ('blinks' in state.properties && state.properties.blinks) {
      const len = state.properties.blinks.length;
      for (let i = 0; i < len; i++) {
        switch (state.properties.blinks[i]) {
          case 'minimap':
            svl.minimap.blinkMinimap();
            break;
          case 'compass':
            this.#compass.blink();
            break;
          case 'stuck':
            this.#panoOverlayControls.blinkStuckButton();
            break;
          case 'movement-arrow':
            svl.panoManager.blinkNavigationArrows();
            break;
        }
      }
    }
  }

  /**
   * Execute an instruction based on the current state.
   * @param state
   */
  #visit(state) {
    const svl = this.#svl;
    // Update the progress bar (if the state marks progress in the tutorial) & log the transition to the new state.
    const stepNum = this.#statesWithProgress.findIndex((s) => s.id === state.id);
    if (stepNum !== -1 && !state.visited) {
      const completionRate = stepNum / this.#statesWithProgress.length;
      svl.missionProgressBar.update(completionRate);
      this.#tracker.push('Onboarding_Transition', { onboardingTransition: state.id, step: stepNum });
    } else {
      this.#tracker.push('Onboarding_Transition', { onboardingTransition: state.id });
    }
    state.visited = true;

    let annotationListener;

    this.clear(); // Clear whatever was rendered on the onboarding-canvas in the previous state.
    this.#removeFlashingFromArrow();

    // End the onboarding if there is no transition state is specified. Move to the actual task
    if ('end-onboarding' in state) {
      this.#endTheOnboarding(state['end-onboarding'].skip);
      return;
    } else {
      this.#hideMessage();
    }

    // Show user a message box.
    if (this.#onboardingStateMessageExists(state)) {
      this.#showMessage(state.message);
    }

    // Draw arrows to annotate target accessibility attributes
    if (this.#onboardingStateAnnotationExists(state) || this.#savedAnnotations.length > 0) {
      this.#drawAnnotations(state);
      annotationListener = google.maps.event.addListener(svl.panoViewer.gsvPano, 'pov_changed', () => {
        // Stop the animation for the blinking arrows.
        this.#removeFlashingFromArrow();
        this.#drawAnnotations(state);
      });
    }

    // Change behavior based on the current state.
    if ('properties' in state) {
      // Remove blinking if necessary.
      if (state.properties.stopBlinking) {
        this.#stopAllBlinking();
      }

      if (state.properties.constructor === Array) {
        // Restrict panning.
        svl.panoManager.setHeadingRange({ min: state.properties[0].minHeading, max: state.properties[0].maxHeading });

        // Ideally we need a for loop that goes through every element of the property array and calls the
        // corresponding action's handler. Not just the label accessibility attribute's handler.
        if (state.properties[0].action === 'LabelAccessibilityAttribute') {
          this.#visitLabelAccessibilityAttributeState(state, annotationListener);
        }
      } else {
        // Restrict panning.
        svl.panoManager.setHeadingRange({ min: state.properties.minHeading, max: state.properties.maxHeading });
        if (state.properties.action === 'Introduction') {
          this.#visitIntroduction(state, annotationListener);
        } else if (state.properties.action === 'SelectLabelType' || state.properties.action === 'RedoSelectLabelType') {
          this.#visitSelectLabelTypeState(state, annotationListener);
        } else if (state.properties.action === 'DeleteAccessibilityAttribute') {
          this.#visitDeleteAccessibilityAttributeState(state, annotationListener);
          this.#contextMenu.hide();
        } else if (state.properties.action === 'Zoom') {
          this.#visitZoomState(state, annotationListener);
        } else if (state.properties.action === 'RateSeverity' || state.properties.action === 'RedoRateSeverity') {
          this.#visitRateSeverity(state, annotationListener);
        } else if (state.properties.action === 'AddTag' || state.properties.action === 'RedoAddTag') {
          this.#visitAddTag(state, annotationListener);
        } else if (state.properties.action === 'AdjustHeadingAngle') {
          this.#visitAdjustHeadingAngle(state, annotationListener);
        } else if (state.properties.action === 'WalkTowards') {
          this.#visitWalkTowards(state, annotationListener);
        } else if (state.properties.action === 'Instruction') {
          this.#visitInstruction(state, annotationListener);
        }
      }
    }
  }

  /**
   * Position the pano at the tutorial's opening POV, then advance to the first interactive step.
   *
   * The welcome/skip UI lives in the pre-tutorial intro (TutorialIntro), whose "Start Mission" button leads here, so
   * this state is non-interactive: it just sets the POV and moves on.
   *
   * @param state    The 'initialize' state from OnboardingStates.js.
   * @param listener An optional Google Maps event listener to remove before advancing.
   */
  #visitIntroduction(state, listener) {
    if (listener) google.maps.event.removeListener(listener);
    this.#svl.panoManager.setPov({
      heading: state.properties.heading,
      pitch: state.properties.pitch,
      zoom: state.properties.zoom,
    });
    this.#transitionTo(state.transition);
  }

  /**
   * Called when the user is told to click on the compass or nav arrows to move to the next image.
   * @param state The current state defined in OnboardingStates.js
   * @param listener An optional listener on a Google Maps event, to be removed before moving to the next state
   */
  #visitWalkTowards(state, listener) {
    const svl = this.#svl;
    const nextPanoId = 'afterWalkTutorial';

    // Add a link to the second pano so that the user can click on it.
    svl.panoManager.unlockShowingNavArrows();
    svl.panoManager.showNavArrows();

    // A callback to disable walking after user has moved to 2nd pano, then moves to next state.
    const callback = () => {
      this.#navigationService.unlockDisableWalking().disableWalking().lockDisableWalking();
      this.#compass.detachMessageClickHandler(clickToNextPano);
      svl.panoManager.lockShowingNavArrows();
      svl.ui.streetview.navArrows.off('click', callback);
      if (listener) google.maps.event.removeListener(listener);
      this.#transitionTo(state.transition);
    };

    // Replace default behavior when clicking on the navigation message/arrows to move to the next pano.
    const clickToNextPano = () => {
      this.#navigationService.moveToPano(nextPanoId, true).then(callback);
    };

    this.#navigationService.unlockDisableWalking().enableWalking().lockDisableWalking();
    svl.ui.streetview.navArrows.off('click').on('click', clickToNextPano);
    this.#compass.attachMessageClickHandler(clickToNextPano);

    this.#blinkInterface(state);
  }

  #visitAdjustHeadingAngle(state, listener) {
    const svl = this.#svl;
    let $target;
    const interval = this.#handAnimation.showGrabAndDragAnimation({ direction: 'left-to-right' });

    const callback = () => {
      const pov = svl.panoViewer.getPov();
      // Note that the tolerance is only a tolerance to the left. Must hit at least the given heading to proceed.
      if ((360 + state.properties.heading - pov.heading) % 360 < state.properties.tolerance) {
        google.maps.event.removeListener($target);
        if (listener) google.maps.event.removeListener(listener);
        this.#handAnimation.hideGrabAndDragAnimation(interval);
        this.#transitionTo(state.transition);
      }
    };

    $target = google.maps.event.addListener(svl.panoViewer.gsvPano, 'pov_changed', callback);
  }

  #visitRateSeverity(state, listener) {
    this.#contextMenu.enableRatingSeverityForTutorialLabel(state.properties.labelNumber);
    const $target = this.#svl.ui.contextMenu.radioButtons;
    const callback = (e) => {
      if (listener) google.maps.event.removeListener(listener);
      $target.off('change', callback);
      this.#contextMenu.disableRatingSeverity();
      this.#transitionTo(state.transition, undefined, e.currentTarget);
    };
    $target.on('change', callback);
  }

  #visitAddTag(state, listener) {
    this.#contextMenu.enableTaggingForTutorialLabel(state.properties.labelNumber);
    const $target = this.#svl.ui.contextMenu.tagHolder; // Grab tag holder so we can add an event listener.
    const callback = () => {
      if (listener) google.maps.event.removeListener(listener);
      $target.off('tagIds-updated', callback);
      this.#contextMenu.disableTagging();
      this.#transitionTo(state.transition, undefined, this.#contextMenu.getTargetLabel());
    };
    // We use a custom event here to ensure that this is triggered after the tags have been updated.
    $target.on('tagIds-updated', callback);
  }

  #visitInstruction(state, listener) {
    const svl = this.#svl;
    if (state === this.#getState('outro')) {
      // Remove the hover listeners that adjust the instruction box's z-index.
      svl.ui.contextMenu.holder.off('mouseover mouseout');
    }
    this.#blinkInterface(state);

    if (!('okButton' in state) || state.okButton) {
      // Insert an ok button.
      const okButtonText = state.okButtonText || 'Ok';
      this.#uiOnboarding.messageHolder.append(
        `<div class='onboarding-ok-button-holder'>`
        + `<button id='onboarding-ok-button' class='button-ps button--medium button--secondary'>`
        + `${okButtonText}</button>`
        + `</div>`,
      );
    }

    const $target = $('#onboarding-ok-button');
    const callback = (e) => {
      if (listener) google.maps.event.removeListener(listener);
      $target.off('click', callback);
      if ('blinks' in state.properties && state.properties.blinks) {
        this.#stopAllBlinking();
      }
      this.#transitionTo(state.transition, undefined, e.currentTarget);
    };
    $target.on('click', callback);
  }

  /**
   * Blink the given label type and nudge them to click one of the buttons in the ribbon menu.
   * Move on to the next state if they click the button.
   * @param state
   * @param listener
   */
  #visitSelectLabelTypeState(state, listener) {
    const labelType = state.properties.labelType;

    this.#ribbon.enableMode(labelType);
    this.#ribbon.startBlinking(labelType);

    // To handle when user presses ESC - disable mode only when the user places the label.
    this.#mouseDownCanvasDrawingHandler = () => {
      this.#ribbon.disableMode(labelType);
    };

    const callback = () => {
      this.#ribbon.enableMode('Walk');

      // Disable only when the user places the label
      this.#uiCanvas.drawingLayer.on('mousedown', this.#mouseDownCanvasDrawingHandler);

      this.#ribbon.stopBlinking();
      $(document).off(`ModeSwitch_${labelType}`, callback);
      if (listener) google.maps.event.removeListener(listener);
      this.#transitionTo(state.transition);
    };

    $(document).on(`ModeSwitch_${labelType}`, callback);
  }

  /**
   * Tell the user to zoom in/out.
   * @param state
   * @param listener
   */
  #visitZoomState(state, listener) {
    const zoomType = state.properties.type;
    let event;

    if (zoomType === 'in') {
      event = 'ZoomIn';
      this.#zoomControl.blinkZoomIn();
      this.#zoomControl.unlockDisableZoomIn();
      this.#zoomControl.enableZoomIn();
      this.#zoomControl.lockDisableZoomIn();
    } else {
      event = 'ZoomOut';
      this.#zoomControl.blinkZoomOut();

      // Enable zoom-out
      this.#zoomControl.unlockDisableZoomOut();
      this.#zoomControl.enableZoomOut();
      this.#zoomControl.lockDisableZoomOut();
    }

    const callback = () => {
      this.#zoomControl.stopBlinking();
      if (zoomType === 'in') {
        // Disable zoom-in
        this.#zoomControl.unlockDisableZoomIn();
        this.#zoomControl.disableZoomIn();
        this.#zoomControl.lockDisableZoomIn();
      } else {
        // Disable zoom-out
        this.#zoomControl.unlockDisableZoomOut();
        this.#zoomControl.disableZoomOut();
        this.#zoomControl.lockDisableZoomOut();
      }
      this.#ribbon.enableMode('Walk');
      $(document).off(event, callback);

      if (listener) google.maps.event.removeListener(listener);
      this.#transitionTo(state.transition);
    };

    $(document).on(event, callback);
  }

  /**
   * Tell the user to label the multiple possible target attributes.
   * @param state
   * @param listener
   */
  #visitLabelAccessibilityAttributeState(state, listener) {
    const svl = this.#svl;
    const properties = state.properties[0];
    const transition = state.transition;

    // Add an event that fires when a label is added and checks if the label was placed in the right spot.
    const _tutorialLabelListener = (event) => {
      if (listener) google.maps.event.removeListener(listener);

      const label = event.detail.label;
      const panoX = label.getProperty('panoXY').x * svl.TUTORIAL_PANO_SCALE_FACTOR;
      const panoY = label.getProperty('panoXY').y * svl.TUTORIAL_PANO_SCALE_FACTOR;
      const imageX = properties.imageX;
      const imageY = properties.imageY;
      const tolerance = properties.tolerance;

      const distance = (imageX - panoX) * (imageX - panoX) + (imageY - panoY) * (imageY - panoY);

      // If the label was placed close enough to the target, move on to the next state.
      if (distance < tolerance * tolerance) {
        label.setProperty('tutorialLabelNumber', properties.labelNumber);

        // Disable deleting of label.
        this.#canvas.unlockDisableLabelDelete();
        this.#canvas.disableLabelDelete();
        this.#canvas.lockDisableLabelDelete();

        // Disable labeling mode.
        this.#ribbon.disableMode(label.getLabelType());
        this.#ribbon.enableMode('Walk');
        this.#uiCanvas.drawingLayer.off('mousedown', this.#mouseDownCanvasDrawingHandler);

        this.#transitionTo(transition[0], { accurate: true });
      } else {
        this.#transitionTo(transition[0], { accurate: false });
      }
    };
    document.addEventListener('addTutorialLabel', _tutorialLabelListener, { once: true });
  }

  /**
   * Tell the user to delete the label they placed that is far away from where they were supposed to place it.
   *
   * @param state
   * @param listener
   */
  #visitDeleteAccessibilityAttributeState(state, listener) {
    this.#ribbon.disableMode(state.properties.labelType);
    this.#ribbon.enableMode('Walk');
    this.#canvas.unlockDisableLabelDelete();
    this.#canvas.enableLabelDelete();
    this.#canvas.lockDisableLabelDelete();

    // Callback for deleted label.
    const deleteLabelCallback = () => {
      if (listener) google.maps.event.removeListener(listener);
      $(document).off('RemoveLabel', deleteLabelCallback);
      this.clear();
      this.#removeFlashingFromArrow(); // TODO remove this if it turns out that we don't need it.
      this.#transitionTo(state.transition);
    };
    $(document).on('RemoveLabel', deleteLabelCallback);
  }

  /**
   * Reset the id of the label that the user most recently added.
   *
   * @param labelId
   */
  setCurrentLabelId(labelId) {
    this.#currentLabelId = labelId;
  }

  /**
   * Return the id of the label that the user most recently added.
   */
  getCurrentLabelId() {
    return this.#currentLabelId;
  }
}
