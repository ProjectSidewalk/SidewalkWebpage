/**
 * Opens an image at full size in a native <dialog>, which brings the focus trap, Escape-to-close, backdrop, and focus
 * return for free. One dialog is built lazily and shared by every trigger. Styles: css/components/image-lightbox.css.
 */
class ImageLightbox {
  /** @type {HTMLDialogElement|null} */
  #dialog = null;
  /** @type {HTMLImageElement|null} */
  #image = null;
  /** @type {HTMLElement|null} */
  #caption = null;

  /** @param {string} selector - Matches the <img> elements that should open in the lightbox. */
  constructor(selector) {
    for (const img of /** @type {NodeListOf<HTMLImageElement>} */ (document.querySelectorAll(selector))) {
      // An <img> can't be reached by keyboard on its own, so make each trigger act like a button.
      img.setAttribute('role', 'button');
      img.setAttribute('tabindex', '0');
      img.setAttribute('aria-haspopup', 'dialog');
      img.addEventListener('click', () => this.#open(img));
      img.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.#open(img);
        }
      });
    }
  }

  /** @returns {HTMLDialogElement} The shared dialog, built on first use. */
  #ensureDialog() {
    if (this.#dialog) return this.#dialog;
    const dialog = document.createElement('dialog');
    dialog.className = 'ps-lightbox';
    dialog.innerHTML = `
      <button type="button" class="ps-lightbox__close" aria-label="Close" data-i18n-aria-label="common:close">
        &times;
      </button>
      <img class="ps-lightbox__img" alt="">
      <p class="ps-lightbox__caption"></p>
    `;
    dialog.querySelector('.ps-lightbox__close').addEventListener('click', () => dialog.close());
    // A press on the backdrop lands on the dialog itself. pointerdown rather than click, so a drag that starts on the
    // image and ends outside it doesn't count as a backdrop click.
    dialog.addEventListener('pointerdown', (e) => {
      if (e.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    window.localizeSubtree?.(dialog);
    this.#dialog = dialog;
    this.#image = dialog.querySelector('.ps-lightbox__img');
    this.#caption = dialog.querySelector('.ps-lightbox__caption');
    return dialog;
  }

  /** @param {HTMLImageElement} img - The trigger whose picture is shown at full size. */
  #open(img) {
    const dialog = this.#ensureDialog();
    this.#image.src = img.currentSrc || img.src;
    this.#image.alt = img.alt;
    this.#caption.textContent = img.title;
    this.#caption.hidden = !img.title;
    dialog.setAttribute('aria-label', img.alt);
    dialog.showModal();
  }
}
