/**
 * A Keyboard module.
 */
class KeyboardManager {
  #svl;
  #contextMenu;
  #navigationService;
  #ribbon;
  #zoomControl;

  /**
     * fix for the shift-getting-stuck bug.
     * this is a documented issue, see here:
     * https://stackoverflow.com/questions/11225694/why-are-onkeyup-events-not-firing-in-javascript-game
     * essentially what's going on is that JS sometimes fires a final keydown after a keyup.
     * (usually happens when multiple events are fired)
     * so the log would look like keydown:shift, keydown: shift, keyup: shift, keydown: shift.
     * To fix this, we note the last time that shift was let go, then
     * ignore any keydown events that were made BEFORE shift was let go, but are executing AFTER.
     *
     * also, we added a buffer to the z key to fix inconsistent behavior when shift and z were pressed at the same time.
     * sometimes, the shift up was detected before the z up. Adding the 100ms buffer fixed this issue.
     */
  #status = {
    focusOnTextField: false,
    isOnboarding: false,
    disableKeyboard: false,
  };

  constructor(svl, canvas, contextMenu, navigationService, ribbon, zoomControl) {
    this.#svl = svl;
    this.#contextMenu = contextMenu;
    this.#navigationService = navigationService;
    this.#ribbon = ribbon;
    this.#zoomControl = zoomControl;

    // Add the keyboard event listeners. We need { capture: true } for keydown to overwrite pano's shortcuts.
    window.addEventListener('keydown', this.#documentKeyDown, { capture: true });
    window.addEventListener('keyup', this.#documentKeyUp);
  }

  disableKeyboard() {
    this.#status.disableKeyboard = true;
  }

  enableKeyboard() {
    this.#status.disableKeyboard = false;
  }

  /**
     * Change the heading of the current panorama point of view by a particular degree value.
     *
     * @param degree
     */
  #rotatePovByDegree(degree) {
    const svl = this.#svl;
    if (!svl.panoManager.getStatus('disablePanning')) {
      svl.contextMenu.hide();
      // Panning hide label tag and delete icon.
      const labels = svl.labelContainer.getCanvasLabels();
      const labelLen = labels.length;
      for (let i = 0; i < labelLen; i++) {
        labels[i].setHoverInfoVisibility('hidden');
      }
      svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
      const pitch = svl.panoViewer.getPov().pitch;
      const zoom = svl.panoViewer.getPov().zoom;
      const heading = (svl.panoViewer.getPov().heading + degree + 360) % 360;
      svl.panoManager.setPov({ heading, pitch, zoom });
    }
  }

  /**
     * Advance one step forward along the user's assigned route, keeping their current POV (heading/pitch/zoom).
     *
     * First tries to step to the GSV-linked pano in the route direction (not just wherever the camera happens to
     * face); if there's no such link — e.g. GSV shows no navigation arrow that way — falls back to the route-aware
     * moveForward() engine that probes along the assigned street geometry for the next available imagery. This is
     * the spacebar shortcut for the "routed where there's no forward arrow" case from #619/#1041.
     */
  async #advanceForwardAlongRoute() {
    const svl = this.#svl;
    // No-op while walking is disabled (e.g. mid-load), matching the arrow keys — otherwise moveToLinkedPano()
    // resolves false and we'd both fall through to a no-op moveForward() and log a move that never happened.
    if (this.#navigationService.getStatus('disableWalking')) return;

    try {
      // Bias the forward step toward the route direction rather than wherever the camera is currently pointed.
      // moveToLinkedPano() takes a heading offset relative to the current heading, so subtract the current one.
      const routeHeading = svl.compass.getTargetAngle();
      const currHeading = svl.panoViewer.getPov().heading;
      const moved = await this.#navigationService.moveToLinkedPano(routeHeading - currHeading);
      if (!moved) {
        await this.#navigationService.moveForward();
      }
      svl.tracker.push('KeyboardShortcut_MoveForwardAlongRoute', { usedRoute: !moved });
    } catch (e) {
      // Keep a failed forward step from surfacing as an unhandled promise rejection out of a key event.
      console.error('Spacebar route-advance failed:', e);
    }
  }

  /**
     * This is a callback for a key down event
     * @param {object} e An event object
     */
  #documentKeyDown = (e) => {
    if (!this.#status.disableKeyboard && !this.#status.focusOnTextField) {
      // Shortcuts that only apply when the context menu is closed (moving/panning).
      if (!this.#contextMenu.isOpen()) {
        switch (e.key) {
          case 'ArrowLeft':
            this.#rotatePovByDegree(-2);
            break;
          case 'ArrowRight':
            this.#rotatePovByDegree(2);
            break;
          case 'ArrowUp':
            this.#navigationService.moveToLinkedPano(0);
            break;
          case 'ArrowDown':
            this.#navigationService.moveToLinkedPano(180);
            break;
          case ' ':
            // preventDefault stops the page from scrolling and stops space from re-activating a
            // focused button (e.g. the Stuck/ribbon button right after a mouse click).
            e.preventDefault();
            this.#advanceForwardAlongRoute();
            break;
        }
      }
    }
  };

  /**
     * This is a callback for a key up event when focus is not on ContextMenu's textbox.
     * @param {object} e An event object
     */
  #documentKeyUp = (e) => {
    const svl = this.#svl;
    // Ways to close context menu. Separated from later code because we want these to work in description textbox.
    if (!this.#status.disableKeyboard && this.#contextMenu.isOpen()) {
      switch (e.key) {
        case 'Enter':
          svl.tracker.push('KeyboardShortcut_CloseContextMenu');
          this.#contextMenu.handleSeverityPopup();
          svl.tracker.push('ContextMenu_ClosePressEnter');
          this.#contextMenu.hide();
          break;
        case 'Escape':
          this.#closeContextMenu(e.keyCode);
          this.#ribbon.backToWalk();
          break;
      }
    }

    if (!this.#status.disableKeyboard && !this.#status.focusOnTextField && !e.ctrlKey) {
      // Switch labeling mode. e: Walk, c: CurbRamp, m: NoCurbRamp, o: Obstacle, s: SurfaceProblem: n: NoSidewalk,
      // w: Crosswalk, p: Signal, b: Occlusion.
      for (const mode of ['Walk'].concat(util.misc.VALID_LABEL_TYPES_WITHOUT_OTHER)) {
        if (e.key.toUpperCase() === util.misc.getLabelDescriptions(mode).keyChar) {
          if (mode !== 'Walk') this.#closeContextMenu(e.keyCode);
          this.#ribbon.modeSwitch(mode);
          svl.tracker.push(`KeyboardShortcut_ModeSwitch_${mode}`, { keyCode: e.keyCode });
        }
      }

      // Escape exits Labeling Mode back to Explore Mode (context menu open case is handled above).
      if (e.key === 'Escape' && !this.#contextMenu.isOpen()) {
        this.#ribbon.backToWalk();
        svl.tracker.push('KeyboardShortcut_ModeSwitch_Walk', { keyCode: e.keyCode });
      }

      // Zooming in/out.
      if (e.code === 'KeyZ') {
        // Close the context menu whenever we zoom.
        if (this.#contextMenu.isOpen()) {
          svl.tracker.push('KeyboardShortcut_CloseContextMenu');
          this.#contextMenu.hide();
        }

        // Zoom in or out depending on whether shift is down.
        if (e.shiftKey) {
          this.#zoomControl.zoomOut();
          svl.tracker.push('KeyboardShortcut_ZoomOut', { keyCode: e.keyCode });
        } else {
          this.#zoomControl.zoomIn();
          svl.tracker.push('KeyboardShortcut_ZoomIn', { keyCode: e.keyCode });
        }
      }

      // Shortcuts that only apply when the context menu is open (like rating severity and adding/removing tags).
      if (this.#contextMenu.isOpen()) {
        const targetLabel = this.#contextMenu.getTargetLabel();

        // Rating severity. Can use either number keys or numpad keys.
        if (['1', '2', '3'].includes(e.key) && targetLabel && !this.#contextMenu.isRatingSeverityDisabled()) {
          const severity = Number(e.key); // '1' - '3'
          this.#contextMenu.checkRadioButton(severity);
          targetLabel.setProperty('severity', severity);
          svl.tracker.push(`KeyboardShortcut_Severity_${severity}`, { keyCode: e.keyCode });
          svl.canvas.clear().render();
        }

        // Adding/removing tags.
        if (targetLabel && !this.#contextMenu.isTaggingDisabled()) {
          const labelType = targetLabel.getProperty('labelType');
          const tags = this.#contextMenu.labelTags.filter((tag) => tag.label_type === labelType);
          for (const tag of tags) {
            if (e.key.toUpperCase() === util.misc.getLabelDescriptions(labelType).tagInfo[tag.tag].keyChar) {
              $(`.tag-id-${tag.tag_id}`).first().trigger('click', { lowLevelLogging: false });
            }
          }
        }
      }
    }
  };

  #closeContextMenu(key) {
    if (this.#contextMenu.isOpen()) {
      this.#svl.tracker.push('KeyboardShortcut_CloseContextMenu');
      this.#svl.tracker.push('ContextMenu_CloseKeyboardShortcut', {
        keyCode: key,
      });
      this.#contextMenu.hide();
    }
  }

  /**
     * Get status
     * @param {string} key Field name
     * @returns {*}
     */
  getStatus(key) {
    if (!(key in this.#status)) {
      console.warn('You have passed an invalid key for status.');
    }
    return this.#status[key];
  }

  /**
     * Set status
     * @param key Field name
     * @param value Field value
     */
  setStatus(key, value) {
    if (key in this.#status) {
      this.#status[key] = value;
    }
  }
}
