/**
 * Inline tag editor for the label detail card (#2575).
 *
 * While open, it fills the card's tag area with every tag the label's type offers with the label's current tags
 * pressed. Toggling a tag that is mutually exclusive with a pressed. The host reads `selectedTags` when the user is
 * done and decides whether anything changed; the editor never talks to the server itself.
 */
class TagEditor {
  /** @type {?Promise<Map<string, Object[]>>} The city's tags grouped by label type; fetched once per page. */
  static #tagsByType = null;

  #container;
  #open = false;
  #labelType = null;
  /** @type {string[]} Pressed tags, in the order the label carried them plus toggles appended in click order. */
  #selected = [];

  /**
   * @param {HTMLElement} container - The element to render the toggle pills into (the card's tag area).
   */
  constructor(container) {
    this.#container = container;
  }

  /**
   * The city's tags, grouped by label type name. `/label/tags` is the same source Explore's context menu reads.
   * @returns {Promise<Map<string, Object[]>>}
   */
  static #loadTags() {
    if (!TagEditor.#tagsByType) {
      TagEditor.#tagsByType = fetch('/label/tags', { headers: { 'Content-Type': 'application/json' } })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((tags) => {
          const byType = new Map();
          for (const tag of tags) {
            if (!byType.has(tag.label_type)) byType.set(tag.label_type, []);
            byType.get(tag.label_type).push(tag);
          }
          return byType;
        })
        .catch((err) => {
          TagEditor.#tagsByType = null; // Let the next open retry rather than caching the failure.
          throw err;
        });
    }
    return TagEditor.#tagsByType;
  }

  /** @returns {boolean} */
  get isOpen() {
    return this.#open;
  }

  /** @returns {string[]} The tags currently pressed. */
  get selectedTags() {
    return [...this.#selected];
  }

  /**
   * Shows the toggle pills for a label type with the given tags pressed.
   *
   * @param {string} labelType - The label's type, which decides which tags are offered.
   * @param {string[]} currentTags - The label's tags as they stand.
   * @returns {Promise<void>} Resolves once the pills are rendered; rejects if the tag list couldn't be fetched.
   */
  async open(labelType, currentTags) {
    this.#open = true;
    this.#labelType = labelType;
    this.#selected = [...currentTags];
    const byType = await TagEditor.#loadTags();
    // The host may have paged to another label while the fetch was in flight.
    if (!this.#open || this.#labelType !== labelType) return;
    this.#render(byType.get(labelType) || []);
  }

  /**
   * Clears the pills and stops tracking toggles. The host re-renders the read-only tag list in their place.
   * @returns {string[]} The tags that were pressed when the editor closed.
   */
  close() {
    this.#open = false;
    this.#labelType = null;
    this.#container.replaceChildren();
    return this.selectedTags;
  }

  /**
   * @param {Object[]} tags - The tags offered for the label type, each `{tag, mutually_exclusive_with}`.
   */
  #render(tags) {
    const pills = new Map();
    const setPressed = (pill, pressed) => {
      pill.classList.toggle('tag-pill--active', pressed);
      pill.setAttribute('aria-pressed', String(pressed));
    };

    this.#container.replaceChildren();
    for (const tag of tags) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'tag-pill tag-pill--interactive';
      pill.dataset.tag = tag.tag;
      const label = document.createElement('span');
      label.className = 'tag-pill__label';
      label.textContent = i18next.t(`common:tag.${tag.tag.replace(/:/g, '-')}`);
      pill.appendChild(label);
      setPressed(pill, this.#selected.includes(tag.tag));

      pill.addEventListener('click', () => {
        const pressed = !this.#selected.includes(tag.tag);
        if (pressed) {
          // Pressing one of a mutually exclusive pair releases the other, as in Explore's context menu.
          const other = tag.mutually_exclusive_with;
          if (other && this.#selected.includes(other)) {
            this.#selected = this.#selected.filter((t) => t !== other);
            if (pills.has(other)) setPressed(pills.get(other), false);
          }
          this.#selected.push(tag.tag);
        } else {
          this.#selected = this.#selected.filter((t) => t !== tag.tag);
        }
        setPressed(pill, pressed);
      });

      pills.set(tag.tag, pill);
      this.#container.appendChild(pill);
    }
  }
}
