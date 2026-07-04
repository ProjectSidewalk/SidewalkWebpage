/**
 * Owns the shared alert banner (`#alert-holder`) and its show/hide lifecycle, plus the user's "don't show again"
 * opt-out list. There is a single instance (`svl.alertController`); the individual alert types (subclasses of Alert)
 * delegate to it (through DI) rather than touching the alert DOM themselves.
 */
class AlertController {
  #ui;
  #dontShowList;
  #lastMessageType;
  #hideTimeout;

  // Fade duration (ms) for showing/hiding the banner.
  static #FADE_DURATION = 300;
  // The banner auto-dismisses after this long (ms).
  static #AUTO_HIDE_DELAY = 15000;

  constructor() {
    this.#ui = {
      holder: document.getElementById('alert-holder'),
      message: document.getElementById('alert-message'),
      close: document.getElementById('alert-close'),
      dontShow: document.getElementById('alert-dont-show'),
    };

    this.#ui.close.addEventListener('click', () => this.hideAlert());
    this.#ui.dontShow.addEventListener('click', () => this.dontShowClicked());

    this.#dontShowList = svl.storage.get('alertDontShowList') || [];
  }

  /**
     * Fades an element in, then invokes an optional callback once the animation settles.
     * @param {HTMLElement} el - Element to reveal.
     * @param {Function} [callback] - Called after the fade completes.
     */
  #fadeIn(el, callback) {
    el.style.display = '';
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: AlertController.#FADE_DURATION })
      .addEventListener('finish', () => {
        el.style.opacity = '';
        if (callback) callback();
      });
  }

  /**
     * Fades an element out, hides it, then invokes an optional callback once the animation settles.
     * @param {HTMLElement} el - Element to hide.
     * @param {Function} [callback] - Called after the fade completes.
     */
  #fadeOut(el, callback) {
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: AlertController.#FADE_DURATION })
      .addEventListener('finish', () => {
        el.style.display = 'none';
        el.style.opacity = '';
        if (callback) callback();
      });
  }

  /**
     * Shows the alert banner unless the user has opted out of this message type.
     * @param {string} msg - The message to display (HTML).
     * @param {string} type - Identifies the message type; suppressed when the user has opted out of it.
     * @param {boolean} [dontShow=false] - Whether the "don't show again" link is offered.
     * @param {Function} [callback] - Called once the banner has finished fading in.
     */
  showAlert(msg, type, dontShow = false, callback) {
    if (type !== null && type !== undefined && this.#dontShowList.includes(type)) return;

    this.#ui.dontShow.style.display = dontShow ? '' : 'none';

    this.hideAlert(() => {
      this.#ui.message.innerHTML = msg;
      this.#lastMessageType = type;
      this.#fadeIn(this.#ui.holder, callback);
    });

    this.#hideTimeout = setTimeout(() => this.hideAlert(), AlertController.#AUTO_HIDE_DELAY);
  }

  /**
     * Hides the alert banner.
     * @param {Function} [callback] - Called once the banner has finished fading out.
     */
  hideAlert(callback) {
    this.#fadeOut(this.#ui.holder, callback);
    clearTimeout(this.#hideTimeout);
  }

  /**
     * Records the current message type on the "don't show again" list and hides the banner.
     */
  dontShowClicked() {
    if (this.#lastMessageType !== null && this.#lastMessageType !== undefined) {
      this.#dontShowList.push(this.#lastMessageType);
      svl.storage.set('alertDontShowList', this.#dontShowList);
      this.hideAlert();
    }
  }
}
