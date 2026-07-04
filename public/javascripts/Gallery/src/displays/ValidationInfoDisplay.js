/**
 * An object that creates a display for the agree/disagree counts on a gallery card.
 */
class ValidationInfoDisplay {
  static #ICON_BASE = '/assets/images/icons/validation/';

  #aiValidation;

  /**
     * @param {HTMLElement} container The DOM element that contains the display.
     * @param {number} agreeCount The agree count to display.
     * @param {number} disagreeCount The disagree count to display.
     * @param {string} aiValidation Either 'Agree' or 'Disagree', showing AI validation if there is any.
     */
  constructor(container, agreeCount, disagreeCount, aiValidation) {
    this.agreeCount = agreeCount;
    this.disagreeCount = disagreeCount;
    this.validationContainer = container;
    this.#aiValidation = aiValidation;

    this.#init();
  }

  #init() {
    const container = this.validationContainer;
    const holder = document.createElement('div');
    holder.className = 'validation-info-content';

    // Create outer container for agree and disagree sections.
    this.agreeContainer = document.createElement('div');
    this.agreeContainer.className = 'validation-section-content';
    this.disagreeContainer = document.createElement('div');
    this.disagreeContainer.className = 'validation-section-content';

    // Create the agree and disagree count containers.
    const agreeCountContainer = document.createElement('div');
    const disagreeCountContainer = document.createElement('div');
    agreeCountContainer.className = 'validation-info-count-container';
    disagreeCountContainer.className = 'validation-info-count-container';

    // Build the agree/disagree icons. There is a `-ai` variant of each icon.
    const agreeIcon = this.#makeVoteIcon('Agree', this.#aiValidation === 'Agree');
    agreeCountContainer.appendChild(agreeIcon);

    const disagreeIcon = this.#makeVoteIcon('Disagree', this.#aiValidation === 'Disagree');
    disagreeCountContainer.appendChild(disagreeIcon);

    // Create the agree and disagree count text elements.
    this.agreeText = document.createElement('div');
    this.agreeText.className = 'validation-info-count';
    agreeCountContainer.append(this.agreeText);

    this.disagreeText = document.createElement('div');
    this.disagreeText.className = 'validation-info-count';
    disagreeCountContainer.append(this.disagreeText);

    this.updateValCounts(this.agreeCount, this.disagreeCount);

    this.agreeContainer.append(agreeCountContainer);
    this.disagreeContainer.append(disagreeCountContainer);

    holder.append(this.agreeContainer);
    holder.append(this.disagreeContainer);

    container.append(holder);
  }

  /**
     * Builds an <img> for the agree/disagree vote icon, using the `-ai` variant when the AI validated this option.
     * @param {string} action 'Agree' or 'Disagree'.
     * @param {boolean} isAi Whether to use the AI variant of the icon.
     */
  #makeVoteIcon(action, isAi) {
    const icon = document.createElement('img');
    icon.className = 'validation-info-image';
    icon.src = `${ValidationInfoDisplay.#ICON_BASE}${action.toLowerCase()}-outline${isAi ? '-ai' : ''}.svg`;
    icon.alt = '';
    icon.setAttribute('data-toggle', 'tooltip');
    icon.setAttribute('data-placement', 'top');

    // Use AI disclaimer tooltip if there's an AI validation, otherwise just use the Agree/Disagree tooltip.
    if (isAi) {
      icon.setAttribute('title', i18next.t('common:ai-disclaimer', { aiVal: action }));
      ensureAiTooltip(icon);
    } else {
      icon.setAttribute('title', i18next.t(`common:${action.toLowerCase()}`));
      $(icon).tooltip('hide');
    }
    return icon;
  }

  updateValCounts(agreeCount, disagreeCount) {
    this.agreeCount = agreeCount;
    this.disagreeCount = disagreeCount;
    this.agreeText.innerText = `${this.agreeCount}`;
    this.disagreeText.innerText = `${this.disagreeCount}`;
  }
}
