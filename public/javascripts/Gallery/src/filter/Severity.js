/**
 * A Severity module.
 * 
 * @param {*} params Properties of severity.
 * @returns {Severity}
 * @constructor
 */
function Severity (params){
    let self = this;

    // UI element of severity.
    let severityElement = null;

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
        severityElement = document.createElement('button');
        severityElement.className = 'gallery-severity';
        severityElement.id = properties.severity;
        severityElement.innerText = properties.severity;
        severityElement.disabled = true;
        severityElement.onclick = handleOnClickCallback;
    }

    /**
     * Handles when severity is selected/deselected.
     */
    function handleOnClickCallback(){
        if (active){
            sg.tracker.push("SeverityApply", null, {
                Severity: properties.severity
            });
            unapply();
        } else {
            sg.tracker.push("SeverityUnapply", null, {
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
        severityElement.setAttribute("style", "background-color: #78c8aa");
    }

    /**
     * Unapplies a Severity.
     */
    function unapply() {
        active = false;
        severityElement.setAttribute("style", "background-color: none");
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
        severityElement.setAttribute("disabled", true);
    }

    /**
     * Enables interaction with Severity.
     */
    function enable() {
        severityElement.setAttribute("disabled", false);
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
