/**
 * Label Type Menu module.
 * This is responsible for holding the buttons allowing users to filter labels by label type.
 *
 * @param uiLabelTypeMenu UI element corresponding to LabelTypeMenu.
 * @returns {LabelTypeMenu}
 * @constructor
 */
function LabelTypeMenu(uiLabelTypeMenu, initialLabelType) {
    let self = this;
    let defaultType = "Assorted";

    let status = {
        currentLabelType: initialLabelType
    };

    /**
     * Initialize LabelTypeMenu.
     */
    function _init() {
        if (uiLabelTypeMenu) {
            uiLabelTypeMenu.select.bind({
                change: labelTypeSelectCallback
            })
        }
    }

    /**
     * Handles what happens when a label type is selected.
     */
    function labelTypeSelectCallback() {
        let newLabelType = $(this).val();
        let oldLabelType = status.currentLabelType;

        // Check if the label type changed. Prevents this code from running on initial page load.
        if (newLabelType !== oldLabelType) {
            setStatus("currentLabelType", newLabelType);
            sg.tracker.push("Filter_LabelType=" + newLabelType);
            sg.cardFilter.update();
        }
    }

    /**
     * Returns current selected label type.
     */
    function getCurrentLabelType() {
        return status.currentLabelType;
    }

    /**
     * Returns to the default selection (All Label Types).
     */
    function setToDefault() {
        $('#label-select').val('Assorted');
        setStatus("currentLabelType", defaultType);
        sg.tracker.push("Filter_LabelType=" + defaultType);
        sg.cardFilter.update();
    }

    /**
     * Return status of LabelTypeMenu.
     */
    function getStatus() {
        return status;
    }

    /**
     * Set status attribute.
     * 
     * @param {*} key Status name.
     * @param {*} value Status value.
     */
    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    self.getCurrentLabelType = getCurrentLabelType;
    self.setToDefault = setToDefault;
    self.getStatus = getStatus;
    self.setStatus = setStatus;

    _init();
    return this;
}
