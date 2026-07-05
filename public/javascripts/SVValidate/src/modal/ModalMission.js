/**
 * NOTE This is now used only for the mission start screens on mobile!
 */
class ModalMission {
  #uiModalMission;

  #validationStartMissionHTML = ` <figure> \
        <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>${i18next.t('mission-start.body')}</p>\
        <div class="spacer10"></div>`;

  #validationResumeMissionHTML = ' <figure> \
        <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Continue validating  __LABELCOUNT_PLACEHOLDER__ __LABELTYPE_PLACEHOLDER__</span> labels placed by other users!</p>\
        <div class="spacer10"></div>';

  /**
   * @param {object} uiModalMission Mission modal UI elements.
   */
  constructor(uiModalMission) {
    this.#uiModalMission = uiModalMission;
  }

  #handleButtonClick = () => {
    const mission = svv.missionContainer.getCurrentMission();

    // Check added so that if a user begins a mission, leaves partway through, and then resumes the mission later,
    // another MissionStart will not be triggered
    if (mission.getProperty('labelsProgress') < 1) {
      svv.tracker.push(
        'MissionStart',
        {
          missionId: mission.getProperty('missionId'),
          missionType: mission.getProperty('missionType'),
          labelTypeId: mission.getProperty('labelTypeId'),
          labelsValidated: mission.getProperty('labelsValidated'),
        },
      );
    }
    // Update zoom availability on desktop.
    if (svv.zoomControl) {
      svv.zoomControl.updateZoomAvailability();
    }
    this.hide();
  };

  /**
   * Hides the new/continuing mission screen.
   */
  hide() {
    if (svv.keyboard) {
      svv.keyboard.enableKeyboard();
    }
    this.#uiModalMission.background.css('visibility', 'hidden');
    this.#uiModalMission.holder.css('visibility', 'hidden');
    this.#uiModalMission.foreground.css('visibility', 'hidden');
  }

  /**
   * Generates HTML for the new mission screen with information about the current mission
   * (label type, length of validation mission).
   * @param {Mission} mission Mission object for the new mission.
   */
  setMissionMessage(mission) {
    if (mission.getProperty('labelsProgress') === 0) {
      const validationMissionStartTitle = i18next.t('mission-start.title',
        {
          n: mission.getProperty('labelsValidated'),
          label_type: svv.labelTypeNames[mission.getProperty('labelTypeId')],
        });
      let validationStartMissionHTMLCopy = this.#validationStartMissionHTML.replace('__LABELCOUNT_PLACEHOLDER__', mission.getProperty('labelsValidated'));
      validationStartMissionHTMLCopy = validationStartMissionHTMLCopy.replace('__LABELTYPE_PLACEHOLDER__', svv.labelTypeNames[mission.getProperty('labelTypeId')]);
      this.show(validationMissionStartTitle, validationStartMissionHTMLCopy);
    } else {
      const validationMissionStartTitle = 'Return to your mission';
      let validationResumeMissionHTMLCopy = this.#validationResumeMissionHTML.replace('__LABELCOUNT_PLACEHOLDER__', mission.getProperty('labelsValidated'));
      validationResumeMissionHTMLCopy = validationResumeMissionHTMLCopy.replace('__LABELTYPE_PLACEHOLDER__', svv.labelTypeNames[mission.getProperty('labelTypeId')]);
      this.show(validationMissionStartTitle, validationResumeMissionHTMLCopy);
    }
  }

  show(title, instruction) {
    // Disable keyboard on mobile.
    if (svv.keyboard) {
      svv.keyboard.disableKeyboard();
    }
    if (instruction) {
      this.#uiModalMission.instruction.html(instruction);
    }

    this.#uiModalMission.background.css('visibility', 'visible');
    this.#uiModalMission.missionTitle.html(title);
    this.#uiModalMission.holder.css('visibility', 'visible');
    this.#uiModalMission.foreground.css('visibility', 'visible');
    this.#uiModalMission.closeButton.html('Ok');
    this.#uiModalMission.closeButton.off('click').on('click', this.#handleButtonClick);
  }
}
