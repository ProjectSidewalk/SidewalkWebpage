/**
 * The read-only card shown over the label being validated: its type, rating, tags, and description.
 *
 * This is the same component as Explore's hover card — one Twirl template (views/components/labelCard.scala.html),
 * one stylesheet pair in public/css/components/, and one populator (js/common/LabelCardView.js), which this feeds from
 * Validate's own Label object (#4726/#4730). It replaced a parallel implementation that painted white text straight
 * onto the raw label color, which failed WCAG AA for every label type (1.68:1 to 2.75:1); the label color now lives
 * in the type icon and the surface is white.
 *
 * Explicitly read-only: a validator judges a label, they don't change it, so there is no Delete or Edit here and the
 * card is not itself a click target the way Explore's is. LabelVisibilityControl owns showing, hiding, and anchoring
 * it, and hosts the one action it does carry — the Hide-label toggle.
 */
class LabelCard {
  #card;
  #view;
  #shareWidget;
  /** @type {?string} The rendered label's type, for the share click's analytics note. */
  #labelType = null;

  constructor() {
    this.#card = $('#label-card');
    // No descriptionMaxLength: the description shows in full rather than truncated the way Explore's card does it.
    // Explore can afford to cut the text because clicking the label reopens the same description in an editable
    // field; here the card is the only place it appears, and it is often what tells a validator what the labeler
    // meant.
    this.#view = new LabelCardView(this.#card[0]);

    // Built once and re-pointed at each label in render(), the way LabelDetail does it. Every label Validate serves
    // came from the back end, so its id is always real and the button is never in a state where it can't work.
    const trigger = document.getElementById('label-card-share');
    if (trigger && typeof ShareWidget !== 'undefined') {
      this.#shareWidget = new ShareWidget(trigger, {
        // The card is anchored to the label's marker, which can sit anywhere in the pano.
        fitToViewport: true,
        onDismiss: () => svv.labelVisibilityControl?.handleSharePopoverDismissed(),
      });
      trigger.addEventListener('click', () => {
        // Only the opening click, and carrying the label type so the note matches Explore's.
        if (this.#shareWidget.isOpen()) return;
        svv.tracker.push('Click_LabelCardShare', { labelType: this.#labelType });
      });
    }
  }

  /**
   * Whether the card's share popover is open. The card's hide timer waits on this — dismissing the card out from
   * under an open popover would take the choice away mid-click.
   * @returns {boolean}
   */
  isSharePopoverOpen() {
    return Boolean(this.#shareWidget?.isOpen());
  }

  /**
   * Closes the card's share popover. Called when something takes the card away outright — the H key, a pan, a move
   * to the next label — since the popover is a child of the card and would otherwise be left invisible but still
   * open, which permanently blocks the hide timer that waits on isSharePopoverOpen().
   */
  closeSharePopover() {
    this.#shareWidget?.close();
  }

  /**
   * Fills the card in for the given label. Called once per label, when it is rendered onto the pano.
   *
   * @param {Label} label The label whose information the card should show.
   */
  render(label) {
    const labelType = label.getAuditProperty('labelType');
    this.#labelType = labelType;

    // Tags arrive as raw back-end strings; the card shows their localized names.
    const tags = label.getAuditProperty('tags') ?? [];
    const typeName = this.#view.render({
      labelType,
      severity: label.getAuditProperty('severity'),
      tagNames: tags.map((tag) => i18next.t(`common:tag.${tag.replace(/:/g, '-')}`)),
      description: label.getAuditProperty('description'),
    });

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
