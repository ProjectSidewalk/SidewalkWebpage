
/**
 * An object that creates a display for the agree/disagree counts on a gallery card.
 *
 * @param {HTMLElement} container The DOM element that contains the display
 * @param {number} agreeCount The agree count to display
 * @param {number} disagreeCount The disagree count to display
 * @param {string} aiValidation Either 'Agree' or 'Disagree', showing AI validation if there is any
 * @returns {ValidationInfoDisplay} the generated object
 */
function ValidationInfoDisplay(container, agreeCount, disagreeCount, aiValidation) {
    const self = this;
    self.agreeCount = agreeCount;
    self.disagreeCount = disagreeCount;
    self.validationContainer = container;

    const ICON_BASE = '/assets/images/icons/validation/';

    function _init() {
        let holder = document.createElement('div');
        holder.className = 'validation-info-content';

        // Create outer container for agree and disagree sections.
        self.agreeContainer = document.createElement('div');
        self.agreeContainer.className = 'validation-section-content';
        self.disagreeContainer = document.createElement('div');
        self.disagreeContainer.className = 'validation-section-content';

        // Create the agree and disagree count containers.
        let agreeCountContainer = document.createElement('div');
        let disagreeCountContainer = document.createElement('div');
        agreeCountContainer.className = 'validation-info-count-container';
        disagreeCountContainer.className = 'validation-info-count-container';

        // Build the agree/disagree icons. There is a `-ai` variant of each icon.
        const agreeIcon = _makeVoteIcon('Agree', aiValidation === 'Agree');
        agreeCountContainer.appendChild(agreeIcon);

        const disagreeIcon = _makeVoteIcon('Disagree', aiValidation === 'Disagree');
        disagreeCountContainer.appendChild(disagreeIcon);

        // Create the agree and disagree count text elements.
        self.agreeText = document.createElement('div');
        self.agreeText.className = 'validation-info-count';
        agreeCountContainer.append(self.agreeText);

        self.disagreeText = document.createElement('div');
        self.disagreeText.className = 'validation-info-count';
        disagreeCountContainer.append(self.disagreeText);

        updateValCounts(self.agreeCount, self.disagreeCount);

        self.agreeContainer.append(agreeCountContainer);
        self.disagreeContainer.append(disagreeCountContainer);

        holder.append(self.agreeContainer);
        holder.append(self.disagreeContainer);

        container.append(holder);
    }

    /**
     * Builds an <img> for the agree/disagree vote icon, using the `-ai` variant when the AI validated this option.
     * @param action 'Agree' or 'Disagree'
     * @param isAi whether to use the AI variant of the icon
     */
    function _makeVoteIcon(action, isAi) {
        const icon = document.createElement('img');
        icon.className = 'validation-info-image';
        icon.src = `${ICON_BASE}${action.toLowerCase()}-outline${isAi ? '-ai' : ''}.svg`;
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

    function updateValCounts(agreeCount, disagreeCount) {
        self.agreeCount = agreeCount;
        self.disagreeCount = disagreeCount;
        self.agreeText.innerText = `${self.agreeCount}`;
        self.disagreeText.innerText = `${self.disagreeCount}`;
    }

    self.updateValCounts = updateValCounts;

    _init()
    return self;
}
