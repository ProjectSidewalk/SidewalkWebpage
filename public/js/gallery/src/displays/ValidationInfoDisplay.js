/**
 * An object that creates a display for the agree/disagree counts on a gallery card.
 */
class ValidationInfoDisplay {
  static #ICON_BASE = '/assets/images/icons/validation/';

  #aiValidation;
  #userValidation;
  #lockReason = null;

  /**
   * @param {HTMLElement} container The DOM element that contains the display.
   * @param {number} agreeCount The agree count to display.
   * @param {number} disagreeCount The disagree count to display.
   * @param {string} aiValidation Either 'Agree' or 'Disagree', showing AI validation if there is any.
   * @param {?string} userValidation The viewer's own vote on this label, or null if they haven't voted.
   */
  constructor(container, agreeCount, disagreeCount, aiValidation, userValidation) {
    this.agreeCount = agreeCount;
    this.disagreeCount = disagreeCount;
    this.validationContainer = container;
    this.#aiValidation = aiValidation;
    this.#userValidation = userValidation;

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
   * The icon carries no tooltip of its own; hovering it falls through to the one on its container, so the icon and
   * the count beside it explain the vote the same way.
   * @param {string} action 'Agree' or 'Disagree'.
   * @param {boolean} isAi Whether to use the AI variant of the icon.
   */
  #makeVoteIcon(action, isAi) {
    const icon = document.createElement('img');
    icon.className = 'validation-info-image';
    icon.src = `${ValidationInfoDisplay.#ICON_BASE}${action.toLowerCase()}-outline${isAi ? '-ai' : ''}.svg`;
    icon.alt = '';
    return icon;
  }

  /**
   * Writes each thumb's tooltip, in the same words the Label Detail card uses for the same vote (#4778): what
   * clicking does, how many validators have already voted that way, whether our AI's vote is among them, and — on
   * the option the viewer picked — that clicking again clears it. The two cards show the same counts, so a vote
   * that reads one way on the small card and another way on the expanded one is just two descriptions of one thing.
   *
   * A locked card (the viewer's own label) states that reason on both thumbs instead: none of the rest applies
   * when the thumbs can't be clicked.
   */
  #renderTooltips() {
    const containers = { Agree: this.agreeContainer, Disagree: this.disagreeContainer };
    const counts = { Agree: this.agreeCount, Disagree: this.disagreeCount };
    for (const [action, container] of Object.entries(containers)) {
      const count = counts[action];
      let tip = this.#lockReason;
      if (!tip) {
        const isVoted = this.#userValidation === action;
        if (isVoted) {
          // {{count}} is the *other* validators, so the viewer isn't double-counted in their own tooltip; the
          // i18next `_zero` key covers "nobody else" (see LabelDetail's #renderVoteTooltips for the full note).
          tip = i18next.t(`labelmap:vote-tooltip-voted-${action.toLowerCase()}`, { count: Math.max(0, count - 1) });
        } else {
          tip = i18next.t(`labelmap:vote-tooltip-${action.toLowerCase()}`, { count });
        }
        // Sentences are appended in order of usefulness, so what clicking *does* lands last.
        if (this.#aiValidation === action) tip += ` ${i18next.t('labelmap:vote-tooltip-ai-included')}`;
        if (isVoted) tip += ` ${i18next.t('labelmap:vote-tooltip-clear')}`;
      }
      container.setAttribute('data-ps-tooltip', tip);
    }
  }

  /**
   * Locks both thumbs' tooltips to a single reason, in place of the per-vote text.
   * @param {string} reason Why validating is blocked on this card.
   */
  setLockReason(reason) {
    this.#lockReason = reason;
    this.#renderTooltips();
  }

  /**
   * @param {number} agreeCount The agree count to display.
   * @param {number} disagreeCount The disagree count to display.
   * @param {?string} [userValidation] The viewer's vote once the change lands; omit to leave it as it was.
   */
  updateValCounts(agreeCount, disagreeCount, userValidation = this.#userValidation) {
    this.agreeCount = agreeCount;
    this.disagreeCount = disagreeCount;
    this.#userValidation = userValidation;
    this.agreeText.innerText = `${this.agreeCount}`;
    this.disagreeText.innerText = `${this.disagreeCount}`;
    this.#renderTooltips();
  }
}
