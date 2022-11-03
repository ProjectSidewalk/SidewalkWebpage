/**
 * A Severity module.
 *
 * @param {*} params Properties of severity.
 * @param active A boolean to see if the current severity filter is active.
 * @returns {Severity}
 * @constructor
 */
function Severity (params, active){
    let self = this;

    // UI element of the severity container and image.
    let severityElement = null;
    let severityImage = null;
    let interactionEnabled = false;

    let properties = {
        severity: undefined
    };

    // A boolean to see if the current severity filter is active.
    let filterActive = active;

    /**
     * Initialize Severity.
     *
     * @param {int} param Severity.
     */
    function _init(param) {
        properties.severity = param;

        severityElement = document.createElement('div');
        severityElement.className = 'severity-filter gallery-filter';

        severityImage = document.createElement('img');
        severityImage.className = 'severity-filter-image';
        severityImage.id = properties.severity;
        severityImage.innerText = properties.severity;
        if (filterActive) {
            _showSelected();
        } else {
            _showDeselected();
        }

        severityElement.appendChild(severityImage);

        // Show inverted smiley face on click or hover.
        severityElement.onclick = handleOnClickCallback;
        $(severityElement).hover(
            function() { _showSelected(); },
            function() { if (!filterActive) _showDeselected(); }
        );
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

        sg.cardContainer.updateCardsByTagsAndSeverity();
    }

    function _showSelected() {
        severityImage.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${properties.severity}_inverted_green.png`;
    }

    function _showDeselected() {
        severityImage.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${properties.severity}_default.png`;
    }

    /**
     * Applies a severity filter.
     */
    function apply() {
        if (interactionEnabled) {
            filterActive = true;
            _showSelected();
        }
    }

    /**
     * Unapplies a severity filter.
     */
    function unapply() {
        if (interactionEnabled) {
            filterActive = false;
            _showDeselected();
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

    _init(params);

    return this;
}
