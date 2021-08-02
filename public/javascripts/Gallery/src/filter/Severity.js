/**
 * A Severity module.
 * 
 * @param {*} params Properties of severity.
 * @returns {Severity}
 * @constructor
 */
function Severity (params){
    let self = this;

    // UI element of the severity container, image, and checkbox.
    let severityElement = null;
    let severityImage = null;
    let checkbox = null;

    let properties = {
        severity: undefined
    };

    // A boolean to see if the current severity filter is active.
    let active = false;

    /**
     * Initialize Severity.
     * 
     * @param {int} param Severity.
     */
    function _init(param) {
        properties.severity = param;

        severityElement = document.createElement('div');
        severityElement.className = 'gallery-severity'

        severityImage = document.createElement('img');
        severityImage.className = 'gallery-severity-image';
        severityImage.id = properties.severity;
        severityImage.innerText = properties.severity;
        severityImage.onclick = handleOnClickCallback;
        severityImage.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${param}-Gray.png`

        checkbox = document.createElement('input')
        checkbox.onclick = handleOnClickCallback;
        checkbox.type = 'checkbox'
        checkbox.className = 'gallery-severity-checkbox'
        checkbox.disabled = true;

        severityElement.appendChild(severityImage)
        severityElement.appendChild(checkbox)
    }

    /**
     * Handles when severity is selected/deselected.
     */
    function handleOnClickCallback() {
        if (active) {
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
     * Applies a Severity.
     */
    function apply() {
        active = true;
        checkbox.checked = true;
        severityImage.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${properties.severity}_inverted.png`;
    }

    /**
     * Unapplies a Severity.
     */
    function unapply() {
        active = false;
        checkbox.checked = false;
        severityImage.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${properties.severity}-Gray.png`;
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
        return active;
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
        checkbox.setAttribute("disabled", true);
    }

    /**
     * Enables interaction with Severity.
     */
    function enable() {
        checkbox.setAttribute("disabled", false);
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
