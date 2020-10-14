// class CardSortMenu {
//     constructor(uiCardSortMenu) {
//         this.uiCardSortMenu = uiCardSortMenu;
//
//         // TODO: Right now, to do ordering, we use negative/positive sign flipping. Can we convert this to something nicer?
//         this._status = {
//             severity: 1
//         };
//
//         let self = this;
//
//         if (this.uiCardSortMenu) {
//             this.uiCardSortMenu.switches.bind({
//                 click: this.handleSortSwitchClickCallback
//             });
//         }
//     }
//
//     handleSortSwitchClickCallback() {
//         console.log(this);
//         if ($(this).text() === "Least Severe") {
//             $(this).text("Most Severe");
//         } else {
//             $(this).text("Least Severe");
//         }
//
//         let sortType = $(this).attr('val');
//         console.log(sortType);
//         console.log(this);
//         this.setStatus(sortType, this._status[sortType] * -1);
//
//         //TODO: Can we do this without referencing sg namespace?
//         sg.cardContainer.sortCards();
//     }
//
//     // TODO: we could use get status(), but we need to figure out a new way to do set status(newVal)
//     get status() {
//         return this._status;
//     }
//
//     setStatus(key, value) {
//         if (key in this._status) {
//             this._status[key] = value;
//         } else {
//             throw "Illegal status name";
//         }
//     }
// }

/**
 * CardSort Menu module. This is responsible for holding the switches
 * allowing users to sort labels on various parameters
 *
 * @returns {CardSortMenu}
 * @constructor
 */
function CardSortMenu(uiCardSortMenu) {
    let self = this;

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

        //TODO: Can we do this without referencing sg namespace?
        sg.cardContainer.sortCards();
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