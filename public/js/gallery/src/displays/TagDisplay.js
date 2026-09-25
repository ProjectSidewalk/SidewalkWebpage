/**
 * An object that can display the tags of a label.
 */
class TagDisplay {
  #container;
  #tags;

  /**
   * @param {HTMLElement} container - The DOM element to contain the label information.
   * @param {string[]} tags - The tags to display.
   */
  constructor(container, tags) {
    this.#container = container;
    this.#tags = tags;

    this.#init();
  }

  #init() {
    const container = this.#container;
    const tags = this.#tags;

    // Test to see if there are any tags left.
    if (tags.length > 0) {
      // Print the header of the Tags div.
      container.replaceChildren();
      const tagHeader = document.createElement('div');
      tagHeader.className = 'label-tags-header';

      tagHeader.innerText = `${i18next.t('tags')}`;
      container.append(tagHeader);

      const tagContainer = document.createElement('div');
      tagContainer.className = 'label-tags-holder';
      container.append(tagContainer);

      const orderedTags = this.#orderTags(tags);
      const tagsText = orderedTags.map((t) => i18next.t(`tag.${t}`));

      // Every pill is built and attached before anything is measured. A pill's width is set by the holder, which
      // flex sizes from its siblings rather than its contents, so no pill's width depends on the others — which
      // makes one batched read equivalent to measuring them one at a time, at a single layout instead of N.
      const tagEls = tagsText.map((text) => {
        const tagEl = document.createElement('div');
        tagEl.className = 'gallery-tag thumbnail-tag';
        tagEl.innerText = text;
        return tagEl;
      });
      tagContainer.append(...tagEls);

      // A pill has to keep a few characters ahead of its ellipsis to say which tag it is; any narrower and it reads
      // as nothing, so that width is the cutoff for showing the tag at all. Each cutoff is measured off a probe
      // carrying that tag's own opening characters, since the pill's padding, the card-relative font size, and the
      // script the tag is written in all feed it — and a cutoff fixed in px tracks none of them: on a phone-width
      // card it outgrows the entire tag budget, so every card falls back to a bare "+n" (#5009).
      const MIN_TAG_CHARS = 6;
      const minWidthProbes = tagsText.map((text) => {
        const probe = document.createElement('div');
        probe.className = 'gallery-tag thumbnail-tag';
        probe.innerText = `${[...text].slice(0, MIN_TAG_CHARS).join('')}…`;
        return probe;
      });
      tagContainer.append(...minWidthProbes);

      // The "+n" pill is measured rather than estimated, at the widest count it could end up carrying, so the space
      // held back for it is what the pill actually costs in this locale's font at this card's size. It is the row's
      // last child either way, so it stays put when the real count is filled in below.
      const overflowPill = document.createElement('div');
      overflowPill.className = 'gallery-tag additional-count';
      overflowPill.innerText = ` + ${tagsText.length}`;
      tagContainer.append(overflowPill);

      // The tags' share of the row is the holder's own width, read rather than derived from the container minus an
      // estimate of the header: the holder is the flex item that takes whatever the header leaves, so it already
      // accounts for the header's padding in every locale, however wide that locale writes "Tags".
      //
      // A pill's width is the full space it takes up in the row: its text plus its padding, border and margins. The
      // holder's width is the opposite: only the space inside it that pills can actually fill.
      const widthOf = (el) => {
        const style = getComputedStyle(el);
        return el.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
      };
      const holderStyle = getComputedStyle(tagContainer);
      let remainingWidth = tagContainer.getBoundingClientRect().width
        - parseFloat(holderStyle.paddingLeft) - parseFloat(holderStyle.paddingRight)
        - parseFloat(holderStyle.borderLeftWidth) - parseFloat(holderStyle.borderRightWidth);
      const tagWidths = tagEls.map(widthOf);
      const minTagWidths = minWidthProbes.map(widthOf);
      const widthForPlusN = widthOf(overflowPill);
      minWidthProbes.forEach((probe) => probe.remove());

      // Measured off a pill this card owns: a document-wide `.gallery-tag` lookup matches whichever card rendered
      // first, and matches nothing at all on the first card after a clear — where a missing margin turns the clamp
      // below into NaN, dropping the one thing keeping an ellipsized pill inside the card.
      const firstTagStyle = getComputedStyle(tagEls[0]);
      const MARGIN_BW_TAGS = parseFloat(firstTagStyle.marginLeft) + parseFloat(firstTagStyle.marginRight);

      const hiddenTags = [];
      for (let i = 0; i < tagsText.length; i++) {
        const tagEl = tagEls[i];

        // Only the last pill can spend the whole remainder: any earlier one has to leave the "+n" its width, since
        // a tag it pushes out is what puts "+n" there.
        const isLastTag = i === tagsText.length - 1;
        const reservedForPlusN = (isLastTag && hiddenTags.length === 0) ? 0 : widthForPlusN;

        if (remainingWidth > tagWidths[i] + reservedForPlusN) {
          // Show the entire tag if there is enough space.
          remainingWidth -= tagWidths[i];
        } else if (remainingWidth > minTagWidths[i] + reservedForPlusN) {
          // Show a tag abbreviated with an ellipsis if there's some space, just not enough for the full tag. The
          // pill is clamped to exactly the room it was given, so what is left over is the "+n" reserve — measuring
          // the clamped pill would spend a second layout to learn that.
          tagEl.style.maxWidth = `${remainingWidth - reservedForPlusN - MARGIN_BW_TAGS}px`;
          remainingWidth = reservedForPlusN;
          // Since we cut off with an ellipsis, add a tooltip with the full text.
          tagEl.title = tagsText[i];
        } else {
          // If the tag does not fit at all, add it to the list of hidden tags to show in the tooltip.
          tagEl.remove();
          tagEl.classList.add('not-added');
          hiddenTags.push(tagEl);
        }
      }

      // If there was not enough space to display all the tags, show the rest in a tooltip on the '+n' text.
      if (hiddenTags.length > 0) {
        overflowPill.innerText = ` + ${hiddenTags.length}`;
        overflowPill.setAttribute('data-ps-tooltip', hiddenTags.map((tag) => tag.outerHTML).join(''));
        overflowPill.setAttribute('data-ps-tooltip-theme', 'light');
      } else {
        overflowPill.remove();
      }
    }
  }

  /**
   * Orders tags by placing tags that match applied tags first.
   * @param {*} tags - Tags to order.
   * @returns {string[]} Ordered tag list.
   */
  #orderTags(tags) {
    let orderedTags = [];
    const appliedTags = sg.cardFilter.getAppliedTagNames();
    for (const tag of tags) {
      if (orderedTags.length === 0) {
        orderedTags.push(tag);
      } else if (appliedTags.includes(tag)) {
        // Prepend tag if it is a selected tag.
        orderedTags = [tag, ...orderedTags];
      } else {
        orderedTags.push(tag);
      }
    }
    return orderedTags;
  }
}
