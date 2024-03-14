/**
 * CardSort Menu module. Responsible for holding the switches allowing users to sort labels on various parameters.
 *
 * @returns {CardSortMenu}
 * @constructor
 */
function CardSortMenu(uiCardSortMenu) {
    let self = this;

    // The code values associated with each sort.
    let orderCodes = {
        mostSevere: 0,
        leastSevere: 1,

        mostRecent: 2,
        leastRecent: 3,

        mostValidation: 4,
        leastValidation: 5,

        mostTags: 6,
        leastTags: 7,
    }

    // The status of the sorting at any point.
    let status = {
        // severity: 1,
        // sortType: "none"
    };

    function _init() {
        if (uiCardSortMenu) {
            uiCardSortMenu.sort.bind({
                change: sortSelectCallback
            });
        }
    }
    
    /**
     * Callback function for when sorting order of cards is changed.
     */
    function sortSelectCallback() {
        let sortType = $(this).val();
        setStatus("sortType", sortType);

        console.log("sort clicked");

        //TODO: Can we do this without referencing sg namespace?
        sg.cardContainer.sortCards(orderCodes[sortType]);
    }

    /**
     * Returns the status of the CardSortMenu
     */
    function getStatus() {
        // TODO: perhaps remove this if no other status added
        return status;
    }

    /**
     * Sets a specific key, value pair in the status
     * @param {*} key 
     * @param {*} value 
     */
    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    self.getStatus = getStatus;
    self.setStatus = setStatus;

    _init();
    return this;
}
