/**
 * The card shown over the label being validated: its type, rating, tags, and description.
 *
 * This is the same component as Explore's hover card — one Twirl template (views/components/labelCard.scala.html),
 * one stylesheet pair in public/css/components/, and one populator (js/common/LabelCardView.js), which this feeds from
 * Validate's own Label object (#4726/#4730). It replaced a parallel implementation that painted white text straight
 * onto the raw label color, which failed WCAG AA for every label type (1.68:1 to 2.75:1); the label color now lives
 * in the type icon and the surface is white.
 *
 * A validator judges a label rather than changing it, so there is no Delete or Edit here and the card is not itself a
 * click target the way Explore's is. The one exception is Expert Validate's type dropdown in the header, whose pick
 * is handed to the menu as if it came from the menu's own picker (#5409). LabelVisibilityControl owns showing,
 * hiding, and anchoring the card, and hosts the Hide-label toggle.
 *
 * For an AI-generated label the card also carries the "AI can make mistakes" disclaimer (#5359). It is here rather
 * than in a tooltip on the marker's AI badge because hovering the marker is what opens this card, and a badge tooltip
 * would open on top of it.
 */
class LabelCard {
  #card;
  #view;
  #shareWidget;
  /** @type {?string} The rendered label's type, for the share click's analytics note. */
  #labelType = null;
  /** @type {?LabelTypeDropdown} Expert Validate only (#5409). */
  #typeDropdown = null;

  constructor() {
    this.#card = $('#label-card');
    // No descriptionMaxLength: the description shows in full rather than truncated the way Explore's card does it.
    // Explore can afford to cut the text because clicking the label reopens the same description in an editable
    // field; here the card is the only place it appears, and it is often what tells a validator what the labeler
    // meant.
    this.#view = new LabelCardView(this.#card[0]);

    // Built once and re-pointed at each label in render(), the way LabelDetail does it. Every label Validate serves
    // came from the back end, so its id is always real and the button is never in a state where it can't work.
    const trigger = /** @type {HTMLButtonElement} */ (document.getElementById('label-card-share'));
    if (trigger && typeof ShareWidget !== 'undefined') {
      this.#shareWidget = new ShareWidget(trigger, {
        // The card is anchored to the label's marker, which can sit anywhere in the pano.
        fitToViewport: true,
        onDismiss: () => svv.labelVisibilityControl?.handlePopoverDismissed(),
      });
      trigger.addEventListener('click', () => {
        // Only the opening click, and carrying the label type so the note matches Explore's.
        if (this.#shareWidget.isOpen()) return;
        svv.tracker.push('Click_LabelCardShare', { labelType: this.#labelType });
      });
    }

    const typePopover = this.#card[0].querySelector('.label-type-popover');
    if (typePopover) {
      this.#typeDropdown = new LabelTypeDropdown(this.#card[0].querySelector('.label-hover-card__type-dropdown'),
        /** @type {HTMLElement} */ (typePopover), {
          onOpen: () => this.#prepareTypePicker(),
          onPick: (labelType) => svv.validationMenu.pickNewLabelType(labelType),
          onClose: () => svv.labelVisibilityControl?.handlePopoverDismissed(),
        });
      this.#typeDropdown.setEditable(true);
    }
  }

  /** @returns {boolean} Whether the picker may open; if so it has been logged and drawn for the current label. */
  #prepareTypePicker() {
    if (svv.labelContainer.dropInputWhileLoading('LabelType')) return false;
    const label = svv.labelContainer.getCurrentLabel();
    const ownType = label.getProperty('oldLabelType');
    const picked = label.getProperty('newLabelType');
    svv.tracker.push('Click_LabelCardTypeMenu', { labelType: ownType });
    this.#typeDropdown.picker.render({ current: ownType, selected: picked === ownType ? null : picked });
    return true;
  }

  /**
   * The card's hide timer waits on this: taking the card down under an open popover would take the choice away
   * mid-click.
   * @returns {boolean} Whether the share popover or the type dropdown is open.
   */
  isPopoverOpen() {
    return Boolean(this.#shareWidget?.isOpen() || this.#typeDropdown?.isOpen());
  }

  /**
   * Closes the card's popovers. Called when something takes the card away outright — the H key, a pan, a move to
   * the next label — since each popover is a child of the card and would otherwise be left invisible but still
   * open, which permanently blocks the hide timer that waits on isPopoverOpen().
   */
  closePopovers() {
    this.#shareWidget?.close();
    this.#typeDropdown?.setOpen(false);
  }

  /**
   * Closes the type dropdown and puts focus back on its button, for an Escape pressed inside it.
   * @returns {boolean} Whether it was open, so the caller knows whether the Escape is spent.
   */
  closeTypeDropdown() {
    if (!this.#typeDropdown?.isOpen()) return false;
    this.#typeDropdown.setOpen(false);
    this.#typeDropdown.button.focus();
    return true;
  }

  /**
   * Fills the card in for the given label. Called once per label, when it is rendered onto the pano.
   *
   * @param {Label} label - The label whose information the card should show.
   */
  render(label) {
    // Where the type, rating, and tags can be edited, the card shows what Submit would save rather than what the
    // labeler filed: a rating only means something under its own type, so an edit that leaves the two disagreeing
    // puts a reading on the card that cannot be true — "Quality: Good" on a Signal, which has no rating at all
    // (#5409). The menu's editors are drawn from these same properties, and an Undo restores them.
    const editable = Boolean(this.#typeDropdown);
    const labelType = editable ? label.getProperty('newLabelType') : label.getAuditProperty('labelType');
    const severity = editable ? label.getProperty('newSeverity') : label.getAuditProperty('severity');
    const tags = (editable ? label.getProperty('newTags') : label.getAuditProperty('tags')) ?? [];
    this.#labelType = labelType;

    // Tags arrive as raw back-end strings; the card shows their localized names.
    const typeName = this.#view.render({
      labelType,
      severity,
      tagNames: tags.map((tag) => i18next.t(`common:tag.${tag.replace(/:/g, '-')}`)),
      description: label.getAuditProperty('description'),
      aiGenerated: Boolean(label.getAuditProperty('aiGenerated')),
    });
    this.#typeDropdown?.setType(labelType);

    // Point the share control at this label's public permalink (#456). /label/:id renders the spotlight page and
    // serves the og:image that crawlers embed in the share card.
    if (this.#shareWidget) {
      const shareText = i18next.t('common:share.text', { labelType: typeName });
      this.#shareWidget.setTarget({
        url: `${window.location.origin}/label/${label.getAuditProperty('labelId')}`,
        title: shareText,
        text: shareText,
      });
    }
  }
}
