/**
 * An object for displaying additional locational info on any GSV pane.
 *
 * @param svl SVL object
 * @param {HTMLElement} container Element where the info button will be displayed
 * @returns {GSVInfoPopOver} The info button and popover object
 * @constructor
 */
function GSVInfoPopOver (container, panorama, map) {
    let self = this;

    function _init() {
        let popoverContent = document.createElement('div');

        // Create popover title bar
        let titleBox = document.createElement('div');

        let title = document.createElement('span');
        title.textContent = 'Details'
        titleBox.appendChild(title);

        let clipboard = document.createElement('img');
        clipboard.src = '/assets/javascripts/SVLabel/img/misc/clipboard_copy.png';
        clipboard.id = 'clipboard';

        clipboard.setAttribute('data-toggle', 'tooltip');
        clipboard.setAttribute('data-placement', 'top');
        clipboard.setAttribute('trigger', 'click');
        clipboard.setAttribute('tabindex', 0);
        clipboard.setAttribute('title', 'Copied!');

        titleBox.appendChild(clipboard);


        // Create popover content
        let dataList = document.createElement('ul');
        dataList.classList.add('list-group', 'list-group-flush');

        // Add in container for each info type to the popover
        addListElement('Latitude', dataList);
        addListElement('Longitude', dataList);
        addListElement('PanoID', dataList);
        // TODO: add street edge ID and region ID
        popoverContent.appendChild(dataList);

        // Create link to separate GSV
        let linkGSV = document.createElement('a');
        linkGSV.id = 'gsv-link'
        linkGSV.textContent = 'View in Google Street View';
        popoverContent.appendChild(linkGSV);

        // Create info button and add popover attributes
        let infoButton = document.createElement('img');
        infoButton.id = 'info-button';
        infoButton.src = '/assets/javascripts/SVLabel/img/misc/info_button.png';
        infoButton.setAttribute('data-toggle', 'popover');
        infoButton.setAttribute('data-placement', 'top');
        infoButton.setAttribute('title', titleBox.innerHTML);
        infoButton.setAttribute('data-content', popoverContent.innerHTML);

        // Makes the popover a dismissable popover
        // infoButton.setAttribute('tabindex', 0);
        // infoButton.setAttribute('data-trigger', 'focus');

        container.append(infoButton);

        // Enable popovers/tooltips and set options
        $('#info-button').popover({
            html: true,
            container: $('#view-control-layer'),
            // trigger: 'focus'
        });
        $('#clipboard').tooltip();

        // Open popover on click
        $('#info-button').on('click', updateVals);
    }

    /**
     * Update the values within the popover
     */
    function updateVals() {
        const coords = map.getPosition();
        const panoId = map.getPanoId();
        const pov = map.getPov();

        function changeVals(key, val) {
            let valSpan = document.getElementById(`${key}-value`)
            valSpan.textContent = val;
        }

        changeVals('Latitude', coords.lat + '°');
        changeVals('Longitude', coords.lng + '°');
        changeVals('PanoID', panoId);
        // TODO: add streetEdgeId, regionId

        // Create GSV link
        $('#gsv-link').attr('href', `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coords.lat}%2C${coords.lng}&heading=${pov.heading}&pitch=${pov.pitch}`);
        $('#gsv-link').attr('target', '_blank');

        // Copy to clipboard
        $('#clipboard').click(() => {
            $('#clipboard').tooltip('enable');
            $('#clipboard').tooltip('show');
            navigator.clipboard.writeText(
                `Latitude: ${coords.lat}°\nLongitude: ${coords.lng}°\nPanoID: ${panoId}`
            );
        });
        $('#clipboard').on('mouseout', () => {
            $('#clipboard').tooltip('disable');
        });

        // Fixes Bootstrap popover positioning issues, has to be done AFTER popover loads,
        // thus cannot be put into css file
        $('.popover').css('left', '-10px');
    }

    /**
     * Creates a key-value pair display within the popover
     * @param key Key name of the key-value pair
     */
    function addListElement(key, dataList) {
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

        listElement.appendChild(valSpan);
        dataList.appendChild(listElement);
    }

    _init();

    self.updateVals = updateVals;

    return self;
}
