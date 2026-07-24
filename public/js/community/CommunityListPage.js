/**
 * Shared behavior for the /stories and /routes community listing pages (#4688).
 *
 * The cards are server-rendered; this class adds the client-side layer: free-text search across each card's text,
 * sorting via the cards' data-* keys, a visible-count live region, and timezone-correct dates (the server can only
 * render dates in UTC, which shows tomorrow's date for anything saved in the evening west of Greenwich).
 */
class CommunityListPage {
  #pageName;
  #sortKeys;
  #listEl;
  #searchEl;
  #sortEl;
  #countEl;
  #noResultsEl;
  #cards = [];
  #searchLogged = false;

  /**
   * @param {string} pageName - Activity-log prefix for this page (e.g. 'StoryListPage').
   * @param {Object<string, {key: string, numeric?: boolean, desc?: boolean}>} sortKeys - For each sort <option>
   *        value, which card data-* key to sort on and how. Ties always break newest-first.
   */
  constructor(pageName, sortKeys) {
    this.#pageName = pageName;
    this.#sortKeys = sortKeys;
    this.#listEl = document.getElementById('community-cards');
    this.#searchEl = document.getElementById('community-search');
    this.#sortEl = document.getElementById('community-sort');
    this.#countEl = document.getElementById('community-count');
    this.#noResultsEl = document.getElementById('community-no-results');
  }

  /** The page's cards, in current DOM order. @returns {Array<HTMLElement>} */
  get cards() {
    return this.#cards;
  }

  /** Attaches search/sort/date behavior. Safe to call on an empty page (the toolbar isn't rendered then). */
  init() {
    if (!this.#listEl) return;
    this.#cards = Array.from(this.#listEl.querySelectorAll('.community-card'));
    this.#localizeDates();
    this.#updateCount(this.#cards.length);

    this.#searchEl.addEventListener('input', () => {
      this.#applySearch();
      // Log that search was used (never what was typed), once per page view.
      if (!this.#searchLogged) {
        this.#searchLogged = true;
        window.logWebpageActivity(`Click_module=${this.#pageName}_Search`);
      }
    });
    this.#sortEl.addEventListener('change', () => {
      this.#applySort();
      window.logWebpageActivity(`Click_module=${this.#pageName}_Sort=${this.#sortEl.value}`);
    });
  }

  /** Rewrites each card's server-rendered UTC date into the reader's own timezone/locale. */
  #localizeDates() {
    this.#listEl.querySelectorAll('.community-date').forEach((el) => {
      const dt = new Date(el.dateTime);
      if (!Number.isNaN(dt.getTime())) el.textContent = moment(dt).format('ll');
    });
  }

  /** Hides cards whose text doesn't contain the query and updates the count / no-results state. */
  #applySearch() {
    const query = this.#searchEl.value.trim().toLowerCase();
    let visible = 0;
    for (const card of this.#cards) {
      const match = query === '' || card.textContent.toLowerCase().includes(query);
      card.hidden = !match;
      if (match) visible += 1;
    }
    this.#updateCount(visible);
    this.#noResultsEl.hidden = visible > 0;
  }

  /** Reorders the cards in the DOM per the sort select. */
  #applySort() {
    const spec = this.#sortKeys[this.#sortEl.value];
    if (!spec) return;
    const value = (card) => (spec.numeric ? Number(card.dataset[spec.key]) : card.dataset[spec.key]);
    const sorted = [...this.#cards].sort((a, b) => {
      let cmp;
      if (spec.numeric) {
        cmp = value(a) - value(b);
      } else {
        cmp = String(value(a)).localeCompare(String(value(b)), document.documentElement.lang);
      }
      if (spec.desc) cmp = -cmp;
      return cmp !== 0 ? cmp : Number(b.dataset.created) - Number(a.dataset.created); // Ties: newest first.
    });
    this.#listEl.append(...sorted);
    this.#cards = sorted;
  }

  /** @param {number} visible - How many cards are currently shown. */
  #updateCount(visible) {
    this.#countEl.textContent = this.#countEl.dataset.countTemplate.replace('{0}', visible);
  }
}
