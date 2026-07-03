/**
 * Alerts shown around the Stuck button: a "still stuck?" confirmation, a street-skipped notice, and a nudge when the
 * user appears to be circling the same panos.
 */
class StuckAlert extends Alert {
    #recentPanos = [];

    /**
     * Shows the "still stuck?" alert when the user clicks the Stuck button.
     */
    stuckClicked() {
        this._showAlert('popup.still-stuck', 'stuck');
    }

    /**
     * Shows a notice that the current street was skipped because the user was stuck.
     */
    stuckSkippedStreet() {
        this._showAlert('popup.stuck-skipped-street', 'stuckStreetSkipped');
    }

    /**
     * Records a visited pano and, if the user has revisited it several times recently, suggests they may be stuck.
     * @param {string} panoId - The pano the user just visited.
     */
    panoVisited(panoId) {
        this.#recentPanos.push(panoId);

        // Only keep track of the 25 most recent panos visited.
        if (this.#recentPanos.length > 25) this.#recentPanos.shift();

        // If this is their 3rd time visiting the pano recently, show an alert.
        if (this.#recentPanos.filter(x => x === panoId).length > 2) {
            this._showAlert('popup.stuck-suggestion', 'stuckSuggestion');
        }
    }

    /**
     * Clears the recent-pano history so we don't nudge the user right after they use the compass or Stuck button.
     */
    compassOrStuckClicked() {
        this.#recentPanos = [];
    }
}
