/**
 * City Menu module.
 * This is responsible for holding the buttons allowing users to filter cities by city.
 */
class CityMenu {
    #status = {
        currentCity: null
    };

    /**
     * @param {object} uiCityMenu UI element corresponding to CityMenu.
     */
    constructor(uiCityMenu) {
        if (uiCityMenu) {
            uiCityMenu.select.bind({
                change: this.#citySelectCallback
            });
        }
    }

    /**
     * Handles what happens when a city is selected.
     */
    #citySelectCallback = (e) => {
        const city = $(e.currentTarget).val();
        this.setStatus("currentCity", city);
        sg.tracker.push("Filter_City=" + city);
        sg.cardFilter.update();
    };

    /**
     * Returns current selected city.
     */
    getCurrentCity() {
        return this.#status.currentCity;
    }

    /**
     * Return status of CityMenu.
     */
    getStatus() {
        return this.#status;
    }

    /**
     * Set status attribute.
     *
     * @param {string} key Status name.
     * @param {*} value Status value.
     */
    setStatus(key, value) {
        if (key in this.#status) {
            this.#status[key] = value;
        } else {
            throw `${this.constructor.name}: Illegal status name.`;
        }
    }
}
