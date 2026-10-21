/**
 * Nudges the user toward the zoom keyboard shortcut after they've clicked the zoom button several times.
 */

import { Alert } from './Alert.js';

/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('./AlertController.js').AlertController} AlertController */

export class ZoomShortcutAlert extends Alert {
  #config;

  /**
   * @param {ExploreConfig} config - The nudge stays quiet in the tutorial.
   * @param {AlertController} alertController
   */
  constructor(config, alertController) {
    super(alertController);
    this.#config = config;
  }

  #zoomCount = 0;

  static #MINIMUM_ZOOM_CLICKS_BEFORE_ALERT = 5;

  /**
   * Tracks zoom-button clicks and shows the zoom shortcut alert once clicked enough times.
   */
  zoomClicked() {
    if (this.#zoomCount > 0) {
      this.#zoomCount++;
    } else {
      this.#zoomCount = 1;
    }

    if (this.#zoomCount >= ZoomShortcutAlert.#MINIMUM_ZOOM_CLICKS_BEFORE_ALERT && !this.#config.isOnboarding) {
      this._showAlert('popup.zoom-shortcuts', 'zoomMessage');
      this.#zoomCount = 0;
    }
  }
}
