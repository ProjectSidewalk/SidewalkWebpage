/**
 * A Validation Menu appended to a small Gallery Card for validation purposes.
 */

import i18next from 'i18next';
import { BadgeAchievements } from '../../common/BadgeAchievements.js';
import { ReasonChips } from '../../common/ReasonChips.js';
import { reasonPopover } from '../../common/ReasonPopover.js';
import { util } from '../../common/utilities.js';
import { validationReasons } from '../../common/validationReasons.js';
/** @typedef {import('../cards/Card.js').Card} Card */
/** @typedef {import('../displays/ValidationInfoDisplay.js').ValidationInfoDisplay} ValidationInfoDisplay */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class ValidationMenu {
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
  #tracker;
  #currSelected = null;
  #overlay;
  #validationButtons = undefined;
  #galleryCard;
  // A reason pick in flight holds the vote it explains: see #setVoteControlsLocked (#5475).
  #voteLocked = false;
  /** @type {() => void} Where "Other…" on the reason pop-up leads: the expanded view, with its comment box. */
  #onOtherReason;

  /**
   * @param {Card} referenceCard - The Card this menu belongs to.
   * @param {HTMLElement} gsvImage - The image holder to append the validation menu to.
   * @param {Tracker} tracker - Logs the vote.
   * @param {object} [hooks]
   * @param {() => void} [hooks.onOtherReason] - Called when "Other…" is chosen on the card's reason pop-up (#5475).
   */
  constructor(referenceCard, gsvImage, tracker, { onOtherReason = () => {} } = {}) {
    this.#refCard = referenceCard;
    this.#gsvImage = gsvImage;
    this.#tracker = tracker;
    this.#onOtherReason = onOtherReason;

    const cardOverlayHTML = `
      <div class="gallery-validation-button-holder">
        ${['agree', 'disagree', 'unsure'].map((option) => `
          <button class="validation-button gallery-card-${option}-button" aria-pressed="false">
            ${i18next.t(`common:${option}`)}
          </button>`).join('')}
      </div>`;
    const template = document.createElement('template');
    template.innerHTML = cardOverlayHTML;
    this.#overlay = template.content.firstElementChild;
    this.#galleryCard = gsvImage.parentElement;

    this.#init();
  }

  /**
   * Adds onClick functions for the validation buttons. Read-only for labels contributed by the current user.
   */
  #init() {
    const refCard = this.#refCard;
    this.#validationButtons = {
      'validate-agree': this.#overlay.querySelector('.gallery-card-agree-button'),
      'validate-disagree': this.#overlay.querySelector('.gallery-card-disagree-button'),
      'validate-unsure': this.#overlay.querySelector('.gallery-card-unsure-button'),
    };

    // If the signed-in user had already validated this label before loading the page, style the card.
    const userValidation = refCard.getProperty('user_validation');
    if (userValidation) {
      this.showValidationOnCard(userValidation);
    }

    const readonly = !!refCard.getProperty('from_current_user');
    if (readonly) {
      const tip = i18next.t('labelmap:own-label-disabled');
      this.#galleryCard.classList.add('gallery-card--readonly');

      // Disable validation buttons; skip attaching click handlers. The reason rides their holder rather than each
      // button, since a disabled button swallows the hover that would open a tooltip on it.
      for (const button of Object.values(this.#validationButtons)) button.disabled = true;
      this.#overlay.setAttribute('data-ps-tooltip', tip);

      // Same reason on the thumbs, in place of the vote text they'd otherwise carry.
      refCard.validationInfoDisplay.setLockReason(tip);
    } else {
      // Add onClick functions for the validation buttons.
      for (const [valKey, button] of Object.entries(this.#validationButtons)) {
        button.addEventListener('click', this.validateOnClickOrKeyPress(valKey, false, false));
        // Tells the open reason pop-up that a press here is a re-vote for it to follow, not a click outside (#5475).
        button.dataset.reasonAnchor = '';
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
    valInfoDisplay.agreeContainer.dataset.reasonAnchor = '';
    valInfoDisplay.disagreeContainer.dataset.reasonAnchor = '';
    // Focusable from script only, so the pop-up can hand focus back to the thumb it hangs off after a pick.
    valInfoDisplay.agreeContainer.tabIndex = -1;
    valInfoDisplay.disagreeContainer.tabIndex = -1;

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
   *     has been submitted, with the server's response, or null if the request never completed or was refused
   *     because a reason pick is still being written (#5475).
   */
  validateOnClickOrKeyPress(newValKey, thumbsClick, keyboardShortcut) {
    return async (e) => {
      if (this.#voteLocked) return null;
      const undone = this.#currSelected === newValKey;
      const validationOption = ValidationMenu.#classToValidationOption[newValKey];
      // The reason pop-up hangs off the control that cast the vote (#5475): the strip button, or the thumb's holder.
      const anchor = e?.currentTarget instanceof HTMLElement ? e.currentTarget : null;
      // Enter or Space on a strip button is a click with no pointer behind it; focus then belongs in the chips.
      const viaKeyboard = keyboardShortcut || (e instanceof MouseEvent && e.detail === 0);
      // Whatever the pop-up was asking about is about to change under it; it comes back on the new vote's success.
      if (reasonPopover().isOpenFor(this.#galleryCard)) reasonPopover().close();

      // #validateLabel has to run first: it reads the card's *previous* user_validation to set `redone` and to decide
      // whether this is a new validation worth a badge check.
      try {
        const previous = this.#refCard.getProperty('user_validation') ?? null;
        const res = await this.#validateLabel(validationOption, thumbsClick, keyboardShortcut, undone);
        // Restyle the card only once the server has taken the vote. Updating it up front would leave the card showing
        // a vote — or a cleared vote — that the backend never recorded, whenever the request fails.
        if (res.ok) {
          const current = undone ? null : validationOption;
          this.#refCard.updateUserValidation(current);
          this.#refCard.validationInfoDisplay?.animateVoteChange?.(previous, current);
          // Now that the vote is on record, ask why (#5475). After the POST rather than before it: a changed vote
          // deletes the user's comment server-side, so a pick racing the vote could be deleted by it.
          if (!undone && this.#reasonedVote(validationOption)) {
            this.#openReasons(validationOption, anchor, viaKeyboard);
          }
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

    // A vote that changed elsewhere (the expanded view) leaves a question up here about a vote that is gone.
    if (this.#currSelected !== validationClass && reasonPopover().isOpenFor(this.#galleryCard)) {
      reasonPopover().close();
    }

    // Remove the visual effects from the older validation.
    if (this.#currSelected && this.#currSelected !== validationClass) {
      this.#validationButtons[this.#currSelected].classList.remove('is-selected');
      this.#validationButtons[this.#currSelected].setAttribute('aria-pressed', 'false');
      this.#galleryCard.classList.remove(this.#currSelected);
    }
    this.#currSelected = validationClass;

    // Add the visual effects from the new validation.
    if (validationClass) {
      this.#galleryCard.classList.add(validationClass);
      this.#validationButtons[validationClass].classList.add('is-selected');
      this.#validationButtons[validationClass].setAttribute('aria-pressed', 'true');
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
    this.#tracker.push(
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
      canvas_height: this.#gsvImage.offsetHeight,
      canvas_width: this.#gsvImage.offsetWidth,
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

  // ───────────────────────────────────────────────────────────────────
  // One-tap reasons (#5475)
  // ───────────────────────────────────────────────────────────────────

  /**
   * @param {string} vote - 'Disagree' or 'Unsure'.
   * @returns {boolean} Whether this label's type offers canned reasons for the vote.
   */
  #reasonedVote(vote) {
    return validationReasons.hasReasons(this.#refCard.getLabelType(), vote);
  }

  /**
   * The signed-in user's own comment on this label, as the card payload carries it, or null.
   * @returns {?Record<string, any>}
   */
  #ownComment() {
    const comments = this.#refCard.getProperty('comments');
    return (Array.isArray(comments) ? comments : []).find((c) => c && typeof c === 'object' && c.mine) ?? null;
  }

  /**
   * Opens the reason pop-up for a vote that just landed, hung off the control that cast it, with the reason the
   * user's own comment already records marked. A type with no canned reasons opens nothing: the expanded view's
   * box is the way to say why there.
   *
   * @param {'Disagree'|'Unsure'} vote
   * @param {?HTMLElement} anchor - The control that cast the vote; the strip's button for it when unknown.
   * @param {boolean} viaKeyboard - The vote came from the keyboard, so focus moves into the chips.
   */
  #openReasons(vote, anchor, viaKeyboard) {
    const own = this.#ownComment();
    let selected = null;
    if (own) selected = typeof own.reason === 'string' ? own.reason : ReasonChips.OTHER;
    reasonPopover().open({
      anchor: anchor ?? this.#validationButtons[ValidationMenu.#validationOptionToClass[vote]],
      host: this.#galleryCard,
      labelType: this.#refCard.getLabelType(),
      vote,
      selected,
      viaKeyboard,
      onPick: (id, kb) => this.#pickReason(vote, id, kb),
      onOther: (kb) => {
        this.#log(`${vote}Reason_Other`, kb);
        this.#onOtherReason();
      },
      onDismiss: (via, kb) => this.#log('ReasonMenu_Dismiss', kb),
    });
  }

  /**
   * @param {string} vote - The vote the reason explains.
   * @param {string} id - The reason id, from the catalog.
   * @param {boolean} viaKeyboard - Picked with a number key (or Enter/Space on the chip) rather than a pointer.
   */
  #pickReason(vote, id, viaKeyboard) {
    const text = validationReasons.text(id);
    if (!text || this.#voteLocked) return;
    this.#log(`${vote}Reason_Option=${id}`, viaKeyboard);
    this.#saveReason(vote, text, id);
  }

  /**
   * Posts the reason as the user's comment on the label, the way the label card's comment box does, and mirrors it
   * onto the card's payload so the expanded view opened next shows it.
   *
   * @param {string} vote - The vote the reason explains.
   * @param {string} text - The reason's text in the reader's language, what the comment says.
   * @param {string} reason - The reason id.
   */
  async #saveReason(vote, text, reason) {
    const refCard = this.#refCard;
    const pov = refCard.getProperty('pov') ?? {};
    const data = {
      label_id: refCard.getProperty('label_id'),
      label_type: refCard.getLabelType(),
      comment: text,
      reason,
      pano_id: refCard.getProperty('pano_id'),
      heading: pov.heading ?? refCard.getProperty('heading'),
      pitch: pov.pitch ?? refCard.getProperty('pitch'),
      zoom: pov.zoom ?? refCard.getProperty('zoom'),
      lat: refCard.getProperty('camera_lat') ?? refCard.getProperty('lat'),
      lng: refCard.getProperty('camera_lng') ?? refCard.getProperty('lng'),
    };
    // The vote must hold while its reason is written, or the server's delete-on-vote-change races the pick.
    this.#setVoteControlsLocked(true);
    const popover = reasonPopover();
    const stillAsking = () => popover.isOpenFor(this.#galleryCard) && refCard.getProperty('user_validation') === vote;
    try {
      const res = await util.lazyIdentityFetch('/labelmap/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // The server replaced the comment whether or not the pop-up is still up, so the card records it either way,
      // unless the vote moved meanwhile, in which case the server archived it again and the card must not show it.
      if (refCard.getProperty('user_validation') === vote) this.#recordOwnComment(text, reason, vote);
      if (stillAsking()) popover.markSaved(reason);
    } catch (err) {
      console.error(err);
      if (stillAsking()) popover.markFailed();
    } finally {
      this.#setVoteControlsLocked(false);
    }
  }

  /**
   * Holds the vote controls while a reason pick is in flight (#5475). The pop-up's own chips lock with it.
   * @param {boolean} locked
   */
  #setVoteControlsLocked(locked) {
    this.#voteLocked = locked;
    for (const button of Object.values(this.#validationButtons)) button.disabled = locked;
    this.#galleryCard.classList.toggle('gallery-card--vote-locked', locked);
    if (reasonPopover().isOpenFor(this.#galleryCard)) reasonPopover().setBusy(locked);
  }

  /**
   * Mirrors the server's replace-my-comment onto the card's payload, in place, since the expanded view's label card
   * shares the very array: the expanded view opened next shows the comment and marks the chip, and reopening the
   * pop-up marks it too.
   *
   * @param {string} text - The comment, as posted.
   * @param {?string} reason - The reason id, or null for a typed reason.
   * @param {string} vote - The vote it explains.
   */
  #recordOwnComment(text, reason, vote) {
    const existing = this.#refCard.getProperty('comments');
    const comments = Array.isArray(existing) ? existing : [];
    const own = this.#ownComment();
    const commenter = own?.commenter
      ?? comments.reduce((max, c) => Math.max(max, (c && c.commenter) ?? -1), -1) + 1;
    for (let i = comments.length - 1; i >= 0; i -= 1) {
      const c = comments[i];
      if (c && typeof c === 'object' && c.mine) comments.splice(i, 1);
    }
    comments.push({ comment: text, reason, mine: true, time_created: new Date().toISOString(), commenter,
      validation: vote });
    this.#refCard.setProperty('comments', comments);
  }

  /**
   * @param {string} action - The event, after its `Click_` / `KeyboardShortcut_` prefix.
   * @param {boolean} [viaKeyboard=false]
   */
  #log(action, viaKeyboard = false) {
    const refCard = this.#refCard;
    this.#tracker.push(
      `${viaKeyboard ? 'KeyboardShortcut' : 'Click'}_${action}`,
      { panoId: refCard.getProperty('pano_id') },
      { labelId: refCard.getProperty('label_id') },
    );
  }
}
