
/**
 * An object that creates a display for the severity.
 * 
 * @param {HTMLElement} container The DOM element that contains the display
 * @param {Number} severity The severity to display
 * @param {Boolean} isModal a toggle to determine if this SeverityDisplay is in a modal, or in a card
 * @returns {SeverityDisplay} the generated object
 */
function SeverityDisplay(container, severity, labelType, isModal=false) {
    let self = this;
    self.severity = severity;
    self.severityContainer = container;

    // list of label types where severity ratings are not supported
    // if more unsupported label types are made, add them here!
    const unsupportedLabels = ['Occlusion', 'Signal'];

    let unsupported = unsupportedLabels.includes(labelType);

    let circles = [];
    function _init() {
        // Set the different classes and ids depending on whether the severity display is in a Modal or in a card.
        let severityCircleClass = isModal ? 'modal-severity-circle' : 'severity-circle';
        let selectedCircleID = /*isModal ? 'modal-current-severity' : */'current-severity';

        let holder = document.createElement('div');
        holder.className = 'label-severity-content';

        let title = document.createElement('div');
        title.className = 'label-severity-header';
        if (isModal) {
            // Add bold weight. Find better way to do this.
            title.classList.add('modal-severity-header');
            // centers tooltip
            holder.classList.add('modal-no-severity-box')
        }

        title.innerText = `${i18next.t("severity")}`;
        // if no severity rating, gray out title
        if (unsupported || !severity) {
            title.classList.add('no-severity-header')
        }
        container.append(title);

        // Highlight the correct severity.
        // We do so by darkening a number of circles from the left equal to the severity. For example, if the severity
        // is 3, we will darken the left 3 circles.
        for (let i = 1; i <= 5; i++) {
            let severityCircle = isModal ? new Image() : document.createElement('div');
            severityCircle.className = severityCircleClass;

            if (unsupported || !severity) {
                // create grayed out empty circles/smileys
                if (isModal) {
                    severityCircle.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${i}_gallery.png`;
                    severityCircle.classList.add('modal-no-severity');
                } else {
                    severityCircle.classList.add(severityCircleClass, 'no-severity-circle');
                }
                circles.push(severityCircle);
            } else {
                // create severity circle elements
                if (isModal) {
                    if (i <= severity) { // Filled in smileys
                        severityCircle.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${i}_inverted.png`;
                    } else { // Empty smileys
                        severityCircle.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${i}_gallery.png`;
                    }
                } else {
                    if (i <= severity) { // Fills in circles
                        severityCircle.id = selectedCircleID
                    }
                }
            }
            circles.push(severityCircle);
        }

        if (!severity) {
            // add tooltip if no severity level
            holder.setAttribute('data-toggle', 'tooltip');
            holder.setAttribute('data-placement', 'top');

            // change tooltip message depending on if the label is unsupported or user did not add severity rating
            if (unsupported){
                holder.setAttribute('title', `${i18next.t("unsupported")}`);
            } else {
                holder.setAttribute('title', `${i18next.t("no-severity")}`);
            }
            $(holder).tooltip('hide');
        }

        // Add all of the severity circles to the DOM.
        for (let i = 0; i < circles.length; i++) {
            holder.appendChild(circles[i]);
        }
        container.append(holder);
    }

    _init()
    return self;
}
