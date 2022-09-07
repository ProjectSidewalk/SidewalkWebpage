/**
 * An object for creating a popover which displays additional locational info on any GSV pane.
 *
 * @param {HTMLElement} container Element where the info button will be displayed
 * @param {StreetViewPanorama} panorama Panorama object
 * @param {svl.map} map Map object
 * @returns {GSVInfoPopOver} Popover object, which holds the popover title html, content html, info button html, and
 * update values method
 */
function GSVInfoPopOver (container, panorama, map) {
    let self = this;

    function _init() {

        // Create popover title bar
        self.titleBox = document.createElement('div');

        let title = document.createElement('span');
        title.classList.add('popover-element');
        title.textContent = 'Details'
        self.titleBox.appendChild(title);

        let clipboard = document.createElement('img');
        clipboard.classList.add('popover-element');
        clipboard.src = '/assets/javascripts/SVLabel/img/misc/clipboard_copy.png';
        clipboard.id = 'clipboard';

        clipboard.setAttribute('data-toggle', 'tooltip');
        clipboard.setAttribute('data-placement', 'top');
        clipboard.setAttribute('trigger', 'click');
        clipboard.setAttribute('tabindex', 0);
        clipboard.setAttribute('title', 'Details copied to clipboard!');

        self.titleBox.appendChild(clipboard);


        // Create popover content
        self.popoverContent = document.createElement('div');

        // Add in container for each info type to the popover
        let dataList = document.createElement('ul');
        dataList.classList.add('list-group', 'list-group-flush');

        addListElement('Latitude', dataList);
        addListElement('Longitude', dataList);
        addListElement('PanoID', dataList);
        // TODO: add street edge ID and region ID

        self.popoverContent.appendChild(dataList);

        // Create link to separate GSV
        let linkGSV = document.createElement('a');
        linkGSV.classList.add('popover-element');
        linkGSV.id = 'gsv-link'
        linkGSV.textContent = 'View in Google Street View';
        self.popoverContent.appendChild(linkGSV);


        // Create info button and add popover attributes
        self.infoButton = document.createElement('img');
        self.infoButton.classList.add('popover-element');
        self.infoButton.id = 'info-button';
        self.infoButton.src = '/assets/javascripts/SVLabel/img/misc/gsv_info_btn.png';
        self.infoButton.setAttribute('data-toggle', 'popover');
        self.infoButton.setAttribute('data-placement', 'top');
        self.infoButton.setAttribute('title', self.titleBox.innerHTML);
        self.infoButton.setAttribute('data-content', self.popoverContent.innerHTML);

        container.append(self.infoButton);


        // Enable popovers/tooltips and set options
        $('#info-button').popover({
            html: true,
            container: $('#view-control-layer'),
        });
        $('#clipboard').tooltip();

        // Update popover everytime it opens
        $('#info-button').on('click', updateVals);

        // Dismiss popover on clicking outside of popover
        $('#info-button').on('shown.bs.popover', () => {
            console.log('popover shown!');
            $('.popover-title').addClass('popover-element');
            $('.popover-content').addClass('popover-element');
        });
        $('html').on('mousedown', (e) => {
            let tar = $(e.target);
            console.log(tar[0]);
            if (tar[0].className.indexOf('popover-element') === -1) {
                $('#info-button').popover('hide');
            }
        });
        // Dismiss popover whenver panorama changes
        panorama.addListener('pano_changed', () => {
            $('#info-button').popover('hide');
        })
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
        $('.popover').css('left', '-17px');
    }

    /**
     * Creates a key-value pair display within the popover
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
