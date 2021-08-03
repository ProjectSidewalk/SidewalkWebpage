/**
 * A Severity module.
 * 
 * @param {*} params Properties of severity.
 * @returns {Severity}
 * @constructor
 */
function Severity (params){
    let self = this;

    // UI element of the severity container and image.
    let severityElement = null;
    let severityImage = null;
    let interactionEnabled = false;

    let properties = {
        severity: undefined
    };

    // A boolean to see if the current severity filter is active.
    let filterActive = false;

    /**
     * Initialize Severity.
     * 
     * @param {int} param Severity.
     */
    function _init(param) {
        properties.severity = param;

        severityElement = document.createElement('div');
        severityElement.className = 'gallery-severity';
        severityElement.onclick = handleOnClickCallback;

        severityImage = document.createElement('img');
        severityImage.className = 'gallery-severity-image';
        severityImage.id = properties.severity;
        severityImage.innerText = properties.severity;
        severityImage.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${param}-Gray.png`;

        severityElement.appendChild(severityImage);
    }

    /**
     * Handles when severity is selected/deselected.
     */
    function handleOnClickCallback() {
        if (filterActive) {
            sg.tracker.push("SeverityUnapply", null, {
                Severity: properties.severity
            });
            unapply();
        } else {
            sg.tracker.push("SeverityApply", null, {
                Severity: properties.severity
            });
            apply();
        }

        sg.cardContainer.updateCardsByTagsAndSeverity();
    }

    /**
     * Applies a severity filter.
     */
    function apply() {
        if (interactionEnabled) {
            filterActive = true;
            severityImage.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${properties.severity}_inverted.png`;
        }
    }

    /**
     * Unapplies a severity filter.
     */
    function unapply() {
        if (interactionEnabled) {
            filterActive = false;
            severityImage.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${properties.severity}-Gray.png`;
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
