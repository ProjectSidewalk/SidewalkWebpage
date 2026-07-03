/**
 * Handles edge case if there are no more labels for this user to validate.
 * Creates an overlay that notifies user that there are no more labels left for them to validate
 * at the moment. Disables controls, shortcuts.
 */
class ModalNoNewMission {
    #uiModalMission;
    #noMissionsRemaining;

    /**
     * @param {object} uiModalMission Mission modal UI elements.
     */
    constructor(uiModalMission) {
        this.#uiModalMission = uiModalMission;

        const instructions = util.isMobile()
            ? i18next.t('mobile.no-new-mission-body')
            : i18next.t('mission-complete.no-new-mission-body');
        this.#noMissionsRemaining = `<figure> \
            <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
            </figure> \
            <div class="spacer10"></div>\
            <p>${instructions}</p>\
            <div class="spacer10"></div>`;
    }

    #handleButtonClick = () => {
        if (util.isMobile()) {
            svv.tracker.push('Click_NoMoreMissionModal_ValidateSeattle');
            window.location.replace('https://sidewalk-sea.cs.washington.edu/validate');
        } else {
            svv.tracker.push('Click_NoMoreMissionModal_Audit');
            window.location.replace('/explore');
        }
    };

    show() {
        if (svv.keyboard) {
            svv.keyboard.disableKeyboard();
        }
        this.#uiModalMission.background.css('visibility', 'visible');
        this.#uiModalMission.instruction.html(this.#noMissionsRemaining);
        this.#uiModalMission.missionTitle.html(i18next.t('mission-complete.no-new-mission-title'));
        this.#uiModalMission.holder.css('visibility', 'visible');
        this.#uiModalMission.foreground.css('visibility', 'visible');

        // Update and widen the button to fit more text when there is no new mission.
        if (util.isMobile()) {
            this.#uiModalMission.closeButton.html(`${i18next.t('mobile.no-new-mission-button')} Seattle, WA`);
            this.#uiModalMission.closeButton.css('font-size', '40pt');
            this.#uiModalMission.closeButton.css('width', '76%');
            this.#uiModalMission.closeButton.css('margin-right', '12%');
        } else {
            this.#uiModalMission.closeButton.html(i18next.t('mission-complete.no-new-mission-button'));
            this.#uiModalMission.closeButton.css('width', 'fit-content');
        }
        this.#uiModalMission.closeButton.on('click', this.#handleButtonClick);
        this.#uiModalMission.holder.css('display', '');
    }
}
