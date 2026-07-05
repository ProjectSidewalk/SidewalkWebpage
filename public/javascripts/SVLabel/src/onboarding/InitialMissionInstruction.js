/**
 * Creates pop up messages during your first mission or two with instructions to improve labeling.
 */
class InitialMissionInstruction {
  #compass;
  #navigationService;
  #popUpMessage;
  #taskContainer;
  #labelContainer;
  #aiGuidance;
  #tracker;
  #lookingAroundInterval;
  #initialPanoId;

  /**
   * @param {Compass} compass
   * @param {NavigationService} navigationService
   * @param {PopUpMessage} popUpMessage
   * @param {TaskContainer} taskContainer
   * @param {LabelContainer} labelContainer
   * @param {AiGuidance} aiGuidance
   * @param {Tracker} tracker
   */
  constructor(compass, navigationService, popUpMessage, taskContainer, labelContainer, aiGuidance, tracker) {
    this.#compass = compass;
    this.#navigationService = navigationService;
    this.#popUpMessage = popUpMessage;
    this.#taskContainer = taskContainer;
    this.#labelContainer = labelContainer;
    this.#aiGuidance = aiGuidance;
    this.#tracker = tracker;
  }

  // The two position-update handlers below are arrow-function fields (not methods) so each keeps a single stable
  // identity: they are registered AND removed via bind/unbindPositionUpdate, which matches by function reference.

  /**
   * Instruct a user to audit both sides of the streets once they have walked for 100 meters.
   */
  #instructToCheckSidewalks = () => {
    const distance = this.#taskContainer.getCompletedTaskDistance({ units: 'meters' });
    if (distance >= 100) {
      this.#tracker.push('PopUpShow_CheckBothSides');
      const title = i18next.t('popup.both-sides-title');
      const message = i18next.t('popup.both-sides-body');
      const width = '450px';
      const height = '291px';
      const x = '50px';
      const image = '/assets/images/examples/lookaround-example.gif';

      // Send the notification. After they click OK, get ready to notify them about disappearing labels.
      this.#popUpMessage.notifyWithImage(title, message, image, width, height, x, () => {
        this.#navigationService.unbindPositionUpdate(this.#instructToCheckSidewalks);
        this.#navigationService.bindPositionUpdate(this.#instructForLabelDisappearing);
      });
    }
  };

  /**
   * Instruct the user about labels disappearing when they have labeled and walked for the first time.
   */
  #instructForLabelDisappearing = () => {
    if (this.#labelContainer.getAllLabels().length > 0) {
      this.#tracker.push('PopUpShow_LabelDisappear');
      const title = i18next.t('popup.labels-disappear-title');
      const message = i18next.t('popup.labels-disappear-body');
      this.#popUpMessage.notify(title, message, () => {
        svl.minimap.stopBlinkingMinimap();
        this.#navigationService.unbindPositionUpdate(this.#instructForLabelDisappearing);
      });
      svl.minimap.blinkMinimap();
    }
  };

  /**
   * Shows the popup that tells the user to follow the line on the minimap if they spun in a circle at start.
   */
  #instructToFollowTheGuidance() {
    this.#tracker.push('PopUpShow_LookAroundIntersection');

    const title = i18next.t('popup.step-title');
    const message = i18next.t('popup.step-body');
    this.#popUpMessage.notify(title, message, () => {
      this.#compass.stopBlinking();
      svl.minimap.stopBlinkingMinimap();
    });
    this.#compass.blink();
    svl.minimap.blinkMinimap();
  }

  /**
   * Adds an instruction to make sure users know how to move. If they pan all the way around, show them.
   */
  #pollLookingAroundHasFinished() {
    // Check the panoId to make sure the user hasn't walked.
    if (svl.panoViewer.getPanoId() === this.#initialPanoId) {
      // If the user has seen the entire panorama, show a notif explaining how to move.
      if (svl.observedArea.getFractionObserved() === 1) {
        clearInterval(this.#lookingAroundInterval);
        this.#instructToFollowTheGuidance();
      }
    } else {
      // If they've already moved successfully, stop continuously checking for this.
      clearInterval(this.#lookingAroundInterval);
    }
  }

  /**
   * Shows the starter notification when you begin your first mission.
   * @param {Neighborhood} neighborhood
   */
  start(neighborhood) {
    this.#tracker.push('PopUpShow_LetsGetStarted');

    const title = i18next.t('popup.start-title');
    const message = i18next.t(
      'popup.start-body', { neighborhood: neighborhood.getProperty('name'), city: window.cityNameShort },
    );
    this.#popUpMessage.notify(title, message, () => {
      this.#navigationService.bindPositionUpdate(this.#instructToCheckSidewalks);
      this.#aiGuidance.showAiGuidanceMessage(); // Show AI guidance message for the current street.
    });

    // If the user looks nearly 360 degrees, show a notification explaining how to move.
    this.#initialPanoId = svl.panoViewer.getPanoId();
    this.#lookingAroundInterval = setInterval(() => this.#pollLookingAroundHasFinished(), 50);
  }
}
