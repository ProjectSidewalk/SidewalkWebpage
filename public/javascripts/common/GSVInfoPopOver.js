/**
 * Displays info about the current GSV pane
 *
 * @param {HTMLElement} container Element where the info button will be displayed
 * @param {StreetViewPanorama} panorama Panorama object
 * @param {function} coords Function that returns current longitude and latitude coordinates
 * @param {function} panoId Function that returns current panorama ID
 * @param {function} streetEdgeId Function that returns current Street Edge ID
 * @param {function} regionId Function that returns current Region ID
 * @param {function} pov Function that returns current POV
 * @param {Boolean} whiteIcon Set to true if using white icon, false if using blue icon.
 * @param {function} [labelId] Optional function that returns the Label ID.
 * @returns {GSVInfoPopOver} Popover object, which holds the popover title html, content html, info button html, and
 * update values method
 */
function GSVInfoPopOver (container, panorama, coords, panoId, streetEdgeId, regionId, pov, whiteIcon, labelId) {
    let self = this;

    function _init() {
        // Create popover title bar.
        self.titleBox = document.createElement('div');

        let title = document.createElement('span');
        title.classList.add('popover-element');
        title.textContent = 'Details'
        self.titleBox.appendChild(title);

        let clipboard = document.createElement('img');
        clipboard.classList.add('popover-element');
        clipboard.src = '/assets/images/icons/clipboard_copy.png';
        clipboard.id = 'clipboard';

        clipboard.setAttribute('data-toggle', 'popover');
        clipboard.setAttribute('tabindex', 0);
        clipboard.setAttribute( 'data-placement', 'top');
        clipboard.setAttribute( 'data-content', 'Data copied to your clipboard!');
        clipboard.setAttribute('trigger', 'manual');

        self.titleBox.appendChild(clipboard);


        // Create popover content.
        self.popoverContent = document.createElement('div');

        // Add in container for each info type to the popover.
        let dataList = document.createElement('ul');
        dataList.classList.add('list-group', 'list-group-flush', 'gsv-info-list-group');

        addListElement('Latitude', dataList);
        addListElement('Longitude', dataList);
        addListElement('Pano ID', dataList);
        addListElement('Street Edge ID', dataList);
        addListElement('Region ID', dataList);
        if (labelId) addListElement('Label ID', dataList);

        self.popoverContent.appendChild(dataList);

        // Create link to separate GSV.
        let linkGSV = document.createElement('a');
        linkGSV.classList.add('popover-element');
        linkGSV.id = 'gsv-link'
        linkGSV.textContent = 'View in Google Street View';
        self.popoverContent.appendChild(linkGSV);


        // Create info button and add popover attributes.
        self.infoButton = document.createElement('img');
        self.infoButton.classList.add('popover-element');
        self.infoButton.id = 'info-button';
        if (whiteIcon) self.infoButton.src = '/assets/images/icons/gsv_info_btn_white.svg';
        else self.infoButton.src = '/assets/images/icons/gsv_info_btn.png';
        self.infoButton.setAttribute('data-toggle', 'popover');

        container.append(self.infoButton);

        // Enable popovers/tooltips and set options
        $('#info-button').popover({
            html: true,
            placement: 'top',
            container: 'body',
            title: self.titleBox.innerHTML,
            content: self.popoverContent.innerHTML
        }).on('click', updateVals).on('shown.bs.popover', () => {
            // Add popover-element classes to more elements, making it easier to dismiss popover on when outside it.
            $('.popover-title').addClass('popover-element');
            $('.popover-content').addClass('popover-element');
        });
        $('#clipboard').popover();

        // Dismiss popover when clicking outside it. Anything without the 'popover-element' class is considered outside.
        $(document).on('mousedown', (e) => {
            let tar = $(e.target);
            if (!tar[0].classList.contains('popover-element')) {
                $('#info-button').popover('hide');
            }
        });
        // Dismiss popover whenever panorama changes.
        panorama.addListener('pano_changed', () => {
            $('#info-button').popover('hide');
        })
    }


    /**
     * Update the values within the popover.
     */
    function updateVals() {
        // Position popover.
        let xpos = self.infoButton.getBoundingClientRect().x + (self.infoButton.getBoundingClientRect().width / 2) - 175;
        $('.popover').css('left', `${xpos}px`);

        // Get info values.
        const currCoords = coords ? coords() : {lat: null, lng: null};
        const currPanoId = panoId ? panoId() : null;
        const currStreetEdgeId = streetEdgeId ? streetEdgeId() : null;
        const currRegionId = regionId ? regionId() : null;
        const currPov = pov ? pov() : {heading: 0, pitch: 0};
        const currLabelId = labelId ? labelId() : null;

        function changeVals(key, val) {
            if (!val) {
                val = 'No Info';
            } else if (key === "Latitude" || key === 'Longitude') {
                val = val.toFixed(8) + '°';
            }
            let valSpan = document.getElementById(`${key}-value`);
            valSpan.textContent = val;
        }

        changeVals('Latitude', currCoords.lat);
        changeVals('Longitude', currCoords.lng);
        changeVals('Pano ID', currPanoId);
        changeVals('Street Edge ID', currStreetEdgeId);
        changeVals('Region ID', currRegionId);
        if (currLabelId) changeVals('Label ID', currLabelId);

        // Create GSV link.
        let gsvLink = $('#gsv-link');
        gsvLink.attr('href', `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${currCoords.lat}%2C${currCoords.lng}&heading=${currPov.heading}&pitch=${currPov.pitch}`);
        gsvLink.attr('target', '_blank');

        // Copy to clipboard.
        $('#clipboard').on('click', function(e) {
            let clipboardText = `Latitude: ${currCoords.lat}°\nLongitude: ${currCoords.lng}°\nPano ID: ${currPanoId}\nStreet Edge ID: ${currStreetEdgeId}\nRegion ID: ${currRegionId}`;
            if (currLabelId) clipboardText += `Label ID: ${currLabelId}`;
            navigator.clipboard.writeText(clipboardText);

            // The clipboard popover will only show one time until you close and reopen the info button popover. I have
            // no idea why that's happening, but for some reason it works if you put it in a setTimeout. So I have a one
            // ms delay before showing the popover. Then it disappears after 1.5 seconds.
            setTimeout(function() {
                $(e.target).popover('show');
                setTimeout(function() {
                    $(e.target).popover('hide');
                }, 1500);
            }, 1);
        });
    }

    /**
     * Creates a key-value pair display within the popover.
     * @param {String} key Key name of the key-value pair
     * @param {HTMLElement} dataList List element container to add list item to
     */
    function addListElement(key, dataList) {
        let listElement = document.createElement('li');
        listElement.classList.add('list-group-item', 'info-list-item', 'popover-element');

        let keySpan = document.createElement('span');
        keySpan.classList.add('info-key', 'popover-element');
        keySpan.textContent = key;
        listElement.appendChild(keySpan);

        let valSpan = document.createElement('span');
        valSpan.classList.add('info-val', 'popover-element');
        valSpan.textContent = '-';
        valSpan.id = `${key}-value`

        listElement.appendChild(valSpan);
        dataList.appendChild(listElement);
    }

    _init();

    self.updateVals = updateVals;

    return self;
}
