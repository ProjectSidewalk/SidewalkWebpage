/**
 * Compass module. Shows the user which way to turn/move to follow the assigned route.
 *
 * @memberof svl
 */
class Compass {
  #navigationService;
  #taskContainer;
  #blinkInterval;
  #blinkTimer;
  #uiCompass;
  #imageDirectories;
  #status = {
    lockDisableCompassClick: false,
  };

  /**
   * @param {Object} svl - SVL namespace (used for imageDirectory). Same object as the global `svl`.
   * @param {Object} navigationService - NavigationService module.
   * @param {Object} taskContainer - TaskContainer module.
   */
  constructor(svl, navigationService, taskContainer) {
    this.#navigationService = navigationService;
    this.#taskContainer = taskContainer;

    this.#uiCompass = {
      messageHolder: $('#compass-message-holder'),
      message: $('#compass-message'),
    };

    this.#imageDirectories = {
      leftTurn: `${svl.imageDirectory}icons/ArrowLeftTurn.png`,
      rightTurn: `${svl.imageDirectory}icons/ArrowRightTurn.png`,
      slightLeft: `${svl.imageDirectory}icons/ArrowSlightLeft.png`,
      slightRight: `${svl.imageDirectory}icons/ArrowSlightRight.png`,
      straight: `${svl.imageDirectory}icons/ArrowStraight.png`,
      uTurn: `${svl.imageDirectory}icons/ArrowUTurn.png`,
    };

    this.enableCompassClick();
  }

  /**
   * Blink the compass message.
   */
  blink() {
    this.stopBlinking();
    this.#blinkInterval = window.setInterval(() => {
      this.#uiCompass.messageHolder.toggleClass('highlight-100');
    }, 500);
  }

  getCompassMessageHolder() {
    return this.#uiCompass;
  }

  /**
   * Get the angle necessary to move further down the street (using 15 meters further along street as target point).
   * @returns {number}
   */
  getTargetAngle() {
    const task = this.#taskContainer.getCurrentTask();
    const geometry = task.getFeature();
    const latlng = svl.panoViewer.getPosition();
    const startLatLng = turf.point(task.getFurthestPointReached().geometry.coordinates);
    const streetEnd = turf.point([task.getEndCoordinate().lng, task.getEndCoordinate().lat]);
    const remainder = turf.cleanCoords(turf.lineSlice(startLatLng, streetEnd, geometry));

    // Get the point representing 15 meters further along the street (or the endpoint if there's fewer than 15m).
    const distIncrement = Math.min(0.015, turf.length(remainder));
    const goalLoc = turf.along(remainder, distIncrement).geometry.coordinates;

    // Compute the angle from the current location to the goal location, with respect to true north.
    return ((util.math.toDegrees(Math.atan2(goalLoc[0] - latlng.lng, goalLoc[1] - latlng.lat)) + 360) % 360);
  }

  /**
   * Check if the user is following the route that we specified.
   * @returns {boolean}
   */
  #checkEnRoute() {
    const task = this.#taskContainer.getCurrentTask();
    if (task) {
      const line = task.getGeoJSON();
      const latlng = svl.panoViewer.getPosition();
      const currentPoint = turf.point([latlng.lng, latlng.lat]);
      return turf.pointToLineDistance(currentPoint, line) < svl.CLOSE_TO_ROUTE_THRESHOLD;
    }
    return true;
  }

  enableCompassClick() {
    if (!this.#status.lockDisableCompassClick) {
      this.#uiCompass.messageHolder.off('click', this.#handleCompassClick).on('click', this.#handleCompassClick);
      this.#uiCompass.messageHolder.css('cursor', 'pointer');
    }
  }

  disableCompassClick() {
    if (!this.#status.lockDisableCompassClick) {
      this.#uiCompass.messageHolder.off('click', this.#handleCompassClick);
      this.#uiCompass.messageHolder.css('cursor', 'default');
    }
  }

  lockDisableCompassClick() {
    this.#status.lockDisableCompassClick = true;
  }

  unlockDisableCompassClick() {
    this.#status.lockDisableCompassClick = false;
  }

  /*
   * Part of the new jump mechanism.
   */
  //  ** start **

  #cancelTimer() {
    window.clearTimeout(this.#blinkTimer);
  }

  resetBeforeJump() {
    this.#cancelTimer();
    this.removeLabelBeforeJumpMessage();
  }

  // Arrow field so the reference stays stable for jQuery .off()/.on() matching in the message-box handlers.
  #jumpToTheNewTask = async () => {
    svl.tracker.push('LabelBeforeJump_Jump');
    await this.#navigationService.jumpToANewTask();
  };

  #makeTheLabelBeforeJumpMessageBoxClickable() {
    let jumpMessageOnclick;
    if (svl.neighborhoodModel.isRouteOrNeighborhoodComplete()) {
      jumpMessageOnclick = () => {
        svl.missionController.wrapUpRouteOrNeighborhood();
      };
    } else {
      jumpMessageOnclick = this.#jumpToTheNewTask;
    }
    this.#uiCompass.messageHolder.off('click', this.#jumpToTheNewTask).on('click', jumpMessageOnclick);
    this.#uiCompass.messageHolder.css('cursor', 'pointer');
  }

  #makeTheLabelBeforeJumpMessageBoxUnclickable() {
    this.#uiCompass.messageHolder.off('click', this.#jumpToTheNewTask);
    this.#uiCompass.messageHolder.css('cursor', 'default');
  }

  showLabelBeforeJumpMessage() {
    // Start blinking after 15 seconds.
    this.#blinkTimer = window.setTimeout(() => {
      svl.tracker.push('LabelBeforeJump_Blink');
      this.blink();
    }, 15000);
    this.disableCompassClick();
    this.#makeTheLabelBeforeJumpMessageBoxClickable();
    this.#setLabelBeforeJumpMessage();
  }

  removeLabelBeforeJumpMessage() {
    this.stopBlinking();
    this.#makeTheLabelBeforeJumpMessageBoxUnclickable();
    this.enableCompassClick();
  }
  // ** end **

  /**
   * Get the compass angle.
   * @returns {number} Degrees the user needs to rotate to face the correct direction, normalized [0,360].
   */
  #getCompassAngle() {
    const heading = ((svl.panoViewer.getPov().heading % 360) + 360) % 360;
    const targetAngle = this.getTargetAngle();
    return ((heading - targetAngle + 360) % 360);
  }

  /**
   * Mapping from a direction to an image path of direction icons.
   * @param {string} direction
   * @returns {string|undefined}
   */
  directionToImagePath(direction) {
    switch (direction) {
      case 'straight':
        return this.#imageDirectories.straight;
      case 'slight-right':
        return this.#imageDirectories.slightRight;
      case 'slight-left':
        return this.#imageDirectories.slightLeft;
      case 'right':
        return this.#imageDirectories.rightTurn;
      case 'left':
        return this.#imageDirectories.leftTurn;
      case 'u-turn':
        return this.#imageDirectories.uTurn;
      default:
    }
  }

  /**
   * Hide a message.
   */
  hideMessage() {
    this.#uiCompass.messageHolder.removeClass('fadeInUp').addClass('fadeOutDown');
    this.#uiCompass.messageHolder.css('pointer-events', 'none');
  }

  /**
   * Set the compass message.
   */
  setTurnMessage() {
    const angle = this.#getCompassAngle();
    const direction = this.#angleToDirection(angle);

    const image = `<img src="${this.directionToImagePath(direction)}" class="compass-turn-images" alt="Turn icon"/>`;
    const message
            = `<div class="compass-message-small">${i18next.t('center-ui.compass.unlabeled-problems')}</div>`
              + `${image}<span class="compass-message-large">${this.#directionToDirectionMessage(direction)}</span>`;
    this.#uiCompass.message.html(message);
  }

  #setLabelBeforeJumpMessage() {
    if (svl.neighborhoodModel.isRouteComplete) {
      this.#uiCompass.message.html(`<div style="width: 20%">${i18next.t('center-ui.compass.end-route')}</div>`);
    } else if (svl.neighborhoodModel.isNeighborhoodComplete) {
      this.#uiCompass.message.html(`<div style="width: 20%">${i18next.t('center-ui.compass.end-neighborhood')}</div>`);
    } else {
      this.#uiCompass.message.html(`<div style="width: 20%">${i18next.t('center-ui.compass.end-street')}</div>`);
    }
  }

  #setBackToRouteMessage() {
    this.#uiCompass.message.html(i18next.t('center-ui.compass.far-away'));
  }

  /**
   * Show a message.
   */
  showMessage() {
    this.#uiCompass.messageHolder.removeClass('fadeOutDown').addClass('fadeInUp');
    this.#uiCompass.messageHolder.css('pointer-events', 'auto');
  }

  /**
   * Stop blinking the compass message.
   */
  stopBlinking() {
    window.clearInterval(this.#blinkInterval);
    this.#blinkInterval = null;
    this.#uiCompass.messageHolder.removeClass('highlight-100');
  }

  /**
   * Update the compass message.
   */
  update() {
    if (!this.#navigationService.getLabelBeforeJumpState() && !svl.isOnboarding()) {
      if (this.#checkEnRoute()) {
        this.stopBlinking();
        this.setTurnMessage();
      } else if (!this.#navigationService.getStatus('movingToNewLocation')) {
        // Only warn that the user is off-route if they're not mid-move. (#4174)
        this.blink();
        this.#setBackToRouteMessage();
      }
    }
  }

  /**
   * Mapping from an angle to a direction.
   * @param {number} angle
   * @returns {string|undefined}
   */
  #angleToDirection(angle) {
    if (angle < 20 || angle > 340) {
      return 'straight';
    } else if (angle >= 20 && angle < 45) {
      return 'slight-left';
    } else if (angle <= 340 && angle > 315) {
      return 'slight-right';
    } else if (angle >= 45 && angle < 150) {
      return 'left';
    } else if (angle <= 315 && angle > 210) {
      return 'right';
    } else if (angle <= 210 && angle >= 150) {
      return 'u-turn';
    } else {
      console.debug('It shouldn\'t reach here.');
    }
  }

  /**
   * Mapping from direction to a description of the direction.
   * @param {string} direction
   * @returns {string|undefined}
   */
  #directionToDirectionMessage(direction) {
    switch (direction) {
      case 'straight':
        return i18next.t('center-ui.compass.straight');
      case 'slight-right':
        return i18next.t('center-ui.compass.slight-right');
      case 'slight-left':
        return i18next.t('center-ui.compass.slight-left');
      case 'right':
        return i18next.t('center-ui.compass.right');
      case 'left':
        return i18next.t('center-ui.compass.left');
      case 'u-turn':
        return i18next.t('center-ui.compass.u-turn');
      default:
    }
  }

  // Performs the action written in the compass message for the user (turning, moving ahead, jumping).
  // Arrow field so the reference stays stable for jQuery .off()/.on() matching in enable/disableCompassClick.
  #handleCompassClick = async () => {
    if (this.#checkEnRoute()) {
      svl.stuckAlert.compassOrStuckClicked();

      const angle = this.#getCompassAngle();
      const direction = this.#angleToDirection(angle);
      svl.tracker.push(`Click_Compass_Direction=${direction}`);

      if (direction === 'straight') {
        await this.#navigationService.moveForward()
          .then(() => svl.tracker.push('CompassMove_Success'))
          .catch(() => svl.tracker.push('CompassMove_PanoNotAvailable'));
      } else {
        svl.panoManager.setPovToRouteDirection(250);
      }
    } else {
      svl.tracker.push('Click_Compass_FarFromRoute');
      await this.#navigationService.moveForward();
      svl.panoManager.setPovToRouteDirection();
    }
  };

  /**
   * Attaches an external click handler to the compass message and shows the pointer cursor. Onboarding uses this to
   * override the default compass behavior so that a click advances to the next pano.
   * @param {Function} handler
   */
  attachMessageClickHandler(handler) {
    this.#uiCompass.messageHolder.off('click', handler).on('click', handler);
    this.#uiCompass.messageHolder.css('cursor', 'pointer');
  }

  /**
   * Detaches an attached external click handler from the compass message and restores the default cursor.
   * @param {Function} handler
   */
  detachMessageClickHandler(handler) {
    this.#uiCompass.messageHolder.off('click', handler);
    this.#uiCompass.messageHolder.css('cursor', 'default');
  }
}
