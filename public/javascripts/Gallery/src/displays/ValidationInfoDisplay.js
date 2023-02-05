
/**
 * An object that creates a display for the severity.
 * 
 * @param {HTMLElement} container The DOM element that contains the display
 * @param {Number} agree The agree count to display
 * @param {Number} disagree The disagree count to display
 * @param {Boolean} isModal a toggle to determine if this SeverityDisplay is in a modal, or in a card
 * @returns {ValidationInfoDisplay} the generated object
 */
function ValidationInfoDisplay(container, agree, disagree, isModal=false) {
    let self = this;
    self.agree = agree;
    self.disagree = disagree;
    self.validationContainer = container;

    function _init() {
        let holder = document.createElement('div');
        holder.className = 'validation-info-content';

        let agreeContainer = document.createElement('div');
        let disagreeContainer = document.createElement('div');
        agreeContainer.className = 'validation-section-content';
        disagreeContainer.className = 'validation-section-content';

        let agreeText = document.createElement('div');
        let disagreeText = document.createElement('div');
        agreeText.className = 'validation-info-count';
        disagreeText.className = 'validation-info-count';

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

        agreeText.innerText = `${agree}`;
        disagreeText.innerText = `${disagree}`;

        agreeCountContainer.appendChild(agreeIcon);
        disagreeCountContainer.appendChild(disagreeIcon);

        agreeCountContainer.append(agreeText);
        disagreeCountContainer.append(disagreeText);

        // Add tooltip labels
        agreeContainer.setAttribute('data-toggle', 'tooltip');
        agreeContainer.setAttribute('data-placement', 'top');
        agreeContainer.setAttribute('title', `${i18next.t("gallery:agree")}`);
        $(agreeContainer).tooltip('hide');

        disagreeContainer.setAttribute('data-toggle', 'tooltip');
        disagreeContainer.setAttribute('data-placement', 'top');
        disagreeContainer.setAttribute('title', `${i18next.t("gallery:disagree")}`);
        $(disagreeContainer).tooltip('hide');

        // Add all of the severity circles to the DOM.
        agreeContainer.append(agreeCountContainer);
        disagreeContainer.append(disagreeCountContainer);

        holder.append(agreeContainer);
        holder.append(disagreeContainer);

        container.append(holder);
    }

    _init()
    return self;
}
