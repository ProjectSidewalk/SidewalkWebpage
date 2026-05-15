/**
 * A Severity module.
 *
 * @param {*} params Severity value: the string "null" for the N/A bucket, or "1"/"2"/"3" for rated.
 * @param active A boolean to see if the current severity filter is active.
 * @param labelType Current gallery label type (drives which smiley set to use).
 * @returns {Severity}
 * @constructor
 */
function Severity (params, active, labelType) {
    const self = this;

    // UI elements of the severity container, image, and label.
    let severityElement = null;
    let $severityImage = null;
    let $severityLabel = null;
    let interactionEnabled = false;
    let currentLabelType = labelType;

    let properties = {
        severity: undefined
    };

    // A boolean to see if the current severity filter is active.
    let filterActive = active;

    /**
     * Initialize Severity.
     *
     * @param {string} param Severity ("null" for N/A, "1"/"2"/"3" for rated).
     */
    function _init(param) {
        properties.severity = param;

        severityElement = document.createElement('div');
        severityElement.className = 'severity-button gallery-filter';

        $severityImage = $('<img class="severity-button__icon" alt="">')
            .attr('id', 'severity-' + properties.severity);
        _updateIconSrc();

        $severityLabel = $('<span class="severity-button__label"></span>').text(_getLabelText());

        $(severityElement).append($severityImage).append($severityLabel);

        // Toggle filter on click.
        severityElement.onclick = handleOnClickCallback;
    }

    /**
     * Handles when severity is selected/deselected.
     */
    function handleOnClickCallback() {
        if (filterActive) {
            sg.tracker.push("SeverityUnapply", null, { Severity: properties.severity });
            unapply();
        } else {
            sg.tracker.push("SeverityApply", null, { Severity: properties.severity });
            apply();
        }

        sg.cardFilter.update();
    }

    /**
     * Icon filenames are keyed by a numeric severity (0..3). The "null" bucket reuses the sev-0 asset.
     */
    function _severityNum() {
        return properties.severity === 'null' ? 0 : Number(properties.severity);
    }

    /**
     * Returns the i18n-resolved text for this severity's label shown under the icon.
     */
    function _getLabelText() {
        if (properties.severity === 'null') return i18next.t('labelmap:not-applicable-abbr');
        const key = util.misc.getRatingLevelKeys(currentLabelType)[Number(properties.severity)];
        return i18next.t('common:' + key);
    }

    function _updateIconSrc() {
        $severityImage.attr('src', util.misc.getSmileyIconPath(_severityNum(), currentLabelType, filterActive));
    }

    /**
     * Update the label type used to pick the smiley icon set (positive vs negative) and refresh the text label.
     * @param {string} newLabelType
     */
    function setLabelType(newLabelType) {
        currentLabelType = newLabelType;
        _updateIconSrc();
        if ($severityLabel) $severityLabel.text(_getLabelText());
    }

    /**
     * Applies a severity filter.
     */
    function apply() {
        if (interactionEnabled) {
            filterActive = true;
            _updateIconSrc();
        }
    }

    /**
     * Unapplies a severity filter.
     */
    function unapply() {
        if (interactionEnabled) {
            filterActive = false;
            _updateIconSrc();
        }
    }

    /**
     * Renders Severity in sidebar.
     *
     * @param {*} filterContainer UI element to render Severity in.
     */
    function render(filterContainer) {
        filterContainer.append(severityElement);
    }

    /**
     * Returns whether Severity is applied or not.
     */
    function getActive(){
        return filterActive;
    }

    /**
     * Returns severity value of Severity.
     */
    function getSeverity() {
        return properties.severity;
    }

    /**
     * Disables interaction with Severity.
     */
    function disable() {
        interactionEnabled = false;
    }

    /**
     * Enables interaction with Severity.
     */
    function enable() {
        interactionEnabled = true;
    }

    self.handleOnClickCallback = handleOnClickCallback;
    self.apply = apply;
    self.unapply = unapply;
    self.getActive = getActive;
    self.getSeverity = getSeverity;
    self.render = render;
    self.disable = disable;
    self.enable = enable;
    self.setLabelType = setLabelType;

    _init(params);

    return this;
}
