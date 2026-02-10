
/**
 * An object that creates a display for the severity.
 *
 * @param {HTMLElement} container The DOM element that contains the display
 * @param {number} agreeCount The agree count to display
 * @param {number} disagreeCount The disagree count to display
 * @param {string} aiValidation Either 'Agree' or 'Disagree', showing AI validation if there is any
 * @param {boolean} isExpandedView a toggle to determine if this ValidationInfoDisplay is in expanded view, or in a card
 * @returns {ValidationInfoDisplay} the generated object
 */
function ValidationInfoDisplay(container, agreeCount, disagreeCount, aiValidation, isExpandedView=false) {
    const self = this;
    self.agreeCount = agreeCount;
    self.disagreeCount = disagreeCount;
    self.validationContainer = container;

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

        // Create the agree icon and tooltip.
        let agreeIcon = isExpandedView ? new Image() : document.createElement('img');
        agreeIcon.className = 'validation-info-image';
        agreeIcon.src = 'assets/javascripts/SVLabel/img/misc/thumbs_up.png';
        agreeIcon.setAttribute('data-toggle', 'tooltip');
        agreeIcon.setAttribute('data-placement', 'top');
        agreeIcon.setAttribute('title', `${i18next.t("common:agree")}`);
        $(agreeIcon).tooltip('hide');
        agreeCountContainer.appendChild(agreeIcon);

        // Create the disagree icon and tooltip.
        let disagreeIcon = isExpandedView ? new Image() : document.createElement('img');
        disagreeIcon.className = 'validation-info-image';
        disagreeIcon.classList.add('validation-info-thumbs-down');
        disagreeIcon.src = 'assets/javascripts/SVLabel/img/misc/thumbs_down.png';
        disagreeIcon.setAttribute('data-toggle', 'tooltip');
        disagreeIcon.setAttribute('data-placement', 'top');
        disagreeIcon.setAttribute('title', `${i18next.t("common:disagree")}`);
        $(disagreeIcon).tooltip('hide');
        disagreeCountContainer.appendChild(disagreeIcon);

        // Create the AI overlay icon and tooltip if there has been an AI validation.
        if (['Agree', 'Disagree'].includes(aiValidation)) {
            let aiIcon = isExpandedView ? new Image() : document.createElement('img')
            aiIcon.className = 'ai-icon';
            aiIcon.src = '/assets/images/icons/ai-icon-transparent-small.png';
            aiIcon.alt = 'AI indicator';

            aiIcon.setAttribute('data-toggle', 'tooltip');
            aiIcon.setAttribute('data-placement', 'top');
            aiIcon.setAttribute('title', i18next.t('common:ai-disclaimer', { aiVal: aiValidation }));
            $(aiIcon).tooltip({
                // Custom template uses defaults, just adds ai-tooltip class to enforce a wider tooltip. Starting with
                // Bootstrap 4, we can use `customClass` instead of `template`.
                template: '<div class="tooltip ai-tooltip" role="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',
                container: 'body' // Ensures the tooltip isn't hidden behind the pano canvas element.
            }).tooltip('hide');

            // Add AI icon to the appropriate count container based on AI validation.
            if (aiValidation === 'Agree') {
                agreeCountContainer.appendChild(aiIcon);
            } else if (aiValidation === 'Disagree') {
                disagreeCountContainer.appendChild(aiIcon);
            }
        }

        // Create the agree and disagree count text elements.
        self.agreeText = document.createElement('div');
        self.agreeText.className = 'validation-info-count';
        agreeCountContainer.append(self.agreeText);

        self.disagreeText = document.createElement('div');
        self.disagreeText.className = 'validation-info-count';
        disagreeCountContainer.append(self.disagreeText);

        updateValCounts(self.agreeCount, self.disagreeCount);

        // Add all the severity circles to the DOM.
        self.agreeContainer.append(agreeCountContainer);
        self.disagreeContainer.append(disagreeCountContainer);

        holder.append(self.agreeContainer);
        holder.append(self.disagreeContainer);

        container.append(holder);
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
