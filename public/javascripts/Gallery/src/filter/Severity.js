/**
 * A Severity module.
 */
class Severity {
    // UI elements of the severity container, image, and label.
    #severityElement = null;
    #severityImage = null;
    #severityLabel = null;
    #interactionEnabled = false;
    #currentLabelType;

    #properties = {
        severity: undefined,
    };

    // A boolean to see if the current severity filter is active.
    #filterActive;

    /**
     * @param {*} params Severity value: the string "null" for the N/A bucket, or "1"/"2"/"3" for rated.
     * @param {boolean} active A boolean to see if the current severity filter is active.
     * @param {string} labelType Current gallery label type (drives which smiley set to use).
     */
    constructor(params, active, labelType) {
        this.#currentLabelType = labelType;
        this.#filterActive = active;
        this.#init(params);
    }

    /**
     * Initialize Severity.
     *
     * @param {string} param Severity ("null" for N/A, "1"/"2"/"3" for rated).
     */
    #init(param) {
        this.#properties.severity = param;

        this.#severityElement = document.createElement('div');
        this.#severityElement.className = 'severity-button gallery-filter';

        this.#severityImage = $('<img class="severity-button__icon" alt="">')
            .attr('id', `severity-${this.#properties.severity}`);
        this.#updateIconSrc();

        this.#severityLabel = $('<span class="severity-button__label"></span>').text(this.#getLabelText());

        $(this.#severityElement).append(this.#severityImage).append(this.#severityLabel);

        // Toggle filter on click.
        this.#severityElement.onclick = this.handleOnClickCallback;
    }

    /**
     * Handles when severity is selected/deselected.
     */
    handleOnClickCallback = () => {
        if (this.#filterActive) {
            sg.tracker.push('SeverityUnapply', null, { Severity: this.#properties.severity });
            this.unapply();
        } else {
            sg.tracker.push('SeverityApply', null, { Severity: this.#properties.severity });
            this.apply();
        }

        sg.cardFilter.update();
    };

    /**
     * Icon filenames are keyed by a numeric severity (0..3). The "null" bucket reuses the sev-0 asset.
     */
    #severityNum() {
        return this.#properties.severity === 'null' ? 0 : Number(this.#properties.severity);
    }

    /**
     * Returns the i18n-resolved text for this severity's label shown under the icon.
     */
    #getLabelText() {
        if (this.#properties.severity === 'null') return i18next.t('labelmap:not-applicable-abbr');
        const key = util.misc.getRatingLevelKeys(this.#currentLabelType)[Number(this.#properties.severity)];
        return i18next.t(`common:${key}`);
    }

    #updateIconSrc() {
        this.#severityImage.attr('src', util.misc.getSmileyIconPath(this.#severityNum(), this.#currentLabelType, this.#filterActive));
    }

    /**
     * Update the label type that selects the smiley icon set (positive vs negative) and refresh the text label.
     * @param {string} newLabelType
     */
    setLabelType(newLabelType) {
        this.#currentLabelType = newLabelType;
        this.#updateIconSrc();
        if (this.#severityLabel) this.#severityLabel.text(this.#getLabelText());
    }

    /**
     * Applies a severity filter.
     */
    apply() {
        if (this.#interactionEnabled) {
            this.#filterActive = true;
            this.#updateIconSrc();
        }
    }

    /**
     * Unapplies a severity filter.
     */
    unapply() {
        if (this.#interactionEnabled) {
            this.#filterActive = false;
            this.#updateIconSrc();
        }
    }

    /**
     * Renders Severity in sidebar.
     *
     * @param {*} filterContainer UI element to render Severity in.
     */
    render(filterContainer) {
        filterContainer.append(this.#severityElement);
    }

    /**
     * Returns whether Severity is applied or not.
     */
    getActive() {
        return this.#filterActive;
    }

    /**
     * Returns severity value of Severity.
     */
    getSeverity() {
        return this.#properties.severity;
    }

    /**
     * Disables interaction with Severity.
     */
    disable() {
        this.#interactionEnabled = false;
    }

    /**
     * Enables interaction with Severity.
     */
    enable() {
        this.#interactionEnabled = true;
    }
}
