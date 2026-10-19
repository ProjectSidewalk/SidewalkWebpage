/**
 * Compass module. Shows the user which way to turn/move to follow the assigned route.
 */

import { Gate } from '../../common/Gate.js';
import { util } from '../../common/utilities.js';
import '../../common/utilitiesMath.js';
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('./NavigationService.js').NavigationService} NavigationService */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../region/RegionModel.js').RegionModel} RegionModel */
/** @typedef {import('../alert/StuckAlert.js').StuckAlert} StuckAlert */
/** @typedef {import('../task/StreetProgress.js').StreetProgress} StreetProgress */
/** @typedef {import('../task/TaskContainer.js').TaskContainer} TaskContainer */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class Compass {
  #config;
  #regionModel;
  #taskContainer;
  #panoManager;
  #navigationService;
  #streetProgress;
  #stuckAlert;
  #tracker;
  /** @type {Array<() => void>} */
  #finishClickListeners = [];
  #blinkInterval;
  #blinkTimer;
  #uiCompass;
  #directionIcons;
  /** @type {Set<Function>} */
  #messageClickHandlers = new Set();

  /**
   * Whether clicking the message turns the labeler toward the route: held by a move in flight, by the
   * label-before-jump prompt (whose click jumps instead) and by the tutorial.
   * @type {Gate}
   */
  click = new Gate();

  /**
   * @param {ExploreConfig} config
   * @param {RegionModel} regionModel - Says whether the route or region is done, which changes the message.
   * @param {TaskContainer} taskContainer - Whose current street the compass points along; a new street re-aims it.
   * @param {PanoManager} panoManager - Whose view is read and turned, and followed as it changes.
   * @param {NavigationService} navigationService - Makes the moves a compass click asks for; its moves pause the
   *   click and, once settled, re-aim the compass.
   * @param {StreetProgress} streetProgress - Whose label-before-jump prompt shows here, and makes the jump it offers.
   * @param {StuckAlert} stuckAlert - Told of a compass click, which is a sign the user isn't stuck.
   * @param {Tracker} tracker
   */
  constructor(config, regionModel, taskContainer, panoManager, navigationService, streetProgress, stuckAlert, tracker) {
    this.#config = config;
    this.#regionModel = regionModel;
    this.#taskContainer = taskContainer;
    this.#panoManager = panoManager;
    this.#navigationService = navigationService;
    this.#streetProgress = streetProgress;
    this.#stuckAlert = stuckAlert;
    this.#tracker = tracker;

    this.#uiCompass = {
      messageHolder: document.getElementById('compass-message-holder'),
      message: document.getElementById('compass-message'),
    };

    this.#directionIcons = {
      leftTurn: util.assetPath('images/explore/icons/ArrowLeftTurn.png'),
      rightTurn: util.assetPath('images/explore/icons/ArrowRightTurn.png'),
      slightLeft: util.assetPath('images/explore/icons/ArrowSlightLeft.png'),
      slightRight: util.assetPath('images/explore/icons/ArrowSlightRight.png'),
      straight: util.assetPath('images/explore/icons/ArrowStraight.png'),
      uTurn: util.assetPath('images/explore/icons/ArrowUTurn.png'),
    };

    this.attachMessageClickHandler(this.#handleCompassClick);
    this.click.onChanged((held) => {
      if (held) this.detachMessageClickHandler(this.#handleCompassClick);
      else this.attachMessageClickHandler(this.#handleCompassClick);
    });

    panoManager.onPovChanged(() => this.update());
    taskContainer.onCurrentTaskChanged(() => {
      this.showMessage();
      this.update();
    });
    navigationService.onMoveStarted(() => this.click.hold('move'));
    navigationService.onMoveFinished(() => this.click.release('move'));
    navigationService.onHeadingSettled(() => this.update());
    streetProgress.onLabelBeforeJumpChanged((armed) => {
      if (armed) this.showLabelBeforeJumpMessage();
      else this.resetBeforeJump();
    });
  }

  /**
   * Told when the user clicks the message that says the route or region is finished, to wrap it up.
   * @param {() => void} listener
   */
  onFinishClick(listener) {
    this.#finishClickListeners.push(listener);
  }

  /**
   * Blink the compass message.
   */
  blink() {
    this.stopBlinking();
    this.#blinkInterval = window.setInterval(() => {
      this.#uiCompass.messageHolder.classList.toggle('highlight-100');
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
    return this.#taskContainer.getCurrentTask().headingAlongRoute(this.#panoManager.getPosition());
  }

  /**
   * Check if the user is following the route that we specified.
   * @returns {boolean}
   */
  #checkEnRoute() {
    const task = this.#taskContainer.getCurrentTask();
    return task ? task.isNearRoute(this.#panoManager.getPosition()) : true;
  }

  /**
   * Turns the view to face the route's next goal, keeping its pitch and zoom.
   * @param {number} [durationMs] - Transition duration; immediate if undefined.
   */
  faceRoute(durationMs) {
    this.#panoManager.turnTo(this.getTargetAngle(), durationMs);
  }

  /**
   * Whether the user is currently on the assigned route (within the close-to-route threshold). Public so the pano's
   * route-forward arrow can match the compass, which only guides forward while en route. (#4671)
   * @returns {boolean}
   */
  isEnRoute() {
    return this.#checkEnRoute();
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

  // Held onto so the click handler can be removed again.
  #jumpMessageOnclick = null;

  #makeTheLabelBeforeJumpMessageBoxClickable() {
    this.#makeTheLabelBeforeJumpMessageBoxUnclickable();
    if (this.#regionModel.isRouteOrRegionComplete()) {
      this.#jumpMessageOnclick = () => this.#finishClickListeners.forEach((listener) => listener());
    } else {
      this.#jumpMessageOnclick = async () => {
        this.#tracker.push('LabelBeforeJump_Jump');
        await this.#streetProgress.jumpToANewTask();
      };
    }
    this.attachMessageClickHandler(this.#jumpMessageOnclick);
  }

  #makeTheLabelBeforeJumpMessageBoxUnclickable() {
    if (this.#jumpMessageOnclick) this.detachMessageClickHandler(this.#jumpMessageOnclick);
    this.#jumpMessageOnclick = null;
  }

  showLabelBeforeJumpMessage() {
    // Start blinking after 15 seconds.
    this.#blinkTimer = window.setTimeout(() => {
      this.#tracker.push('LabelBeforeJump_Blink');
      this.blink();
    }, 15000);
    this.click.hold('jump-prompt');
    this.#makeTheLabelBeforeJumpMessageBoxClickable();
    this.#setLabelBeforeJumpMessage();
  }

  removeLabelBeforeJumpMessage() {
    this.stopBlinking();
    this.#makeTheLabelBeforeJumpMessageBoxUnclickable();
    this.click.release('jump-prompt');
  }
  // ** end **

  /**
   * Get the compass angle.
   * @returns {number} Degrees the user needs to rotate to face the correct direction, normalized [0,360].
   */
  #getCompassAngle() {
    const heading = ((this.#panoManager.getPov().heading % 360) + 360) % 360;
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
        return this.#directionIcons.straight;
      case 'slight-right':
        return this.#directionIcons.slightRight;
      case 'slight-left':
        return this.#directionIcons.slightLeft;
      case 'right':
        return this.#directionIcons.rightTurn;
      case 'left':
        return this.#directionIcons.leftTurn;
      case 'u-turn':
        return this.#directionIcons.uTurn;
      default:
    }
  }

  /**
   * Hide a message.
   */
  hideMessage() {
    this.#uiCompass.messageHolder.hidden = true;
  }

  /**
   * Set the compass message.
   */
  setTurnMessage() {
    const angle = this.#getCompassAngle();
    const direction = this.#angleToDirection(angle);

    const src = util.escapeHTML(this.directionToImagePath(direction));
    const image = `<img src="${src}" class="compass-turn-images" alt="Turn icon"/>`;
    const message
      = `<div class="compass-message-small">${i18next.t('center-ui.compass.unlabeled-problems')}</div>`
        + `${image}<span class="compass-message-large">${this.#directionToDirectionMessage(direction)}</span>`;
    this.#uiCompass.message.innerHTML = message;
  }

  #setLabelBeforeJumpMessage() {
    if (this.#regionModel.isRouteComplete) {
      this.#uiCompass.message.innerHTML = `<div>${i18next.t('center-ui.compass.end-route')}</div>`;
    } else if (this.#regionModel.isRegionComplete) {
      this.#uiCompass.message.innerHTML = `<div>${i18next.t('center-ui.compass.end-region')}</div>`;
    } else {
      this.#uiCompass.message.innerHTML = `<div>${i18next.t('center-ui.compass.end-street')}</div>`;
    }
  }

  #setBackToRouteMessage() {
    this.#uiCompass.message.innerHTML = i18next.t('center-ui.compass.far-away');
  }

  /**
   * Show a message.
   */
  showMessage() {
    this.#uiCompass.messageHolder.hidden = false;
  }

  /**
   * Stop blinking the compass message.
   */
  stopBlinking() {
    window.clearInterval(this.#blinkInterval);
    this.#blinkInterval = null;
    this.#uiCompass.messageHolder.classList.remove('highlight-100');
  }

  /**
   * Update the compass message.
   */
  update() {
    // No route guidance in free exploration (#4451): there is no red line to follow or route to return to.
    if (this.#config.isExploreAddressMode) return;
    if (!this.#streetProgress.isLabelBeforeJumpArmed() && !this.#config.isOnboarding) {
      if (this.#checkEnRoute()) {
        this.stopBlinking();
        this.setTurnMessage();
      } else if (!this.#navigationService.isMoving()) {
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
  // An arrow field so the click gate attaches and detaches the same function.
  #handleCompassClick = async () => {
    if (this.#checkEnRoute()) {
      this.#stuckAlert.compassOrStuckClicked();

      const angle = this.#getCompassAngle();
      const direction = this.#angleToDirection(angle);
      this.#tracker.push(`Click_Compass_Direction=${direction}`);

      if (direction === 'straight') {
        // A refused move resolves too, and must not be logged as one that happened.
        if (!this.#navigationService.canWalk()) return;
        await this.#navigationService.moveForward()
          .then(() => this.#tracker.push('CompassMove_Success'))
          .catch(() => this.#tracker.push('CompassMove_PanoNotAvailable'));
      } else {
        this.faceRoute(250);
      }
    } else {
      this.#tracker.push('Click_Compass_FarFromRoute');
      await this.#navigationService.moveForward();
      this.faceRoute();
    }
  };

  /**
   * Attaches an external click handler to the compass message and shows the pointer cursor. Onboarding uses this to
   * override the default compass behavior so that a click advances to the next pano.
   * @param {Function} handler
   */
  attachMessageClickHandler(handler) {
    this.#uiCompass.messageHolder.addEventListener('click', handler);
    this.#messageClickHandlers.add(handler);
    this.#syncMessageCursor();
  }

  /**
   * Detaches an attached external click handler from the compass message.
   * @param {Function} handler
   */
  detachMessageClickHandler(handler) {
    this.#uiCompass.messageHolder.removeEventListener('click', handler);
    this.#messageClickHandlers.delete(handler);
    this.#syncMessageCursor();
  }

  /** The pointer cursor promises a click does something, so it stays while any handler is attached. */
  #syncMessageCursor() {
    this.#uiCompass.messageHolder.style.cursor = this.#messageClickHandlers.size > 0 ? 'pointer' : 'default';
  }
}
