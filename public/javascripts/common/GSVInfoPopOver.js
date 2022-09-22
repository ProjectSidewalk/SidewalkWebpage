
/**
 *
 * @param {HTMLElement} container Element where the info button will be displayed
 * @param {StreetViewPanorama} panorama Panorama object
 * @param {function} coords Function that returns current longitude and latitude coordinates
 * @param {function} panoId Function that returns current panorama ID
 * @param {function} streetEdgeId Function that returns current Street Edge ID
 * @param {function} regionId Function that returns current Region ID
 * @param {function} pov Function that returns current POV
 * @returns {GSVInfoPopOver} Popover object, which holds the popover title html, content html, info button html, and
 * update values method
 */
function GSVInfoPopOver (container, panorama, coords, panoId, streetEdgeId, regionId, pov) {
    /*
    Back-end API TODO:

    Audit: DONE
        Panorama: svl.panorama
        Coords: svl.map.getPosition()
        PanoId: svl.map.getPanoId()
        StreetEdgeId: svl.taskContainer.getCurrentTask().getStreetEdgeId()
        RegionId: svl.taskContainer.getCurrentTask().getRegionId()
        POV: svl.map.getPov()
    Gallery:
        Panorama: sg.modal().pano.panorama
        Coords: sg.modal().pano.getPosition()
        PanoId: sg.modal().pano.getPanoId()
        StreetEdgeId:
        RegionId:
        POV:sg.modal().pano.getPov()
    Validate:
        Panorama:
        Coords:
        PanoId: svv.panorama.getPanoId()
        StreetEdgeId:
        RegionId:
        POV:
    LabelMap:
        Panorama:
        Coords:
        PanoId:
        StreetEdgeId:
        RegionId:
        POV:
     */
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
        addListElement('Pano ID', dataList);
        addListElement('Street Edge ID', dataList);
        addListElement('Region ID', dataList)

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

        // Info button styling
        $(container).css('z-index', 2);
        $('#info-button').css('margin', '5px');
        $('#info-button').css('max-height', '100%');


        // Enable popovers/tooltips and set options
        $('#info-button').popover({
            html: true,
            container: $('body'),
        });
        $('#clipboard').tooltip();

        // Update popover everytime it opens
        $('#info-button').on('click', updateVals);

        // Dismiss popover on clicking outside of popover
        $('#info-button').on('shown.bs.popover', () => {
            $('.popover-title').addClass('popover-element');
            $('.popover-content').addClass('popover-element');
        });
        $('html').on('mousedown', (e) => {
            let tar = $(e.target);
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
        // Position and style popover
        let xpos = self.infoButton.getBoundingClientRect().x + (19 / 2) - 175
        $('.popover').css('left', `${xpos}px`);

        $('.info-key').css('font-weight', 'bold');

        $('.info-list-item').css('display', 'flex');
        $('.info-list-item').css('justify-content', 'space-between');

        $('.popover').css('width', '350px');
        $('.popover').css('max-width', '350px');

        $('.popover-title').css('display', 'flex');
        $('.popover-title').css('justify-content', 'space-between');
        $('.popover-title').css('height', '36px');

        $('.popover-content').css('display', 'flex');
        $('.popover-content').css('flex-direction', 'column');
        $('.popover-content').css('justify-content', 'center');

        $('#gsv-link').css('text-align', 'center');
        $('#gsv-link').css('width', 'fit-content');
        $('#gsv-link').css('margin-left', 'auto');
        $('#gsv-link').css('margin-right', 'auto');

        $('#clipboard').css('max-height', '100%');
        $('#clipboard').css('cursor', 'pointer');

        // Get info values
        const currCoords = coords ? coords() : {lat: null, lng: null};
        const currPanoId = panoId ? panoId() : null;
        const currStreetEdgeId = streetEdgeId ? streetEdgeId() : null;
        const currRegionId = regionId ? regionId() : null;
        const currPov = pov ? pov() : {heading: 0, pitch: 0};

        function changeVals(key, val) {
            if (!val) {
                val = 'No Info';
            } else if (key === "Latitude" || key === 'Longitude') {
                val += '°';
            }
            let valSpan = document.getElementById(`${key}-value`);
            valSpan.textContent = val;
        }

        changeVals('Latitude', currCoords.lat);
        changeVals('Longitude', currCoords.lng);
        changeVals('Pano ID', currPanoId);
        changeVals('Street Edge ID', currStreetEdgeId);
        changeVals('Region ID', currRegionId)

        // Create GSV link
        $('#gsv-link').attr('href', `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${currCoords.lat}%2C${currCoords.lng}&heading=${currPov.heading}&pitch=${currPov.pitch}`);
        $('#gsv-link').attr('target', '_blank');

        // Copy to clipboard
        $('#clipboard').click(() => {
            $('#clipboard').tooltip('enable');
            $('#clipboard').tooltip('show');
            navigator.clipboard.writeText(
                `Latitude: ${currCoords.lat}°\nLongitude: ${currCoords.lng}°\nPano ID: ${currPanoId}\nStreet Edge ID: ${currStreetEdgeId}\nRegion ID: ${currRegionId}`
            );
        });
        $('#clipboard').on('mouseout', () => {
            $('#clipboard').tooltip('disable');
        });
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
