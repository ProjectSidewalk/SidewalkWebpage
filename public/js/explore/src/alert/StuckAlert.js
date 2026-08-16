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
   * Tells the labeler that they have been moved off a street with no imagery, and where to.
   *
   * Shown without the "don't show again" option (#4918): this reports an unrequested change of location, which the
   * labeler needs in order to make sense of the screen in front of them, and a labeler who silenced it once would
   * otherwise be teleported wordlessly for the rest of that browser's life.
   *
   * @param {string} [streetName] - Name of the street they were moved to, when it could be determined.
   */
  stuckSkippedStreet(streetName) {
    const key = streetName ? 'popup.stuck-skipped-street-named' : 'popup.stuck-skipped-street';
    this._showAlert(key, 'stuckStreetSkipped', { streetName }, false);
  }

  /**
   * Looks up what the street at a location is called, then reports the move there.
   *
   * @param {{lat: number, lng: number}} latLng - A point on the street the labeler was moved to.
   * @param {string} mapboxApiKey - Mapbox access token for the lookup; without one the message goes out unnamed.
   * @returns {Promise<void>} Resolves once the message is on screen.
   */
  async announceSkippedStreetNear(latLng, mapboxApiKey) {
    this.stuckSkippedStreet(await util.misc.getStreetNameNear(latLng, mapboxApiKey));
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
    if (this.#recentPanos.filter((x) => x === panoId).length > 2) {
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
