/**
 * Label Type Menu module.
 * This is responsible for holding the buttons allowing users to filter labels by label type.
 *
 * @param labelTypeMenu UI element corresponding to LabelTypeMenu.
 * @returns {LabelTypeMenu}
 * @constructor
 */
function LabelTypeMenu(labelTypeMenu) {
    let self = this;

    let status = {
        currentLabelType: null
    };

    /**
     * Initialize LabelTypeMenu.
     */
    function _init() {
        if (labelTypeMenu) {
            labelTypeMenu.select.bind({
                change: labelSelectCallback
            })
        }
    }

    /**
     * Handles what happens when a label type is selected.
     */
    function labelSelectCallback() {
        let labelType = $(this).val();
        setStatus("currentLabelType", labelType);
        sg.tracker.push("Filter_LabelType=" + labelType);
        sg.cardFilter.update();
    }

    /**
     * Returns current selected label type.
     */
    function getCurrentLabelType() {
        return status.currentLabelType;
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
    self.getStatus = getStatus;
    self.setStatus = setStatus;

    _init();
    return this;
}
