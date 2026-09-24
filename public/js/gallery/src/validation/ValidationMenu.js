/**
 * A Validation Menu appended to a small Gallery Card for validation purposes.
 *
 * A Disagree or Unsure cast here opens a small popover over the card's image offering the one-tap reasons Validate
 * asks for (#5475), so a vote from the grid can carry a reason without the expanded view, plus a text box for a reason
 * of the voter's own. Dismissing it, or moving the mouse off the card, leaves the vote standing; only a new
 * Disagree or Unsure vote brings it back.
 */
class ValidationMenu {
  /** How long the picked chip is shown landing before the popover closes on its own. */
  static REASON_CLOSE_DELAY_MS = 700;

  /** @type {?ValidationMenu} The card whose popover is up; a vote elsewhere closes it, one question at a time. */
  static #openMenu = null;

  static #classToValidationOption = {
    'validate-agree': 'Agree',
    'validate-disagree': 'Disagree',
    'validate-unsure': 'Unsure',
  };

  static #validationOptionToClass = {
    Agree: 'validate-agree',
    Disagree: 'validate-disagree',
    Unsure: 'validate-unsure',
  };

  #refCard;
  #gsvImage;
  #currSelected = null;
  #overlay;
  #validationButtons = undefined;
  #galleryCard;
  /** @type {?HTMLElement} The reason popover, built on the first Disagree/Unsure (#5475). */
  #reasonPopover = null;
  /** @type {?ReasonChips} */
  #reasonChips = null;
  /** @type {?HTMLInputElement} */
  #otherInput = null;
  /** @type {?HTMLButtonElement} */
  #otherSubmit = null;
  /** @type {?string} The vote the open popover is asking about, or null while it is closed. */
  #reasonVote = null;
  /** @type {?HTMLElement} The control whose vote opened the popover, which gets focus back when it closes. */
  #reasonOpener = null;
  #reasonCloseTimer = null;
  // A pick in flight holds the vote: see #setVoteControlsLocked.
  #voteLocked = false;
  #boundOutsideClick = (e) => this.#handleOutsideClick(e);
  #boundKeydown = (e) => this.#handleKeydown(e);
  #boundPointerLeave = (e) => this.#handlePointerLeave(e);

  /**
   * @param {Card} referenceCard - The Card this menu belongs to.
   * @param {JQuery} gsvImage - The HTML element to append the validation menu to.
   */
  constructor(referenceCard, gsvImage) {
    this.#refCard = referenceCard;
    this.#gsvImage = gsvImage;

    const cardOverlayHTML = `
      <div id="gallery-validation-button-holder">
        <button id="gallery-card-agree-button" class="validation-button">${i18next.t('common:agree')}</button>
        <button id="gallery-card-disagree-button" class="validation-button">${i18next.t('common:disagree')}</button>
        <button id="gallery-card-unsure-button" class="validation-button">${i18next.t('common:unsure')}</button>
      </div>`;
    this.#overlay = $(cardOverlayHTML);
    this.#galleryCard = gsvImage.parent();

    this.#init();
  }

  /**
   * Adds onClick functions for the validation buttons. Read-only for labels contributed by the current user.
   */
  #init() {
    const refCard = this.#refCard;
    this.#validationButtons = {
      'validate-agree': this.#overlay.find('#gallery-card-agree-button'),
      'validate-disagree': this.#overlay.find('#gallery-card-disagree-button'),
      'validate-unsure': this.#overlay.find('#gallery-card-unsure-button'),
    };

    // If the signed-in user had already validated this label before loading the page, style the card.
    const userValidation = refCard ? refCard.getProperty('user_validation') : null;
    if (userValidation) {
      this.showValidationOnCard(userValidation);
    }

    const readonly = !!refCard.getProperty('from_current_user');
    if (readonly) {
      const tip = i18next.t('labelmap:own-label-disabled');
      this.#galleryCard.addClass('gallery-card--readonly');

      // Disable validation buttons; skip attaching click handlers. The reason rides their holder rather than each
      // button, since a disabled button swallows the hover that would open a tooltip on it.
      for (const button of Object.values(this.#validationButtons)) button.prop('disabled', true);
      this.#overlay.attr('data-ps-tooltip', tip);

      // Same reason on the thumbs, in place of the vote text they'd otherwise carry.
      refCard.validationInfoDisplay.setLockReason(tip);
    } else {
      // Add onClick functions for the validation buttons.
      for (const [valKey, button] of Object.entries(this.#validationButtons)) {
        button.click(this.validateOnClickOrKeyPress(valKey, false, false));
      }

      this.#addValidationInfoOnClicks(refCard.validationInfoDisplay);
    }
    this.#gsvImage.append(this.#overlay);
  }

  /**
   * Add onClick functions for the thumbs up/down buttons.
   * @param {ValidationInfoDisplay} valInfoDisplay
   */
  #addValidationInfoOnClicks(valInfoDisplay) {
    valInfoDisplay.agreeContainer.onclick = this.validateOnClickOrKeyPress('validate-agree', true, false);
    valInfoDisplay.disagreeContainer.onclick = this.validateOnClickOrKeyPress('validate-disagree', true, false);

    // Hover preview: swap the thumb icon to its filled variant to hint that it's clickable.
    const addHoverSwap = (container, action) => {
      container.addEventListener('mouseenter', () => {
        if (this.#currSelected === ValidationMenu.#validationOptionToClass[action]) return;
        valInfoDisplay.setVoteIconFilled(action, true);
      });
      container.addEventListener('mouseleave', () => valInfoDisplay.setVoteIconFilled(action, false));
    };
    addHoverSwap(valInfoDisplay.agreeContainer, 'Agree');
    addHoverSwap(valInfoDisplay.disagreeContainer, 'Disagree');
  }

  /**
   * OnClick or keyboard shortcut function for validation buttons and thumbs up/down buttons.
   *
   * The buttons are toggles: clicking the option already selected clears the vote (#4653), matching the label detail
   * card that opens from this same card.
   *
   * @param {string} newValKey
   * @param {boolean} thumbsClick - Whether the validation came from clicking the thumb icons.
   * @param {boolean} keyboardShortcut - Whether the validation came from a keyboard shortcut.
   * @returns {(e?: Event) => Promise<?Response>} A function returning a Promise that resolves once the validation
   *     has been submitted, with the server's response, or null if the request never completed. The event, when
   *     there is one, names the control that voted, which the reason popover hands focus back to (#5475).
   */
  validateOnClickOrKeyPress(newValKey, thumbsClick, keyboardShortcut) {
    return async (e) => {
      if (this.#voteLocked) return null;
      const undone = this.#currSelected === newValKey;
      const validationOption = ValidationMenu.#classToValidationOption[newValKey];
      const opener = e?.currentTarget instanceof HTMLElement ? e.currentTarget : null;

      // #validateLabel has to run first: it reads the card's *previous* user_validation to set `redone` and to decide
      // whether this is a new validation worth a badge check.
      try {
        const res = await this.#validateLabel(validationOption, thumbsClick, keyboardShortcut, undone);
        // Restyle the card only once the server has taken the vote. Updating it up front would leave the card showing
        // a vote — or a cleared vote — that the backend never recorded, whenever the request fails.
        if (res.ok) {
          const previous = this.#refCard.getProperty('user_validation');
          this.#refCard.updateUserValidation(undone ? null : validationOption);
          this.#refCard.validationInfoDisplay?.animateVoteChange(previous, undone ? null : validationOption);
          // The word buttons are bound through jQuery, whose event wraps the native one. `detail` is 0 for a
          // keyboard-activated click.
          const native = /** @type {any} */ (e)?.originalEvent ?? e;
          const viaPointer = native instanceof MouseEvent && native.detail > 0;
          // Only a vote that landed gets asked about, and only from this card: a vote the expanded view relays back
          // has its own reason row over there.
          if (!undone && this.#reasonedVote(validationOption)) this.#openReasons(validationOption, opener, viaPointer);
          else this.#closeReasons(false);
        }
        return res;
      } catch (err) {
        console.error(err); // Network failure: leave the card showing what the server still holds.
        return null;
      }
    };
  }

  /**
   * Adds the visual effects of validation to the small card (opaque button and fill color below image).
   * @param {?('Agree'|'Disagree'|'Unsure')} validationOption - The user's vote, or null once they've cleared it
   *     (#4653), which leaves the card with no option selected.
   */
  showValidationOnCard(validationOption) {
    const validationClass = ValidationMenu.#validationOptionToClass[validationOption] ?? null;

    // Remove the visual effects from the older validation.
    if (this.#currSelected && this.#currSelected !== validationClass) {
      this.#validationButtons[this.#currSelected].attr('class', 'validation-button');
      if (this.#galleryCard.hasClass(this.#currSelected)) {
        this.#galleryCard.removeClass(this.#currSelected);
      }
    }
    this.#currSelected = validationClass;
    // A vote changed from the expanded view makes the open question stale; a Disagree relayed back reopens nothing,
    // since that side has its own reason row.
    if (this.#reasonVote && this.#reasonVote !== validationOption) this.#closeReasons(false);

    // Add the visual effects from the new validation.
    if (validationClass) {
      this.#galleryCard.addClass(validationClass);
      this.#validationButtons[validationClass].attr('class', 'validation-button-selected');
    }

    // Reset thumb icons to outline state so that they don't blend into the background after validation.
    const valInfo = this.#refCard.validationInfoDisplay;
    if (valInfo) {
      valInfo.setVoteIconFilled('Agree', false);
      valInfo.setVoteIconFilled('Disagree', false);
    }
  }

  /**
   * Consolidate data on the validation and submit as a POST request.
   * @param {string} action - Validation result — the vote being cast, or the one being cleared when `undone`.
   * @param {boolean} thumbsClick - Whether the validation came from clicking the thumb icons.
   * @param {boolean} keyboardShortcut - Whether the validation came from a keyboard shortcut.
   * @param {boolean} [undone=false] - Clear the user's existing `action` vote rather than cast one (#4653).
   * @returns {Promise<Response>} Resolves with the server's response once the validation has been submitted.
   */
  #validateLabel(action, thumbsClick, keyboardShortcut, undone = false) {
    const refCard = this.#refCard;
    let actionStr;
    let sourceStr;
    if (thumbsClick) {
      actionStr = 'Validate_ThumbsMenuClick';
      sourceStr = 'GalleryThumbs';
    } else {
      actionStr = 'Validate_MenuClick';
      sourceStr = 'GalleryImage';
    }
    // A cleared vote leaves no label_validation row behind, so the event name is where it's recorded at all.
    actionStr += undone ? `Clear${action}` : action;
    if (keyboardShortcut) {
      actionStr = actionStr.replace('Click', 'KeyboardShortcut');
    }
    sg.tracker.push(
      actionStr, { panoId: refCard.getProperty('pano_id') }, { labelId: refCard.getProperty('label_id') },
    );

    const validationTimestamp = new Date();
    const labelIcon = refCard.labelIcon;
    const data = {
      label_id: refCard.getProperty('label_id'),
      label_type: refCard.getProperty('label_type'),
      validation_result: action,
      severity: refCard.getProperty('severity'),
      tags: refCard.getProperty('tags'),
      canvas_height: Math.round(this.#gsvImage.height()),
      canvas_width: Math.round(this.#gsvImage.width()),
      heading: refCard.getProperty('heading'),
      pitch: refCard.getProperty('pitch'),
      zoom: refCard.getProperty('zoom'),
      canvas_x: Math.round(labelIcon.offsetLeft + labelIcon.getBoundingClientRect().width / 2),
      canvas_y: Math.round(labelIcon.offsetTop + labelIcon.getBoundingClientRect().height / 2),
      start_timestamp: validationTimestamp,
      end_timestamp: validationTimestamp,
      source: sourceStr,
      undone,
      redone: !undone && refCard.getProperty('user_validation') !== null,
      viewer_type: refCard.getImageSource() === 'crop' ? 'StaticCrop' : 'StaticApi',
    };

    const isNewValidation = !undone && refCard.getProperty('user_validation') === null;
    // A first-time visitor browses the Gallery with no session (#4643), so a card vote can be their first-ever
    // write: lazyIdentityFetch mints the anonymous session on an auth-shaped failure and retries once (#4442).
    return util.lazyIdentityFetch('/labelmap/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((res) => {
      if (res.ok && isNewValidation) BadgeAchievements.recordValidation();
      return res;
    });
  }

  /** @returns {boolean} Whether a vote is one this card's type asks a reason for. */
  #reasonedVote(vote) {
    return util.validationReasons.hasReasons(this.#refCard.getLabelType(), vote);
  }

  /** @returns {boolean} Whether the reason popover is up. */
  get reasonsOpen() {
    return this.#reasonVote !== null;
  }

  /**
   * The signed-in user's own comment on this label, as the card payload carries it, or null.
   * @returns {?Record<string, any>}
   */
  #ownComment() {
    const comments = this.#refCard.getProperty('comments');
    return (Array.isArray(comments) ? comments : []).find((c) => c && typeof c === 'object' && c.mine) ?? null;
  }

  /** Builds the popover once: a close control, the shared chips, a typed-reason box, and a live status region. */
  #buildReasonPopover() {
    const popover = document.createElement('div');
    popover.className = 'gallery-card__reasons';
    popover.hidden = true;
    const dismiss = util.escapeHTML(i18next.t('common:validation-reason.dismiss'));
    const submit = util.escapeHTML(i18next.t('labelmap:comment'));
    const inputId = `gallery-card-reason-input-${this.#refCard.getProperty('label_id')}`;
    // A non-modal dialog: it takes focus, Escape closes it, and its name is the question; the chips inside are
    // their own named group, so the popover isn't a second group announcing the same prompt.
    popover.setAttribute('role', 'dialog');
    popover.tabIndex = -1;
    popover.innerHTML = `
      <button type="button" class="gallery-card__reasons-close" aria-label="${dismiss}">
        <img src="${util.assetPath('images/icons/cross.svg')}" alt="">
      </button>
      <div class="gallery-card__reasons-chips"></div>
      <div class="gallery-card__reasons-other">
        <label class="sr-only" for="${inputId}"></label>
        <input type="text" id="${inputId}" class="ps-input gallery-card__reasons-input" autocomplete="off">
        <button type="button" class="button-ps button--small button--primary gallery-card__reasons-submit" disabled>
          ${submit}
        </button>
      </div>
      <span class="gallery-card__reasons-status" role="status" aria-live="polite"></span>`;
    popover.querySelector('.gallery-card__reasons-close').addEventListener('click', () => {
      this.#log('ReasonMenu_Dismiss');
      this.#closeReasons(true);
    });
    this.#otherInput = popover.querySelector('.gallery-card__reasons-input');
    this.#otherSubmit = popover.querySelector('.gallery-card__reasons-submit');
    this.#otherInput.addEventListener('input', () => this.#syncOtherSubmit());
    this.#otherInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      this.#submitOtherReason(true);
    });
    // `detail === 0` is a click the keyboard produced, as on the chips.
    this.#otherSubmit.addEventListener('click', (e) => this.#submitOtherReason(e.detail === 0));
    this.#reasonChips = new ReasonChips(popover.querySelector('.gallery-card__reasons-chips'), {
      onPick: (id, viaKeyboard) => this.#pickReason(id, viaKeyboard),
      onOther: () => this.#otherInput.focus(),
      // Keyboard voters get the number keys too, but a grid card is mostly tapped, so the digits stay out of the
      // tooltips.
      showKeys: false,
      // The box sits right under the chips, so there is nothing for an "Other…" button to open.
      showOther: false,
    });
    this.#galleryCard[0].appendChild(popover);
    this.#reasonPopover = popover;
  }

  /**
   * Opens the popover for a vote that just landed, with the reason the user's own comment already records marked.
   * A type with no canned reasons opens nothing: the expanded view's box is the way to say why there.
   *
   * @param {'Disagree'|'Unsure'} vote
   * @param {?HTMLElement} opener - The control that cast the vote.
   * @param {boolean} viaPointer - The vote was a mouse or touch click.
   */
  #openReasons(vote, opener, viaPointer) {
    if (!this.#reasonPopover) this.#buildReasonPopover();
    clearTimeout(this.#reasonCloseTimer);
    const own = this.#ownComment();
    const count = this.#reasonChips.render({
      labelType: this.#refCard.getLabelType(),
      vote,
      selected: typeof own?.reason === 'string' ? own.reason : null,
    });
    if (count === 0) {
      this.#closeReasons(false);
      return;
    }
    // One question at a time: a second card's vote before this one answered would otherwise leave two popovers
    // both listening for the same digit.
    if (ValidationMenu.#openMenu && ValidationMenu.#openMenu !== this) ValidationMenu.#openMenu.#closeReasons(false);
    ValidationMenu.#openMenu = this;
    this.#reasonPopover.querySelector('.gallery-card__reasons-status').textContent = '';
    const promptKey = vote === 'Unsure' ? 'prompt-unsure' : 'prompt-disagree';
    this.#reasonPopover.setAttribute('aria-label', i18next.t(`common:validation-reason.${promptKey}`));
    const boxPrompt = i18next.t(vote === 'Unsure' ? 'labelmap:why-unsure-or' : 'labelmap:why-disagree-or');
    this.#otherInput.placeholder = boxPrompt;
    this.#reasonPopover.querySelector('.gallery-card__reasons-other label').textContent = boxPrompt;
    // A typed reason already on record comes back for editing; a canned one is shown by its chip instead.
    const typedReason = own && typeof own.reason !== 'string' && typeof own.comment === 'string';
    this.#otherInput.value = typedReason ? own.comment : '';
    this.#syncOtherSubmit();
    this.#reasonVote = vote;
    this.#reasonOpener = opener;
    this.#reasonPopover.hidden = false;
    this.#galleryCard.addClass('gallery-card--reasons-open');
    // Registered after the click that opened the popover has finished dispatching, so it isn't taken as the
    // outside click that closes it.
    setTimeout(() => {
      if (!this.reasonsOpen) return;
      document.addEventListener('click', this.#boundOutsideClick, true);
      document.addEventListener('keydown', this.#boundKeydown, true);
    }, 0);
    this.#galleryCard[0].addEventListener('pointerleave', this.#boundPointerLeave);
    // A pointer voter gets the dialog, not a chip: after a click on the unfocusable thumbs, a focused chip would
    // match :focus-visible and look hovered.
    if (viaPointer) this.#reasonPopover.focus();
    else this.#reasonChips.focus();
  }

  /**
   * Closes the popover, leaving the vote as it stands.
   * @param {boolean} returnFocus - Hand focus back to the control that cast the vote (not on an outside click,
   *     which has its own target).
   */
  #closeReasons(returnFocus) {
    clearTimeout(this.#reasonCloseTimer);
    document.removeEventListener('click', this.#boundOutsideClick, true);
    document.removeEventListener('keydown', this.#boundKeydown, true);
    this.#galleryCard[0].removeEventListener('pointerleave', this.#boundPointerLeave);
    if (!this.reasonsOpen) return;
    if (ValidationMenu.#openMenu === this) ValidationMenu.#openMenu = null;
    this.#reasonVote = null;
    this.#reasonPopover.hidden = true;
    this.#galleryCard.removeClass('gallery-card--reasons-open');
    const opener = this.#reasonOpener;
    this.#reasonOpener = null;
    if (returnFocus && opener?.isConnected) opener.focus();
  }

  #handleOutsideClick(e) {
    if (this.#reasonPopover.contains(e.target)) return;
    // A click on this card's own vote controls is a new vote, which reopens or closes the popover on its own
    // terms and is logged as that vote, not as a dismissal.
    const target = e.target instanceof Element ? e.target : null;
    const valInfo = this.#refCard.validationInfoDisplay;
    const onVoteControl = !!target && (this.#overlay[0].contains(target)
      || !!valInfo?.agreeContainer?.contains(target) || !!valInfo?.disagreeContainer?.contains(target));
    if (!onVoteControl) this.#log('ReasonMenu_Dismiss');
    this.#closeReasons(false);
  }

  /**
   * A mouse leaving the card closes the popover, so the question doesn't linger over the grid. It stays while a save
   * is landing (that closes it itself) and while the box has focus or a draft, so a nudged mouse can't lose typing.
   * Touch and pen have no hover; a tap elsewhere is their outside click.
   * @param {PointerEvent} e
   */
  #handlePointerLeave(e) {
    if (e.pointerType !== 'mouse' || this.#voteLocked) return;
    if (document.activeElement === this.#otherInput || this.#otherInput.value.trim() !== '') return;
    this.#log('ReasonMenu_Dismiss', false, 'MouseLeave');
    this.#closeReasons(false);
  }

  /** Escape closes; 1–N pick and N+1 moves to the box, the way the label card's number keys do (#5475). */
  #handleKeydown(e) {
    if (!this.reasonsOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.#log('ReasonMenu_Dismiss', true);
      this.#closeReasons(true);
      return;
    }
    // Digits typed into the reason box (or any other field) are words, not picks.
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1];
    if (digit && this.#reasonChips.pickByNumber(Number(digit))) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  /**
   * @param {string} id - The reason id.
   * @param {boolean} viaKeyboard - Picked with a number key (or Enter/Space on the chip).
   */
  #pickReason(id, viaKeyboard) {
    const text = util.validationReasons.text(id);
    if (!this.#reasonVote || !text || this.#voteLocked) return;
    this.#log(`${this.#reasonVote}Reason_Option=${id}`, viaKeyboard);
    this.#saveReason(text, id);
  }

  /** @param {boolean} viaKeyboard - Submitted with Enter, or Enter/Space on the button. */
  #submitOtherReason(viaKeyboard) {
    const text = this.#otherInput.value.trim();
    if (!this.#reasonVote || !text || this.#voteLocked) return;
    this.#log(`${this.#reasonVote}Reason_Other`, viaKeyboard);
    this.#saveReason(text, null);
  }

  /**
   * Records a reason as the user's comment on the label — the same POST the expanded view's box makes, with the
   * card's own point of view since the crop is a screenshot of it — then closes the popover once the outcome has
   * been seen landing.
   *
   * @param {string} text - The comment: a reason's text, or what was typed.
   * @param {?string} reason - The reason id, or null for a typed reason.
   */
  async #saveReason(text, reason) {
    const vote = this.#reasonVote;
    const refCard = this.#refCard;
    const pov = refCard.getProperty('pov');
    const data = {
      label_id: refCard.getProperty('label_id'),
      label_type: refCard.getLabelType(),
      comment: text,
      reason,
      pano_id: refCard.getProperty('pano_id'),
      heading: pov.heading,
      pitch: pov.pitch,
      zoom: pov.zoom,
      lat: refCard.getProperty('lat'),
      lng: refCard.getProperty('lng'),
    };
    const status = this.#reasonPopover.querySelector('.gallery-card__reasons-status');
    this.#setReasonBusy(true);
    // The vote must hold while its reason is written, or the server's delete-on-vote-change races the pick.
    this.#setVoteControlsLocked(true);
    try {
      const res = await util.lazyIdentityFetch('/labelmap/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // The server replaced the comment whether or not the popover is still up, so the card records it either way
      // — unless the vote moved meanwhile, in which case the server archived it again and the card must not show
      // it; only the popover's own feedback waits on it still being open with the same question.
      if (refCard.getProperty('user_validation') === vote) this.#recordOwnComment(text, reason, vote);
      if (this.#reasonVote !== vote) return;
      this.#reasonChips.setSelected(reason);
      // One comment per voter: a pick replaces a typed reason, and a typed one stays in its box.
      if (reason) this.#otherInput.value = '';
      this.#syncOtherSubmit();
      status.textContent = i18next.t('common:validation-reason.saved');
      // Focus goes back to the control that voted: the chips it was on are about to be hidden.
      this.#reasonCloseTimer = setTimeout(() => this.#closeReasons(true), ValidationMenu.REASON_CLOSE_DELAY_MS);
    } catch (err) {
      console.error(err);
      if (this.#reasonVote === vote) status.textContent = i18next.t('labelmap:comment-save-failed');
    } finally {
      this.#setReasonBusy(false);
      this.#setVoteControlsLocked(false);
    }
  }

  /** @param {boolean} busy - Whether a save is in flight. */
  #setReasonBusy(busy) {
    this.#reasonChips.setBusy(busy);
    this.#otherInput.readOnly = busy;
    this.#syncOtherSubmit();
  }

  #syncOtherSubmit() {
    this.#otherSubmit.disabled = this.#otherInput.readOnly || this.#otherInput.value.trim() === '';
  }

  /**
   * Holds the card's vote controls while a reason pick is in flight (#5475). The overlay buttons take `disabled`;
   * the thumbs are plain containers, so they get a class the click handlers check.
   * @param {boolean} locked
   */
  #setVoteControlsLocked(locked) {
    this.#voteLocked = locked;
    for (const button of Object.values(this.#validationButtons)) button.prop('disabled', locked);
    this.#galleryCard.toggleClass('gallery-card--vote-locked', locked);
  }

  /**
   * Mirrors the server's replace-my-comment onto the card's payload, so the expanded view opened next shows the
   * comment and marks the chip, and reopening this popover marks it too.
   *
   * @param {string} text - The comment, as posted.
   * @param {?string} reason - The reason id, or null for a typed reason.
   * @param {string} vote - The vote it explains.
   */
  #recordOwnComment(text, reason, vote) {
    const existing = this.#refCard.getProperty('comments');
    const comments = Array.isArray(existing) ? existing.filter((c) => !(c && typeof c === 'object' && c.mine)) : [];
    const own = this.#ownComment();
    const commenter = own?.commenter
      ?? comments.reduce((max, c) => Math.max(max, (c && c.commenter) ?? -1), -1) + 1;
    comments.push({ comment: text, reason, mine: true, time_created: new Date().toISOString(), commenter,
      validation: vote });
    this.#refCard.setProperty('comments', comments);
  }

  /**
   * Logs a reason-popover interaction the way this card's votes are logged, keyboard and pointer apart.
   * @param {string} action - The event name (see docs/logged-events.md).
   * @param {boolean} [viaKeyboard=false]
   * @param {string} [prefix] - The event's leading word, when it was neither a click nor a key.
   */
  #log(action, viaKeyboard = false, prefix = viaKeyboard ? 'KeyboardShortcut' : 'Click') {
    const refCard = this.#refCard;
    sg.tracker.push(
      `${prefix}_${action}`,
      { panoId: refCard.getProperty('pano_id') },
      { labelId: refCard.getProperty('label_id') },
    );
  }
}
