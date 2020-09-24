/**
 * Ribbon Menu module. This is responsible for holding the buttons
 * allowing users to filter labels by label type
 *
 * @returns {RibbonMenu}
 * @constructor
 */
function RibbonMenu(uiRibbonMenu) {
    let self = this;

    let status = {
        currentLabelType: null
    };

    function _init() {
        if (uiRibbonMenu) {
            uiRibbonMenu.buttons.bind({
                click: handleLabelTypeSwitchClickCallback
            });
        }
    }

    function handleLabelTypeSwitchClickCallback() {
        let labelType = $(this).attr('val');
        setStatus("currentLabelType", labelType);

        //TODO: Can we do this without referencing sg namespace?
        sg.tagContainer.update();
    }

    function getCurrentLabelType() {
        return status.currentLabelType;
    }

    // TODO: perhaps remove this if no other status added
    function getStatus() {
        return status;
    }

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