/**
 * The read-only card shown over the label being validated: its type, rating, tags, and description.
 *
 * This is the same component as Explore's hover card — .label-anchored-panel for the shell and .label-hover-card for
 * the chip stack, both in public/css/common/ — populated here from Validate's own Label object (#4726). It replaced a
 * parallel implementation that painted white text straight onto the raw label color, which failed WCAG AA for every
 * label type (1.68:1 to 2.75:1); the label color now lives in the type icon and the surface is white.
 *
 * Explicitly read-only: a validator judges a label, they don't change it, so there is no Delete or Edit here and the
 * card is not itself a click target the way Explore's is. LabelVisibilityControl owns showing, hiding, and anchoring
 * it, and hosts the one action it does carry — the Hide-label toggle.
 */
class LabelCard {
  #card;
  #icon;
  #type;
  #severity;
  #severityIcon;
  #severityText;
  #tags;
  #description;
  #noInfo;

  constructor() {
    this.#card = $('#label-card');
    this.#icon = $('#label-card-icon');
    this.#type = $('#label-card-type');
    this.#severity = $('#label-card-severity');
    this.#severityIcon = $('#label-card-severity-icon');
    this.#severityText = $('#label-card-severity-text');
    this.#tags = $('#label-card-tags');
    this.#description = $('#label-card-description');
    this.#noInfo = $('#label-card-no-info');

    // Mobile Validate ships no viewport meta tag, so the page lays out at the browser's ~980px legacy viewport and is
    // then scaled down to the screen — which leaves the card, sized for a desktop tool, unreadably small. Every
    // dimension in the card's CSS is calc(Npx * var(--ui-scale)), so one value here grows the padding, radius, type,
    // tail, and chips together. (Desktop gets its --ui-scale from util.applyToolScale on .tool-ui instead; that never
    // runs on mobile.) The device pixel ratio approximates the layout-to-screen shrink closely enough on phones, and
    // is what the box this replaced already keyed its frozen width and 30px font size off.
    if (util.isMobile()) {
      const scale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
      this.#card[0].style.setProperty('--ui-scale', scale.toFixed(4));
    }
  }

  /**
   * Fills the card in for the given label. Called once per label, when it is rendered onto the pano.
   *
   * @param {Label} label The label whose information the card should show.
   */
  render(label) {
    const labelType = label.getAuditProperty('labelType');
    const severity = label.getAuditProperty('severity');
    const description = label.getAuditProperty('description');
    const tags = label.getAuditProperty('tags');

    this.#icon.attr('src', util.misc.getIconImagePaths(labelType).iconImagePath);
    this.#type.text(i18next.t(`common:${util.camelToKebab(labelType)}`).replace('&shy;', ''));

    // The rating chip names its dimension because the words don't stand alone: "Quality: Good" against
    // "Severity: High" also says which way each scale runs. getRatingLevelKeys has no entry for a missing rating or
    // for the N/A 0, so the lookup doubles as the has-a-rating test.
    const levelKey = util.misc.getRatingLevelKeys(labelType)[severity];
    if (levelKey) {
      const headerKey = util.misc.isPositiveLabelType(labelType) ? 'common:quality' : 'common:severity';
      this.#severityText.text(`${i18next.t(headerKey)}: ${i18next.t(`common:${levelKey}`)}`);
      this.#severityIcon.attr('src', util.misc.getSmileyIconPath(severity, labelType, true));
      // Same wash the rating control puts behind the chosen level, so a rating is legible while scanning.
      const colors = util.misc.getSeverityLevelColors(severity, labelType);
      // Cleared rather than left in place when a level has no colors, so the chip can't inherit the last label's.
      if (colors) this.#severity[0].style.setProperty('--level-wash', colors.wash);
      else this.#severity[0].style.removeProperty('--level-wash');
      this.#severity.css('display', 'flex');
    } else {
      this.#severity.css('display', 'none');
    }

    // Tags as static (non-interactive) pills, built as DOM nodes with textContent so the tag text stays inert.
    // Emptied unconditionally: a label with no tags must not keep the previous one's pills parked behind a
    // display:none, since the card is rendered once per label and reused for every one of them.
    const hasTags = tags && tags.length > 0;
    this.#tags.empty();
    if (hasTags) {
      for (const tag of tags) {
        const pill = document.createElement('span');
        pill.className = 'tag-pill';
        const pillLabel = document.createElement('span');
        pillLabel.className = 'tag-pill__label';
        pillLabel.textContent = i18next.t(`common:tag.${tag.replace(/:/g, '-')}`);
        pill.appendChild(pillLabel);
        this.#tags.append(pill);
      }
      this.#tags.css('display', 'flex');
    } else {
      this.#tags.css('display', 'none');
    }
    // Rule above the tags only when a rating sits above them to be separated from.
    this.#tags.toggleClass('label-hover-card__tags--divided', Boolean(levelKey));

    // Shown in full rather than truncated the way Explore's card does it. Explore can afford to cut the text because
    // clicking the label reopens the same description in an editable field; here the card is the only place it
    // appears, and it is often what tells a validator what the labeler meant.
    const hasDescription = Boolean(description) && description.trim().length > 0;
    this.#description.text(hasDescription ? description : '');
    this.#description.css('display', hasDescription ? 'inline' : 'none');

    this.#noInfo.css('display', levelKey || hasTags || hasDescription ? 'none' : 'inline');
  }
}
