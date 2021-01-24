/**
 * CardSort Menu module. This is responsible for holding the switches
 * allowing users to sort labels on various parameters
 *
 * @returns {CardSortMenu}
 * @constructor
 */
function CardSortMenu(uiCardSortMenu) {
    let self = this;

    let orderCodes = {
        sort_LeastSevere: 0,
        sort_MostSevere: 1 
    }

    let status = {
        severity: 1,
        sortType: "none"
    };

    function _init() {
        if (uiCardSortMenu) {
            uiCardSortMenu.sort.bind({
                change: handleSortSwitchClickCallback
            });
        }
    }

    function handleSortSwitchClickCallback() {
        let sortType = $(this).val();
        setStatus("sortType", sortType);

        console.log("sort clicked");

        //TODO: Can we do this without referencing sg namespace?
        sg.cardContainer.sortCards(orderCodes[sortType]);
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

    self.getStatus = getStatus;
    self.setStatus = setStatus;

    _init();
    return this;
}
