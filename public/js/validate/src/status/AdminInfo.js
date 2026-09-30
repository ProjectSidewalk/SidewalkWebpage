/**
 * The Admin Info popover on /expertValidate: who placed the current label, its id, and its previous validations.
 */
class AdminInfo {
  /** @type {HTMLTemplateElement} */
  #template;

  /** @type {HTMLElement} */
  #popover;

  /** @type {HTMLButtonElement} */
  #button;

  /**
   * Open/close, light dismiss and stacking are the browser's, via the `popover` attribute; this fills and parks it.
   *
   * @param {object} adminUi - The Admin Info UI elements
   * @param {HTMLElement} adminUi.holder - The section holding the button
   * @param {HTMLButtonElement} adminUi.button - The Admin Info button
   * @param {HTMLElement} adminUi.popover - The popover the button opens
   * @param {HTMLTemplateElement} adminUi.template - The template HTML the popover is filled from
   */
  constructor(adminUi) {
    this.#template = adminUi.template;
    this.#popover = adminUi.popover;
    this.#button = adminUi.button;

    adminUi.holder.style.display = 'block';

    this.#popover.addEventListener('beforetoggle', (e) => {
      if (/** @type {ToggleEvent} */ (e).newState === 'open') util.placePopover(this.#popover, this.#button);
    });
  }

  /**
   * Fills the popover with the current label's admin info.
   *
   * @param {Label} currentLabel - The current label shown; we show admin info related to this label
   */
  updateAdminInfo(currentLabel) {
    const content = /** @type {DocumentFragment} */ (this.#template.content.cloneNode(true));
    const root = /** @type {HTMLElement} */ (content.firstElementChild);

    const username = currentLabel.getAdminProperty('username');
    root.querySelector('#curr-label-username').replaceChildren(this.#userLink(username));
    root.querySelector('#curr-label-id').textContent = currentLabel.getAuditProperty('labelId');

    const prevVals = currentLabel.getAdminProperty('previousValidations');
    if (prevVals.length === 0) {
      root.append(this.#prevValLine('None'));
    } else {
      for (const prevVal of prevVals) {
        const prevValText = i18next.t(`common:${util.camelToKebab(prevVal.validation)}`);
        root.append(this.#prevValLine(this.#userLink(prevVal.username), `: ${prevValText}`));
      }
    }
    this.#popover.replaceChildren(root);
    // The pseudo-class is a syntax error where the popover API is missing, and there is nothing to re-park then.
    if ('popover' in HTMLElement.prototype && this.#popover.matches(':popover-open')) {
      util.placePopover(this.#popover, this.#button);
    }
  }

  /**
   * @param {string} username - User-supplied, so it goes in as text, never markup.
   * @returns {HTMLAnchorElement} A link to that user's admin page.
   */
  #userLink(username) {
    const link = document.createElement('a');
    link.href = `/admin/user/${encodeURIComponent(username)}`;
    link.target = '_blank';
    link.textContent = username;
    return link;
  }

  /**
   * @param {...(string|Node)} parts - The line's content.
   * @returns {HTMLParagraphElement} One previous-validation line.
   */
  #prevValLine(...parts) {
    const line = document.createElement('p');
    line.className = 'prev-val';
    line.append(...parts);
    return line;
  }
}
