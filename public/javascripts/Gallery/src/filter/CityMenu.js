/**
 * City Menu module.
 * This is responsible for holding the buttons allowing users to filter cities by city.
 *
 * @param uiCityMenu UI element corresponding to CityMenu.
 * @returns {CityMenu}
 * @constructor
 */
function CityMenu(uiCityMenu) {
    let self = this;

    let status = {
        currentCity: null
    };

    /**
     * Initialize CityMenu.
     */
    function _init() {
        if (uiCityMenu) {
            uiCityMenu.select.bind({
                change: citySelectCallback
            })
        }
    }

    /**
     * Handles what happens when a city is selected.
     */
    function citySelectCallback() {
        let city = $(this).val();
        setStatus("currentCity", city);
        sg.tracker.push("Filter_CityType=" + city);
        sg.tagContainer.update();
    }

    /**
     * Returns current selected city.
     */
    function getCurrentCity() {
        return status.currentCity;
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

    self.getCurrentCity = getCurrentCity;
    self.getStatus = getStatus;
    self.setStatus = setStatus;

    _init();
    return this;
}
