/**
 * The chevron in the pano's top-left corner on desktop Validate and the menu it opens under the hide-label toggle
 * (#5501). The less-used controls (for now, the Image adjustments pill) wait in the menu, as they do under Explore's
 * Stuck button, so the corner over the imagery stays uncluttered. CSS shows the menu from the chevron's
 * `aria-expanded`; this class only flips it, logs the toggle, and badges the chevron while a hidden control is active.
 *
 * Opening the image adjustments panel leaves the menu open, as on Explore, so the pill the panel is anchored to stays
 * on screen and focus has somewhere to return when the panel closes.
 *
 * Usage:
 *   const menu = new PanoControlMenu(document.getElementById('validate-control-buttons-toggle'), svv.tracker);
 *   menu.setCollapsedIndicator(true);
 */
class PanoControlMenu {
  /** @type {HTMLElement} */
  #toggle;

  /** @type {{push: (action: string, notes?: object) => void}} */
  #tracker;

  /**
   * @param {HTMLElement} toggle - The chevron; its `aria-controls` names the menu the CSS shows.
   * @param {{push: (action: string, notes?: object) => void}} tracker - Where the toggle is logged.
   */
  constructor(toggle, tracker) {
    this.#toggle = toggle;
    this.#tracker = tracker;
    this.#toggle.addEventListener('click', this.#handleToggle);
  }

  /** @returns {boolean} Whether the menu is showing. */
  isExpanded() {
    return this.#toggle.getAttribute('aria-expanded') === 'true';
  }

  /**
   * Badges the chevron while a control hidden behind it (the Image adjustments) is off its default, so a persisted
   * filter is visible with the menu closed. The shared CSS hides the badge once the menu is open.
   * @param {boolean} active
   */
  setCollapsedIndicator(active) {
    this.#toggle.classList.toggle('pano-overlay-button--active', active);
  }

  /**
   * Opens or closes the menu when the chevron is clicked.
   * @param {Event} e
   */
  #handleToggle = (e) => {
    e.preventDefault();
    const expanded = !this.isExpanded();
    this.#toggle.setAttribute('aria-expanded', String(expanded));
    this.#tracker.push('Click_PanoControlMenu_Toggle', { expanded });
  };
}
