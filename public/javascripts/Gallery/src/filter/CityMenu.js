/**
 * City Menu module.
 * This is responsible for holding the buttons allowing users to filter citys by city type.
 *
 * @param uiCityMenu UI element corresponding to CityMenu.
 * @returns {CityMenu}
 * @constructor
 */
function CityMenu(uiCityMenu) {
    let self = this;

    let status = {
        currentCityType: null
    };

    /**
     * Initialize CityMenu.
     */
    function _init() {
        if (uiCityMenu) {
            uiCityMenu.select.bind({
                change: handleCitySelectSwitchChangeCallback
            })
        }
    }

    /**
     * Handles what happens when a city type is selected.
     */
    function handleCitySelectSwitchChangeCallback() {
        let cityType = $(this).val();
        setStatus("currentCityType", cityType);
        sg.tracker.push("Filter_CityType=" + cityType);
        sg.tagContainer.update();
    }

    /**
     * Returns current selected city type.
     */
    function getCurrentCityType() {
        return status.currentCityType;
    }

    /**
     * Return status of CityMenu.
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

    self.getCurrentCityType = getCurrentCityType;
    self.getStatus = getStatus;
    self.setStatus = setStatus;

    _init();
    return this;
}
