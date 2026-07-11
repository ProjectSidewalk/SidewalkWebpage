/**
 * Creates the label search UI on both /admin/label and /admin's Label Search tab.
 */
class AdminLabelSearch {
  #labelPopup;
  #source;

  /**
   * @param {boolean} isAdmin - Whether the current user is an admin.
   * @param {LabelPopup} labelPopup - Popup that displays a searched-for label.
   * @param {string} source - UI holding the search, one of 'LabelSearchPage' or 'AdminLabelSearchTab'.
   */
  constructor(isAdmin, labelPopup, source) {
    this.#labelPopup = labelPopup;
    this.#source = source;

    const input = document.getElementById('form-control-input');

    // Search runs via JS, so keep the wrapping form from submitting/refreshing the page.
    input.closest('form')?.addEventListener('submit', (e) => e.preventDefault());

    // Show the label on Enter, and stop the keypress from submitting/refreshing the page.
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.#labelPopup.showLabel(input.value, this.#source);
        e.preventDefault();
      }
    });

    document.getElementById('submit').addEventListener('click', async () => {
      await this.#labelPopup.showLabel(input.value, this.#source);
    });
  }
}
