/**
 * Fills in the shared label card — the read-only panel showing a label's type, rating, tags, and description.
 *
 * Explore's hover card and Validate's label card are the same component: one Twirl template
 * (views/components/labelCard.scala.html), one stylesheet pair (css/common/label-anchored-panel.css for the shell,
 * label-hover-card.css for the chip stack), and this class for the populate logic, so the two tools can't drift in
 * how a rating, tag pill, or description is presented (#4730). Each tool keeps what is genuinely its own: showing,
 * hiding, and anchoring the card, its action buttons, and its share control.
 *
 * The card element is reused for every label a tool shows, so render() fully overwrites the previous label's
 * state — nothing may survive behind a display:none.
 */
class LabelCardView {
  #icon;
  #type;
  #body;
  #severity;
  #severityIcon;
  #severityText;
  #notRated;
  #notRatedText;
  #tags;
  #description;
  #noInfo;
  #descriptionMaxLength;

  /**
   * @param {HTMLElement} card The card container rendered by views/components/labelCard.scala.html.
   * @param {Object} [options]
   * @param {?number} [options.descriptionMaxLength] Cut the description to this many characters, ellipsis included.
   *     Explore truncates because clicking the label reopens the full text in an editable field; Validate leaves
   *     this unset and shows the description whole, because there the card is the only place it appears.
   */
  constructor(card, { descriptionMaxLength = null } = {}) {
    this.#icon = card.querySelector('.label-hover-card__icon');
    this.#type = card.querySelector('.label-hover-card__type');
    this.#body = card.querySelector('.label-hover-card__body');
    this.#severity = card.querySelector('.label-hover-card__severity');
    this.#severityIcon = card.querySelector('.label-hover-card__severity-icon');
    this.#severityText = card.querySelector('.label-hover-card__severity-text');
    // Optional pieces: the template renders the not-rated nudge and the no-info line only for callers that ask.
    this.#notRated = card.querySelector('.label-hover-card__not-rated');
    this.#notRatedText = card.querySelector('.label-hover-card__not-rated-text');
    this.#tags = card.querySelector('.label-hover-card__tags');
    this.#description = card.querySelector('.label-hover-card__description');
    this.#noInfo = card.querySelector('.label-hover-card__no-info');
    this.#descriptionMaxLength = descriptionMaxLength;
  }

  /**
   * Renders a label into the card, overwriting whatever label was shown before.
   *
   * @param {Object} data Display-ready facts about the label.
   * @param {string} data.labelType The label type, in CamelCase (e.g. 'CurbRamp').
   * @param {?number} [data.severity] The label's 1-3 rating, or null when unrated.
   * @param {Array<string>} [data.tagNames] Localized, plain-text tag names.
   * @param {?string} [data.description] The labeler's free-text description.
   * @returns {string} The localized type name shown in the header, for callers that reuse it (share text).
   */
  render({ labelType, severity = null, tagNames = [], description = null }) {
    const typeName = i18next.t(`common:${util.camelToKebab(labelType)}`).replace('&shy;', '');
    this.#icon.src = util.misc.getIconImagePaths(labelType).iconImagePath;
    this.#type.textContent = typeName;

    // The rating chip names its dimension because the words don't stand alone: "Quality: Good" against
    // "Severity: High" also says which way each scale runs. getRatingLevelKeys has no entry for a missing rating
    // or for the N/A 0 in old data, so the lookup doubles as the has-a-rating test.
    const levelKey = severity === null ? undefined : util.misc.getRatingLevelKeys(labelType)[severity];
    if (levelKey) {
      const headerKey = util.misc.isPositiveLabelType(labelType) ? 'common:quality' : 'common:severity';
      this.#severityText.textContent = `${i18next.t(headerKey)}: ${i18next.t(`common:${levelKey}`)}`;
      this.#severityIcon.src = util.misc.getSmileyIconPath(severity, labelType, true);
      // Same wash the rating controls put behind the chosen level, so a rating is legible while scanning.
      const colors = util.misc.getSeverityLevelColors(severity, labelType);
      // Cleared rather than left in place when a level has no colors, so the chip can't inherit the last label's.
      if (colors) this.#severity.style.setProperty('--level-wash', colors.wash);
      else this.#severity.style.removeProperty('--level-wash');
      this.#severity.style.display = 'flex';
    } else {
      this.#severity.style.display = 'none';
    }

    // The not-rated nudge, on cards whose markup opts into it (Explore, where the labeler can still add the missing
    // rating). It asks for the dimension this type is actually rated on: the same 1-3 scale means opposite things
    // either side of util.misc.isPositiveLabelType, and asking a curb ramp for its "severity" names the wrong one.
    const showNotRated = Boolean(this.#notRated) && severity === null && util.misc.labelTypeHasSeverity(labelType);
    if (showNotRated) {
      const promptKey = util.misc.isPositiveLabelType(labelType) ? 'rate-quality-prompt' : 'rate-severity-prompt';
      this.#notRatedText.textContent = i18next.t(`audit:center-ui.context-menu.${promptKey}`);
    }
    if (this.#notRated) this.#notRated.style.display = showNotRated ? 'flex' : 'none';

    // Tags as static (non-interactive) pills, built as DOM nodes with textContent so the tag text stays inert.
    // Emptied unconditionally: a label with no tags must not keep the previous one's pills parked behind a
    // display:none.
    this.#tags.textContent = '';
    for (const name of tagNames) {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      const pillLabel = document.createElement('span');
      pillLabel.className = 'tag-pill__label';
      pillLabel.textContent = name;
      pill.appendChild(pillLabel);
      this.#tags.appendChild(pill);
    }
    this.#tags.style.display = tagNames.length > 0 ? 'flex' : 'none';
    // Rule above the tags only when a chip sits above them to be separated from.
    this.#tags.classList.toggle('label-hover-card__tags--divided', Boolean(levelKey) || showNotRated);

    const hasDescription = typeof description === 'string' && description.trim().length > 0;
    if (hasDescription) {
      this.#description.textContent = this.#descriptionMaxLength
        ? LabelCardView.#truncate(description, this.#descriptionMaxLength)
        : description;
    } else {
      this.#description.textContent = '';
    }
    this.#description.style.display = hasDescription ? 'inline' : 'none';

    // The empty state. Validate's markup carries a "no available information" line, since there the card is the
    // one place these facts would appear; Explore's collapses the body instead — the header alone reads fine over
    // a label whose context menu the user can always open.
    const hasBodyContent = Boolean(levelKey) || showNotRated || tagNames.length > 0 || hasDescription;
    if (this.#noInfo) this.#noInfo.style.display = hasBodyContent ? 'none' : 'inline';
    else this.#body.style.display = hasBodyContent ? 'flex' : 'none';

    return typeName;
  }

  /**
   * Truncates a string to the given length, appending an ellipsis if anything was cut.
   * @param {string} str
   * @param {number} maxLength
   * @returns {string}
   */
  static #truncate(str, maxLength) {
    const chars = [...str]; // Code points, so the cut can't land inside a surrogate pair (e.g. mid-emoji).
    return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join('').trimEnd()}…` : str;
  }
}
