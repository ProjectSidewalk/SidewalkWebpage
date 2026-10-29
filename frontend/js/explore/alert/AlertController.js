/**
 * Shows Explore's tips and notices as toasts over the pano, one at a time, and keeps the user's "don't show again"
 * opt-out list. There is a single instance; the individual alert types (subclasses of Alert) delegate to it rather
 * than showing toasts themselves.
 */

import i18next from 'i18next';
import { Toast } from '../../common/Toast.js';

/** @typedef {import('../data/Storage.js').TemporaryStorage} TemporaryStorage */

export class AlertController {
  #storage;
  #dontShowList;
  #toast = null;

  // Long enough to read a tip with a key name in it, and still gone before it reads as part of the tool.
  static #DURATION_MS = 15000;

  /**
   * @param {TemporaryStorage} storage - Remembers the opt-outs across sessions.
   */
  constructor(storage) {
    this.#storage = storage;
    this.#dontShowList = storage.get('alertDontShowList') || [];
  }

  /**
   * Shows a toast over the pano unless the user has opted out of this message type. It replaces any alert still
   * showing, since a newer tip or notice makes the older one stale.
   * @param {string} msg - The message to display (HTML; escape any outside values in it).
   * @param {string} type - Identifies the message type; suppressed when the user has opted out of it.
   * @param {boolean} [dontShow=false] - Whether the "don't show again" button is offered.
   */
  showAlert(msg, type, dontShow = false) {
    // An opt-out binds only while the opt-out is still on offer. A message shown without the button is one the
    // labeler is meant to see, so a choice made back when it was optional is discarded rather than honored forever —
    // which matters because these are stored per browser and never expire (#4918).
    if (!dontShow) this.#reofferMessageType(type);
    if (type !== null && type !== undefined && this.#dontShowList.includes(type)) return;

    this.hideAlert();
    this.#toast = Toast.show({
      messageHtml: msg,
      reference: document.getElementById('pano'),
      dark: true, // It floats over street imagery, where a white card glares.
      duration: AlertController.#DURATION_MS,
      button: dontShow
        ? { label: i18next.t('common:dont-show-again'), secondary: true, onClick: () => this.#dontShow(type) }
        : undefined,
    });
  }

  /** Takes down the alert showing, if any. */
  hideAlert() {
    this.#toast?.dismiss();
    this.#toast = null;
  }

  /**
   * Drops a stored opt-out for a message type, so a message shown without the opt-out button reaches a labeler who
   * had silenced it.
   * @param {string} type - Message type identifier.
   */
  #reofferMessageType(type) {
    if (type === null || type === undefined || !this.#dontShowList.includes(type)) return;
    this.#dontShowList = this.#dontShowList.filter((silenced) => silenced !== type);
    this.#storage.set('alertDontShowList', this.#dontShowList);
  }

  /**
   * Records a message type on the "don't show again" list and takes its toast down.
   * @param {string} type - Message type identifier.
   */
  #dontShow(type) {
    if (type !== null && type !== undefined) {
      this.#dontShowList.push(type);
      this.#storage.set('alertDontShowList', this.#dontShowList);
    }
    this.hideAlert();
  }
}
