/**
 * Displays the tip message shown after the user jumps to a new street.
 */
class JumpAlert {
    #alertHandler;

    /**
     * @param alertHandler Alert object used to render the message.
     */
    constructor(alertHandler) {
        this.#alertHandler = alertHandler;
    }

    /**
     * Shows a jump-tip alert with the given message.
     * @param {string} message The message to display.
     */
    showJumpTipMessage(message) {
        this.#alertHandler.showAlert(message, 'jumpTipMessage', true);
    }

    // Called when the user clicks the "jump" message to relocate to a new street.
    onClickJumpMessage() {
        this.showJumpTipMessage(i18next.t('popup.jump'));
    }
}
