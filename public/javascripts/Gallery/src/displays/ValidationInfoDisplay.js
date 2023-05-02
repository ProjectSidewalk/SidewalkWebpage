
/**
 * An object that creates a display for the severity.
 * 
 * @param {HTMLElement} container The DOM element that contains the display
 * @param {Number} agreeCount The agree count to display
 * @param {Number} disagreeCount The disagree count to display
 * @param {Boolean} isModal a toggle to determine if this SeverityDisplay is in a modal, or in a card
 * @returns {ValidationInfoDisplay} the generated object
 */
function ValidationInfoDisplay(container, agreeCount, disagreeCount, isModal=false) {
    let self = this;
    self.agreeCount = agreeCount;
    self.disagreeCount = disagreeCount;
    self.validationContainer = container;

    function _init() {
        let holder = document.createElement('div');
        holder.className = 'validation-info-content';

        self.agreeContainer = document.createElement('div');
        self.disagreeContainer = document.createElement('div');
        self.agreeContainer.className = 'validation-section-content';
        self.disagreeContainer.className = 'validation-section-content';

        self.agreeText = document.createElement('div');
        self.disagreeText = document.createElement('div');
        self.agreeText.className = 'validation-info-count';
        self.disagreeText.className = 'validation-info-count';

        let agreeCountContainer = document.createElement('div');
        let disagreeCountContainer = document.createElement('div');
        agreeCountContainer.className = 'validation-info-count-container';
        disagreeCountContainer.className = 'validation-info-count-container';

        let agreeIcon = isModal ? new Image() : document.createElement('img');
        let disagreeIcon = isModal ? new Image() : document.createElement('img');
        agreeIcon.className = 'validation-info-image';
        disagreeIcon.className = 'validation-info-image';
        disagreeIcon.classList.add('validation-info-thumbs-down');

        agreeIcon.src = 'assets/javascripts/SVLabel/img/misc/thumbs_up.png';
        disagreeIcon.src = 'assets/javascripts/SVLabel/img/misc/thumbs_down.png';

        agreeCountContainer.appendChild(agreeIcon);
        disagreeCountContainer.appendChild(disagreeIcon);

        updateValCounts(self.agreeCount, self.disagreeCount);

        agreeCountContainer.append(self.agreeText);
        disagreeCountContainer.append(self.disagreeText);

        // Add tooltip labels
        self.agreeContainer.setAttribute('data-toggle', 'tooltip');
        self.agreeContainer.setAttribute('data-placement', 'top');
        self.agreeContainer.setAttribute('title', `${i18next.t("gallery:agree")}`);
        $(self.agreeContainer).tooltip('hide');

        self.disagreeContainer.setAttribute('data-toggle', 'tooltip');
        self.disagreeContainer.setAttribute('data-placement', 'top');
        self.disagreeContainer.setAttribute('title', `${i18next.t("gallery:disagree")}`);
        $(self.disagreeContainer).tooltip('hide');

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
