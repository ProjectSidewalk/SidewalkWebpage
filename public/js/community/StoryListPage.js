/**
 * The public /stories page (#4688): community stories as a searchable/sortable card grid.
 *
 * Search/sort/dates come from CommunityListPage; this class adds the story-specific layer — label-type chip colors,
 * a "read more" toggle on clamped story text, a per-card share chip pointed at the story-anchored label permalink
 * (#4722), and opening a story's label in the shared LabelPopup (with the /labelMap?labelId= href as the
 * no-JS/popup-failed fallback).
 */
class StoryListPage {
  #list;
  #labelPopup = null;

  constructor() {
    this.#list = new CommunityListPage('StoryListPage', {
      newest: { key: 'created', numeric: true, desc: true },
      neighborhood: { key: 'region' },
      labeltype: { key: 'labeltype' },
    });
  }

  init() {
    this.#list.init();
    this.#colorTypeChips();
    this.#addReadMoreToggles();
    this.#addShareChips();
    document.querySelectorAll('.story-card__location').forEach((link) => {
      link.addEventListener('click', () => {
        window.logWebpageActivity(`Click_module=StoryListPage_Location_LabelId=${link.dataset.labelId}`);
      });
    });
    document.querySelectorAll('.story-card__label-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        window.logWebpageActivity(`Click_module=StoryListPage_ViewLabel_LabelId=${link.dataset.labelId}`);
        if (!this.#labelPopup) return; // href fallback: navigate to the label on the LabelMap.
        e.preventDefault();
        this.#labelPopup.showLabel(Number(link.dataset.labelId), 'StoryListPage');
      });
    });
    this.#makeCardsClickable();
  }

  /**
   * @param {{showLabel: function(number, string): Promise}} popup - A LabelPopup instance.
   */
  setLabelPopup(popup) {
    this.#labelPopup = popup;
  }

  /**
   * Makes the whole story card open its label, exactly as clicking "View label" does — the card is one thing, so
   * anywhere on it should do the obvious thing (Jon, 2026-08-01).
   *
   * Three kinds of click are deliberately not navigations:
   *   - anything on the card's own controls (the location link, "View label", "read more", the share chip and the
   *     buttons in its popover) — those elements already do something more specific;
   *   - a click that ends a text selection, which is someone reading the story rather than leaving it;
   *   - the click that dismisses this card's open share menu. ShareWidget's outside-click listener runs on document
   *     in the capture phase, so by the time this bubbling handler sees the event the menu is already closed and
   *     `aria-expanded` is back to false — hence the flag, stamped at pointerdown while the menu is still up.
   *
   * Mouse affordance only: the card gains no role and no tabindex, because "View label" is already its keyboard and
   * screen-reader path to the same place, and a second one would put a redundant stop in every card's tab order.
   */
  #makeCardsClickable() {
    for (const card of this.#list.cards) {
      const link = card.querySelector('.story-card__label-link');
      if (!link) continue;
      card.classList.add('story-card--clickable');

      let shareWasOpen = false;
      card.addEventListener('pointerdown', () => {
        shareWasOpen = Boolean(card.querySelector('.label-detail__share-trigger[aria-expanded="true"]'));
      }, true);

      card.addEventListener('click', (e) => {
        if (shareWasOpen || e.target.closest('a, button')) return;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        window.logWebpageActivity(`Click_module=StoryListPage_Card_LabelId=${link.dataset.labelId}`);
        if (this.#labelPopup) this.#labelPopup.showLabel(Number(link.dataset.labelId), 'StoryListPage');
        else window.location.href = link.href; // Same fallback as the link itself: the label on the LabelMap.
      });
    }
  }

  /**
   * Adds a share chip to each story card's footer (#4722): the shared ShareWidget popover pointed at the
   * story-anchored label permalink (/label/:id?storyId=), which the share page uses to scroll to and highlight this
   * exact story. Share text leads with the storyteller's own words rather than the label-type boilerplate.
   */
  #addShareChips() {
    if (typeof ShareWidget === 'undefined') return; // Cards still work if the share script failed to load.
    for (const card of this.#list.cards) {
      const storyId = card.dataset.storyId;
      const labelId = card.querySelector('.story-card__label-link')?.dataset.labelId;
      const foot = card.querySelector('.story-card__foot');
      if (!storyId || !labelId || !foot) continue;

      const { wrap, trigger } = ShareWidget.buildChip('story-card__share');
      // Surface + story attribution for analytics; ShareWidget logs its own generic Share_* events on top.
      trigger.addEventListener('click', () => {
        window.logWebpageActivity(`Click_module=StoryCardShare_storyId=${storyId}`);
      });

      const widget = new ShareWidget(trigger, { host: wrap });
      const excerpt = StoryListPage.#excerpt(card.querySelector('.story-card__text').textContent);
      // escapeValue off: the text feeds only plain-text sinks (share intent URLs, mailto, the native sheet), so
      // i18next's default HTML-escaping would ship literal entities in the storyteller's words ("It&#39;s icy").
      const shareText = i18next.t('common:share.story-text', { excerpt, interpolation: { escapeValue: false } });
      widget.setTarget({
        url: `${window.location.origin}/label/${labelId}?storyId=${storyId}`,
        // The title feeds the native sheet and the email subject, so it carries the descriptive text, not "Share".
        title: shareText,
        text: shareText,
      });
      foot.appendChild(wrap);
    }
  }

  /**
   * The story's opening words, squeezed to share-text length: whitespace collapsed and cut at a word boundary near
   * the cap. Kept short deliberately — on Bluesky the permalink rides inside the 300-grapheme post text (see
   * ShareWidget), and the localized boilerplate around the excerpt needs room too.
   * @param {string} text - The story's full text.
   * @returns {string}
   */
  static #excerpt(text) {
    const CAP = 90;
    const clean = text.trim().replace(/\s+/g, ' ');
    if (clean.length <= CAP) return clean;
    const cut = clean.slice(0, CAP);
    // Break at the last word boundary unless it lands absurdly early (or nowhere — CJK text has no spaces).
    const lastSpace = cut.lastIndexOf(' ');
    return `${cut.slice(0, lastSpace > CAP - 30 ? lastSpace : CAP).trimEnd()}…`;
  }

  /** Tints each label-type chip with its canonical color (data-sourced; inline style attrs are lint-banned). */
  #colorTypeChips() {
    document.querySelectorAll('.community-chip--type[data-type-color]').forEach((chip) => {
      // '33' = 20% alpha on the canonical #RRGGBB color: a soft tag fill that keeps the text AA-readable.
      chip.style.backgroundColor = `${chip.dataset.typeColor}33`;
    });
  }

  /** Adds a "read more"/"read less" toggle to each story whose text overflows its clamped height. */
  #addReadMoreToggles() {
    const listEl = document.getElementById('community-cards');
    for (const card of this.#list.cards) {
      const text = card.querySelector('.story-card__text');
      if (text.scrollHeight <= text.clientHeight + 1) continue;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'story-card__read-more';
      toggle.textContent = listEl.dataset.readMore;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        const expanded = text.classList.toggle('is-expanded');
        toggle.textContent = expanded ? listEl.dataset.readLess : listEl.dataset.readMore;
        toggle.setAttribute('aria-expanded', String(expanded));
      });
      text.after(toggle);
    }
  }
}
