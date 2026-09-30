/**
 * An object that creates a display for the severity.
 */
class SeverityDisplay {
  #positive;
  #labelType;
  #circles = [];

  /**
   * @param {HTMLElement} container - The DOM element that contains the display.
   * @param {number} severity - The severity to display.
   * @param {string} labelType
   */
  constructor(container, severity, labelType) {
    this.severity = severity;
    this.severityContainer = container;
    this.#labelType = labelType;
    this.#positive = util.misc.isPositiveLabelType(labelType);

    this.#init();
  }

  #init() {
    const container = this.severityContainer;
    const severity = this.severity ?? null;

    const holder = document.createElement('div');
    holder.className = 'label-severity-content';

    const title = document.createElement('div');
    title.className = 'label-severity-header';

    const titleText = i18next.t(this.#positive ? 'quality' : 'severity');
    title.innerText = titleText;
    // If no severity rating, gray out title.
    if (severity === null) {
      title.classList.add('no-severity-header');
    }
    container.append(title);

    // Highlight the correct severity.
    // We do so by darkening a number of circles from the left equal to the severity. For example, if the severity
    // is 2, we will darken the left 2 circles.
    for (let i = 1; i <= 3; i++) {
      const severityCircle = document.createElement('div');
      severityCircle.className = 'severity-circle';

      if (severity === null) {
        // Create grayed out empty circles.
        severityCircle.classList.add('no-severity-circle');
      } else if (i <= severity) {
        // Fill in a number of circles from the left equal to the severity.
        severityCircle.classList.add('current-severity');
      }
      this.#circles.push(severityCircle);
    }

    const noRating = i18next.t(this.#positive ? 'no-quality' : 'no-severity');
    if (severity === null) {
      // Add tooltip indicating the user didn't add a severity rating for this label.
      holder.setAttribute('data-ps-tooltip', noRating);
    }

    // The circles are purely visual, so screen readers get the rating as words instead ("Severity: High"). The
    // heading is hidden from them since that label already starts with it.
    const levelKey = severity === null ? undefined : util.misc.getRatingLevelKeys(this.#labelType)[severity];
    const spokenRating = levelKey ? `${titleText}: ${i18next.t(`common:${levelKey}`)}` : noRating;
    holder.setAttribute('role', 'img');
    holder.setAttribute('aria-label', spokenRating);
    if (levelKey) title.setAttribute('aria-hidden', 'true');

    // Add all of the severity circles to the DOM.
    holder.append(...this.#circles);
    container.append(holder);
  }
}
