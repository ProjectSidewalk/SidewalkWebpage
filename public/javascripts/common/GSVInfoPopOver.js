/**
 * An object for displaying additional locational info on any GSV pane.
 *
 * @param svl SVL object
 * @param {HTMLElement} container Element where the info button will be displayed
 * @returns {GSVInfoPopOver} The info button and popover object
 * @constructor
 */
function GSVInfoPopOver (container, panorama, coordCallBack, panoIdCallBack, ) {
    let self = this;

    function _init() {
        let popoverContent = document.createElement('div');

        let dataList = document.createElement('ul');
        dataList.classList.add('list-group', 'list-group-flush');

        // Add in container for each info type to the popover
        addListElement('Latitude');
        addListElement('Longitude');
        addListElement('PanoID');
        // TODO: add street edge ID and region ID
        popoverContent.appendChild(dataList);

        // Create info button and add popover attributes
        let infoButton = document.createElement('img');
        infoButton.id = 'info-button';
        infoButton.src = '/assets/javascripts/SVLabel/img/misc/info_button.png';
        infoButton.setAttribute('data-toggle', 'popover');
        infoButton.setAttribute('data-placement', 'top');
        infoButton.setAttribute('title', 'Details');
        infoButton.setAttribute('data-content', popoverContent.innerHTML);

        // Makes the popover a dismissable popover
        infoButton.setAttribute('tabindex', 0);
        infoButton.setAttribute('data-trigger', 'focus');

        container.append(infoButton);

        // Enable popover
        $(function () {
            $('#info-button').popover({
                html: true,
                container: $('#view-control-layer'),
                trigger: 'focus'
            });
        });

        // Open popover on click
        $('#info-button').on('click', updateVals);
    }

    /**
     * Update the values within the popover
     */
    function updateVals() {
        const coords = coordCallBack();
        const panoId = panoIdCallBack();

        function changeVals(key, val) {
            let valSpan = document.getElementById(`${key}-value`)
            valSpan.textContent = val;
        }

        changeVals('Latitude', coords.lat);
        changeVals('Longitude', coords.lng);
        changeVals('PanoID', panoId);
        // TODO: add streetEdgeId, regionId

        // Fixes Bootstrap popover positioning issues, has to be done AFTER popover loads,
        // thus cannot be put into css file
        $('.popover').css('left', '-10px');
    }

    /**
     * Creates a key-value pair display within the popover
     * @param key Key name of the key-value pair
     */
    function addListElement(key) {
        let listElement = document.createElement('li');
        listElement.classList.add('list-group-item', 'info-list-item');

        let keySpan = document.createElement('span');
        keySpan.classList.add('info-key');
        keySpan.textContent = key;
        listElement.appendChild(keySpan);

        let valSpan = document.createElement('span');
        valSpan.classList.add('info-val');
        valSpan.textContent = '-';
        valSpan.id = `${key}-value`
        // TODO: create copy to clipboard feature

        listElement.appendChild(valSpan);
        dataList.appendChild(listElement);
    }

    _init();

    self.updateVals = updateVals;

    return self;
}
