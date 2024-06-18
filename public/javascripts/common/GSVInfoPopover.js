/**
 * Displays info about the current GSV pane.
 *
 * @param {HTMLElement} container Element where the info button will be displayed
 * @param {StreetViewPanorama} panorama Panorama object
 * @param {function} coords Function that returns current longitude and latitude coordinates
 * @param {function} panoId Function that returns current panorama ID
 * @param {function} streetEdgeId Function that returns current Street Edge ID
 * @param {function} regionId Function that returns current Region ID
 * @param {function} pov Function that returns current POV
 * @param {String} cityName Name of the current city
 * @param {Boolean} whiteIcon Set to true if using white icon, false if using blue icon.
 * @param {function} infoLogging Function that adds the info button click to the appropriate logs.
 * @param {function} clipboardLogging Function that adds the copy to clipboard click to the appropriate logs.
 * @param {function} viewGSVLogging Function that adds the View in GSV click to the appropriate logs.
 * @param {function} [labelId] Optional function that returns the Label ID.
 * @returns {GSVInfoPopover} Popover object, which holds the popover title html, content html, info button html, and
 * update values method
 */
function GSVInfoPopover (container, panorama, coords, panoId, streetEdgeId, regionId, pov, cityName, whiteIcon, infoLogging, clipboardLogging, viewGSVLogging, labelId) {
    let self = this;

    function _init() {
        // Create popover title bar.
        self.titleBox = document.createElement('div');

        let title = document.createElement('span');
        title.classList.add('popover-element');
        title.textContent = i18next.t('common:gsv-info.details-title');
        self.titleBox.appendChild(title);

        let clipboard = document.createElement('img');
        clipboard.classList.add('popover-element');
        clipboard.src = '/assets/images/icons/clipboard_copy.png';
        clipboard.id = 'clipboard';
        clipboard.setAttribute('data-toggle', 'popover');

        self.titleBox.appendChild(clipboard);

        // Create popover content.
        self.popoverContent = document.createElement('div');

        // Add in container for each info type to the popover.
        let dataList = document.createElement('ul');
        dataList.classList.add('list-group', 'list-group-flush', 'gsv-info-list-group');

        addListElement('latitude', dataList);
        addListElement('longitude', dataList);
        addListElement('panorama-id', dataList);
        addListElement('street-id', dataList);
        addListElement('region-id', dataList);
        if (labelId) addListElement('label-id', dataList);

        self.popoverContent.appendChild(dataList);

        // Create element for a link to GSV in a separate tab.
        let linkGSV = document.createElement('a');
        linkGSV.classList.add('popover-element');
        linkGSV.id = 'gsv-link'
        linkGSV.textContent = i18next.t('common:gsv-info.view-in-gsv');
        self.popoverContent.appendChild(linkGSV);

        // Create info button and add popover attributes.
        self.infoButton = document.createElement('img');
        self.infoButton.classList.add('popover-element');
        self.infoButton.id = 'gsv-info-button';
        if (whiteIcon) self.infoButton.src = '/assets/images/icons/gsv_info_btn_white.svg';
        else self.infoButton.src = '/assets/images/icons/gsv_info_btn.png';
        self.infoButton.setAttribute('data-toggle', 'popover');

        container.append(self.infoButton);

        // Enable popovers/tooltips and set options.
        $('#gsv-info-button').popover({
            html: true,
            placement: 'top',
            container: 'body',
            title: self.titleBox.innerHTML,
            content: self.popoverContent.innerHTML
        }).on('click', updateVals).on('shown.bs.popover', () => {
            // Add popover-element classes to more elements, making it easier to dismiss popover on when outside it.
            $('.popover-title').addClass('popover-element');
            $('.popover-content').addClass('popover-element');

            // Initialize the popover for the clipboard.
            $('#clipboard').popover({
                placement: 'top',
                trigger: 'manual',
                html: true,
                content: `<span class="clipboard-tooltip">${i18next.t('common:gsv-info.copied-to-clipboard')}</span>`
            });
        });

        // Dismiss popover when clicking outside it. Anything without the 'popover-element' class is considered outside.
        $(document).on('mousedown', (e) => {
            let tar = $(e.target);
            if (!tar[0].classList.contains('popover-element')) {
                $('#gsv-info-button').popover('hide');
            }
        });
        // Dismiss popover whenever panorama changes.
        panorama.addListener('pano_changed', () => {
            $('#gsv-info-button').popover('hide');
        })
    }

    /**
     * Update the values within the popover.
     */
    function updateVals() {
        // Log the click on the info button.
        infoLogging();

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
            } else if (key === "latitude" || key === 'longitude') {
                val = val.toFixed(8) + '°';
            }
            let valSpan = document.getElementById(`${key}-value`);
            valSpan.textContent = val;
        }
        changeVals('latitude', currCoords.lat);
        changeVals('longitude', currCoords.lng);
        changeVals('panorama-id', currPanoId);
        changeVals('street-id', currStreetEdgeId);
        changeVals('region-id', currRegionId);
        if (currLabelId) changeVals('label-id', currLabelId);

        // Create GSV link and log the click.
        let gsvLink = $('#gsv-link');
        gsvLink.attr('href', `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${currCoords.lat}%2C${currCoords.lng}&heading=${currPov.heading}&pitch=${currPov.pitch}`);
        gsvLink.attr('target', '_blank');
        gsvLink.on('click', viewGSVLogging);

        // Position popover.
        let infoPopover = $('.popover');
        let infoRect = self.infoButton.getBoundingClientRect();
        let xpos = infoRect.x + (infoRect.width / 2) - (infoPopover.width() / 2);
        infoPopover.css('left', `${xpos}px`);

        // Set the popover zoom to the same zoom as the Explore/Validate page.
        if (typeof svl !== 'undefined' && svl.cssZoom) infoPopover.css('zoom', `${svl.cssZoom}%`);
        else if (typeof svv !== 'undefined' && svv.cssZoom) infoPopover.css('zoom', `${svv.cssZoom}%`);

        // Copy to clipboard.
        $('#clipboard').on('click', function(e) {
            // Log the click on the copy to keyboard button.
            clipboardLogging();

            let clipboardText = `${i18next.t(`common:gsv-info.city`)}: ${cityName}\n` +
                `${i18next.t(`common:gsv-info.latitude`)}: ${currCoords.lat}°\n` +
                `${i18next.t(`common:gsv-info.longitude`)}: ${currCoords.lng}°\n` +
                `${i18next.t(`common:gsv-info.panorama-id`)}: ${currPanoId}\n` +
                `${i18next.t(`common:gsv-info.street-id`)}: ${currStreetEdgeId}\n` +
                `${i18next.t(`common:gsv-info.region-id`)}: ${currRegionId}\n`;
            if (currLabelId) clipboardText += `${i18next.t(`common:gsv-info.label-id`)}: ${currLabelId}\n`;
            clipboardText += `GSV URL: ${gsvLink.attr('href')}`;
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
        listElement.classList.add('list-group-item', 'info-list-item', 'popover-element', 'audit-selectable');

        let keySpan = document.createElement('span');
        keySpan.classList.add('info-key', 'popover-element');
        keySpan.textContent = i18next.t(`common:gsv-info.${key}`);
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
