/**
 * An object that creates a display for the severity.
 */
class SeverityDisplay {
    #positive;
    #circles = [];

    /**
     * @param {HTMLElement} container The DOM element that contains the display.
     * @param {number} severity The severity to display.
     * @param {string} labelType
     */
    constructor(container, severity, labelType) {
        this.severity = severity;
        this.severityContainer = container;
        this.#positive = util.misc.isPositiveLabelType(labelType);

        this.#init();
    }

    #init() {
        const container = this.severityContainer;
        const severity = this.severity;

        const holder = document.createElement('div');
        holder.className = 'label-severity-content';

        const title = document.createElement('div');
        title.className = 'label-severity-header';

        title.innerText = i18next.t(this.#positive ? 'quality' : 'severity');
        // If no severity rating, gray out title.
        if (severity == null) {
            title.classList.add('no-severity-header');
        }
        container.append(title);

        // Highlight the correct severity.
        // We do so by darkening a number of circles from the left equal to the severity. For example, if the severity
        // is 2, we will darken the left 2 circles.
        for (let i = 1; i <= 3; i++) {
            const $severityCircle = $('<div></div>');
            $severityCircle.addClass('severity-circle');

            if (severity == null) {
                // Create grayed out empty circles.
                $severityCircle.addClass('no-severity-circle');
                this.#circles.push($severityCircle);
            } else {
                // Create severity circle elements.
                if (i <= severity) { // Fills in circles.
                    $severityCircle.attr('id', 'current-severity');
                }
            }
            this.#circles.push($severityCircle);
        }

        if (severity == null) {
            // Add tooltip indicating the user didn't add a severity rating for this label.
            holder.setAttribute('data-toggle', 'tooltip');
            holder.setAttribute('data-placement', 'top');
            holder.setAttribute('title', i18next.t(this.#positive ? 'no-quality' : 'no-severity'));
            $(holder).tooltip('hide');
        }

        // Add all of the severity circles to the DOM.
        for (let i = 0; i < this.#circles.length; i++) {
            $(holder).append($(this.#circles[i]));
        }
        container.append(holder);
    }
}
