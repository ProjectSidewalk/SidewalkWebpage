/**
 * The public /stories page (#4688): community stories as a searchable/sortable card grid.
 *
 * Search/sort/dates come from CommunityListPage; this class adds the story-specific layer — label-type chip colors,
 * a "read more" toggle on clamped story text, and opening a story's label in the shared LabelPopup (with the
 * /labelMap?labelId= href as the no-JS/popup-failed fallback).
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
    document.querySelectorAll('.story-card__label-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        window.logWebpageActivity(`Click_module=StoryListPage_ViewLabel_LabelId=${link.dataset.labelId}`);
        if (!this.#labelPopup) return; // href fallback: navigate to the label on the LabelMap.
        e.preventDefault();
        this.#labelPopup.showLabel(Number(link.dataset.labelId), 'StoryListPage');
      });
    });
  }

  /**
   * @param {{showLabel: function(number, string): Promise}} popup - A LabelPopup instance.
   */
  setLabelPopup(popup) {
    this.#labelPopup = popup;
  }

  /** Tints each label-type chip with its canonical color (data-sourced; inline style attrs are lint-banned). */
  #colorTypeChips() {
    document.querySelectorAll('.community-chip--type[data-type-color]').forEach((chip) => {
      chip.style.borderColor = chip.dataset.typeColor;
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
