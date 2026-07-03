/**
 * CardSort Menu module. Responsible for holding the switches allowing users to sort labels on various parameters.
 */
class CardSortMenu {
    // The code values associated with each sort.
    #orderCodes = {
        sort_LeastSevere: 0,
        sort_MostSevere: 1
    };

    // The status of the sorting at any point.
    #status = {
        severity: 1,
        sortType: "none"
    };

    /**
     * @param {object} uiCardSortMenu UI element corresponding to CardSortMenu.
     */
    constructor(uiCardSortMenu) {
        if (uiCardSortMenu) {
            uiCardSortMenu.sort.bind({
                change: this.#sortSelectCallback
            });
        }
    }

    /**
     * Callback function for when sorting order of cards is changed.
     */
    #sortSelectCallback = (e) => {
        const sortType = $(e.currentTarget).val();
        this.setStatus("sortType", sortType);

        console.log("sort clicked");

        //TODO: Can we do this without referencing sg namespace?
        sg.cardContainer.sortCards(this.#orderCodes[sortType]);
    };

    /**
     * Returns the status of the CardSortMenu
     */
    getStatus() {
        // TODO: perhaps remove this if no other status added
        return this.#status;
    }

    /**
     * Sets a specific key, value pair in the status
     * @param {string} key
     * @param {*} value
     */
    setStatus(key, value) {
        if (key in this.#status) {
            this.#status[key] = value;
        } else {
            throw `${this.constructor.name}: Illegal status name.`;
        }
    }
}
