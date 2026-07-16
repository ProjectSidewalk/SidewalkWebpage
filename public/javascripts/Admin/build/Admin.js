function AdminGSVCommentView(admin) {
    var self = {};
    self.admin = admin;

    var _init = function() {
        self.panoProp = new PanoProperties();
        _resetModal();
    };

    function _resetModal() {
        var modalText =
            '<div class="modal fade" id="label-modal" tabindex="-1" role="dialog" aria-labelledby="myModalLabel">' +
                '<div class="modal-dialog" role="document" style="width: 840px">' +
                    '<div class="modal-content">' +
                        '<div class="modal-header">' +
                            '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>'+
                            '<h4 class="modal-title" id="myModalLabel"></h4>' +
                        '</div>' +
                        '<div class="modal-body">' +
                            '<div id="svholder" style="width: 810px; height:540px">' +
                        '</div>' +
                        '<div id="button-holder">' + 
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';       
        
        self.modal = $(modalText);
        self.panorama = AdminPanorama(self.modal.find("#svholder")[0], self.modal.find("#button-holder"), admin);
    }

    function showCommentGSV(panoId, heading, pitch, zoom, labelId) {
        _resetModal();
        self.modal.modal({
            'show': true
        });
        self.panorama.setPano(panoId, heading, pitch, zoom);
        
        if(labelId) {
            var adminLabelUrl = admin ? "/adminapi/label/id/" + labelId : "/label/id/" + labelId;
            $.getJSON(adminLabelUrl, function (data) {
                setLabel(data);
            });
         }
    }

    function setLabel(labelMetadata) {
        var adminPanoramaLabel = AdminPanoramaLabel(labelMetadata['label_id'], labelMetadata['label_type_key'],
            labelMetadata['canvas_x'], labelMetadata['canvas_y'],
            labelMetadata['canvas_width'], labelMetadata['canvas_height'], labelMetadata['heading'],
            labelMetadata['pitch'], labelMetadata['zoom']);
        self.panorama.setLabel(adminPanoramaLabel);
    }
 
    _init();
    self.showCommentGSV = showCommentGSV;
    return self;
}

function AdminGSVLabelView(admin) {
    var self = {};
    self.admin = admin;

    var _init = function() {
        self.panoProp = new PanoProperties();
        self.resultOptions = {
            "Agree": 1,
            "Disagree": 2,
            "NotSure": 3
        };

        _resetModal();
    };

    function _resetModal() {
        var modalText =
            '<div class="modal fade" id="labelModal" tabindex="-1" role="dialog" aria-labelledby="myModalLabel">' +
                '<div class="modal-dialog" role="document" style="width: 570px">' +
                    '<div class="modal-content">' +
                        '<div class="modal-header">' +
                            '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>' +
                            '<h4 class="modal-title" id="myModalLabel"></h4>' +
                        '</div>' +
                        '<div class="modal-body">' +
                            '<div id="svholder" style="width: 540px; height:360px"></div>' +
                            '<div id="validation-input-holder">' +
                                '<h3 style="margin: 0px; padding-top: 10px;">Is this label correct?</h3>' +
                                '<div id="validation-button-holder" style="padding-top: 10px;">' +
                                    '<button id="validation-agree-button" class="validation-button"' +
                                        'style="height: 50px; width: 179px; background-color: white; margin-right: 2px; border-radius: 5px; border-width: 2px; border-color: lightgrey;">' +
                                        'Agree' +
                                    '</button>' +
                                    '<button id="validation-disagree-button" class="validation-button"' +
                                        'style="height: 50px; width: 179px; background-color: white; margin-right: 2px; border-radius: 5px; border-width: 2px; border-color: lightgrey;">' +
                                        'Disagree' +
                                    '</button>' +
                                    '<button id="validation-not-sure-button" class="validation-button"' +
                                        'style="height: 50px; width: 179px; background-color: white; margin-right: 2px; border-radius: 5px; border-width: 2px; border-color: lightgrey;">' +
                                        'Not sure' +
                                    '</button>' +
                                '</div>' +
                                '<div id="validation-comment-holder" style="padding-top: 10px; padding-bottom: 15px;">' +
                                    '<textarea id="comment-textarea" placeholder="' + i18next.t('common:label-map.add-comment') + '" class="validation-comment-box"></textarea>' +
                                    '<button id="comment-button" class="submit-button" data-container="body" data-toggle="popover" data-placement="top" data-content="' + i18next.t('common:label-map.comment-submitted') + '" data-trigger="manual">' +
                                        i18next.t('common:label-map.submit') +
                                    '</button>' +
                                '</div>' +
                            '</div>' +
                            '<div class="modal-footer" style="padding:0px; padding-top:15px;">' +
                                '<table class="table table-striped" style="font-size:small;>' +
                                    '<tr>' +
                                        '<th>Label Type</th>' +
                                        '<td id="label-type-value"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        `<th>${i18next.t('common:severity')}</th>` +
                                        '<td id="severity"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        `<th>${i18next.t('common:temporary')}</th>` +
                                        '<td id="temporary"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        `<th>${i18next.t('common:tags')}</th>` +
                                        '<td colspan="3" id="tags"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        `<th>${i18next.t('common:description')}</th>` +
                                        '<td colspan="3" id="label-description"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        '<th>Validations</th>' +
                                        '<td colspan="3" id="label-validations"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        `<th>${i18next.t('common:labeled')}</th>` +
                                        '<td id="timestamp" colspan="3"></td>' +
                                    '</tr>' +
                                        '<th>' + i18next.t('common:image-date') + '</th>' +
                                        '<td id="image-date" colspan="3"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        `<th>${i18next.t('common:gsv-info.panorama-id')}</th>` +
                                        '<td id="pano-id" colspan="3"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        '<th>Google Street View</th>' +
                                        '<td id="view-in-gsv" colspan="3"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        `<th>${i18next.t('common:gsv-info.latitude')}</th>` +
                                        '<td id="lat" colspan="3"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        `<th>${i18next.t('common:gsv-info.longitude')}</th>` +
                                        '<td id="lng" colspan="3"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        `<th>${i18next.t('common:gsv-info.label-id')}</th>` +
                                        '<td id="label-id" colspan="3"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        `<th>${i18next.t('common:gsv-info.street-id')}</th>` +
                                        '<td id="street-id" colspan="3"></td>' +
                                    '</tr>' +
                                    '<tr>' +
                                        `<th>${i18next.t('common:gsv-info.region-id')}</th>` +
                                        '<td id="region-id" colspan="3"></td>' +
                                    '</tr>';
        if (self.admin) {
            modalText +=
                                    '<tr>' +
                                        '<th>Task ID</th>' +
                                        '<td id="task"></td>' +
                                    '</tr>'
        }
        modalText +=
                                '</table>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>'

        self.modal = $(modalText);

        self.panorama = AdminPanorama(self.modal.find("#svholder")[0], self.modal.find("#validation-input-holder"), admin);

        self.agreeButton = self.modal.find("#validation-agree-button");
        self.disagreeButton = self.modal.find("#validation-disagree-button");
        self.notSureButton = self.modal.find("#validation-not-sure-button");
        self.resultButtons = {
            "Agree": self.agreeButton,
            "Disagree": self.disagreeButton,
            "NotSure": self.notSureButton
        };

        self.agreeButton.click(function() {
            _validateLabel("Agree");
        });
        self.disagreeButton.click(function() {
            _validateLabel("Disagree");
        });
        self.notSureButton.click(function() {
            _validateLabel("NotSure");
        });

        self.commentButton = self.modal.find("#comment-button");
        self.commentTextArea = self.modal.find("#comment-textarea");
        self.commentButton.popover({
            template : '<div class="feedback-popover" role="tooltip"><div class="arrow"></div><div class="popover-content"></div></div>'
        });
        self.commentButton.click(function() {
            var comment = self.commentTextArea.val();
            if (comment) {
                _submitComment(comment);
            }
        });

        self.modalTitle = self.modal.find("#myModalLabel");
        self.modalTimestamp = self.modal.find("#timestamp");
        self.modalLabelTypeValue = self.modal.find("#label-type-value");
        self.modalSeverity = self.modal.find("#severity");
        self.modalTemporary = self.modal.find("#temporary");
        self.modalTags = self.modal.find("#tags");
        self.modalDescription = self.modal.find("#label-description");
        self.modalValidations = self.modal.find("#label-validations");
        self.modalImageDate = self.modal.find("#image-date");
        self.modalTask = self.modal.find("#task");
        self.modalPanoId = self.modal.find('#pano-id');
        self.modalGsvLink = self.modal.find('#view-in-gsv');
        self.modalLat = self.modal.find('#lat');
        self.modalLng = self.modal.find('#lng');
        self.modalLabelId = self.modal.find("#label-id");
        self.modalStreetId = self.modal.find('#street-id');
        self.modalRegionId = self.modal.find('#region-id');
    }

    /**
     * Get together the data on the validation and submit as a POST request.
     * @param action
     * @private
     */
    function _validateLabel(action) {
        var validationTimestamp = new Date().getTime();
        var canvasWidth = self.panorama.svHolder.width();
        var canvasHeight = self.panorama.svHolder.height();

        var pos = self.panorama.getOriginalPosition();
        var panomarkerPov = {
            heading: pos.heading,
            pitch: pos.pitch
        };

        // This is the POV of the viewport center - this is where the user is looking.
        var userPov = self.panorama.panorama.getPov();
        var zoom = self.panorama.panorama.getZoom();

        // Calculates the center xy coordinates of the kabel on the current viewport.
        var pixelCoordinates = self.panoProp.povToPixel3d(panomarkerPov, userPov, zoom, canvasWidth, canvasHeight);

        // If the user has panned away from the label and it is no longer visible on the canvas, set canvasX/Y to null.
        // We add/subtract the radius of the label so that we still record these values when only a fraction of the
        // label is still visible.
        var labelCanvasX = null;
        var labelCanvasY = null;
        var labelRadius = 10;
        if (pixelCoordinates
            && pixelCoordinates.left + labelRadius > 0
            && pixelCoordinates.left - labelRadius < canvasWidth
            && pixelCoordinates.top + labelRadius > 0
            && pixelCoordinates.top - labelRadius < canvasHeight) {

            labelCanvasX = pixelCoordinates.left - labelRadius;
            labelCanvasY = pixelCoordinates.top - labelRadius;
        }

        var data = {
            label_id: self.panorama.label.labelId,
            label_type: self.panorama.label.label_type,
            validation_result: self.resultOptions[action],
            canvas_x: labelCanvasX,
            canvas_y: labelCanvasY,
            heading: userPov.heading,
            pitch: userPov.pitch,
            zoom: userPov.zoom,
            canvas_height: canvasHeight,
            canvas_width: canvasWidth,
            start_timestamp: validationTimestamp,
            end_timestamp: validationTimestamp,
            is_mobile: false
        };

        // Submit the validation via POST request.
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/labelmap/validate",
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                _resetButtonColors(action);
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    /**
     * Submit a comment as a POST request.
     * @private
     */
    function _submitComment(comment) {
        var userPov = self.panorama.panorama.getPov();
        var zoom = self.panorama.panorama.getZoom();
        var pos = self.panorama.panorama.getPosition();
        var button = document.getElementById("comment-button");

        button.style.cursor = "wait";

        let data = {
            label_id: self.panorama.label.labelId,
            label_type: self.panorama.label.label_type,
            comment: comment,
            gsv_panorama_id: self.panorama.panoId,
            heading: userPov.heading,
            pitch: userPov.pitch,
            zoom: zoom,
            lat: pos.lat(),
            lng: pos.lng(),
        };

        // Submit the comment via POST request.
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/labelmap/comment",
            type: 'POST',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                button.style.cursor = "pointer";
                self.commentTextArea.val('');
                self.commentButton.popover('toggle');
                setTimeout(function(){ self.commentButton.popover('toggle'); }, 1500);
            },  
            error: function(xhr, textStatus, error){
                button.style.cursor = "pointer";
                console.error(xhr.statusText);
                console.error(textStatus);
                console.error(error);
            }
        });
    }

    /**
     * Sets background color of clicked button to gray, resets all others to white.
     * @param action
     * @private
     */
    function _resetButtonColors(action) {
        for (var button in self.resultButtons) {
            if (self.resultButtons.hasOwnProperty(button)) {
                self.resultButtons[button].css('background-color', 'white');
                self.resultButtons[button].css('color', 'black');
            }
        }
        var currButton = self.resultButtons[action];
        currButton.css('background-color', '#696969');
        currButton.css('color', 'white');
    }

    function showLabel(labelId) {
        _resetModal();

        self.modal.modal({
            'show': true
        });
        var adminLabelUrl = admin ? "/adminapi/label/id/" + labelId : "/label/id/" + labelId;
        $.getJSON(adminLabelUrl, function (data) {
            _handleData(data, admin);
        });
    }

    function _handleData(labelMetadata) {
        // Pass a callback function that fills in the pano lat/lng.
        var panoCallback = function () {
            var lat = self.panorama.panorama.getPosition().lat();
            var lng = self.panorama.panorama.getPosition().lng();
            self.modalGsvLink.html(`<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat}%2C${lng}&heading=${labelMetadata['heading']}&pitch=${labelMetadata['pitch']}" target="_blank">${i18next.t('common:gsv-info.view-in-gsv')}</a>`);
            self.modalLat.html(lat.toFixed(8) + '°');
            self.modalLng.html(lng.toFixed(8) + '°');
        }
        self.panorama.setPano(labelMetadata['gsv_panorama_id'], labelMetadata['heading'],
            labelMetadata['pitch'], labelMetadata['zoom'], panoCallback);

        var adminPanoramaLabel = AdminPanoramaLabel(labelMetadata['label_id'], labelMetadata['label_type_key'],
            labelMetadata['canvas_x'], labelMetadata['canvas_y'], labelMetadata['canvas_width'],
            labelMetadata['canvas_height'], labelMetadata['heading'], labelMetadata['pitch'], labelMetadata['zoom'],
            labelMetadata['street_edge_id']);
        self.panorama.setLabel(adminPanoramaLabel);

        var validationsText = '' + labelMetadata['num_agree'] + ' Agree, ' +
            labelMetadata['num_disagree'] + ' Disagree, ' +
            labelMetadata['num_notsure'] + ' Not Sure';

        var labelDate = moment(new Date(labelMetadata['timestamp']));
        var imageDate = moment(new Date(labelMetadata['image_date']));
        self.modalTitle.html('Label Type: ' + labelMetadata['label_type_value']);
        self.modalLabelTypeValue.html(labelMetadata['label_type_value']);
        self.modalSeverity.html(labelMetadata['severity'] != null ? labelMetadata['severity'] : "No severity");
        self.modalTemporary.html(labelMetadata['temporary'] ? i18next.t('common:yes'): i18next.t('common:no'));
        self.modalTags.html(labelMetadata['tags'].join(', ')); // Join to format using commas and spaces.
        self.modalDescription.html(labelMetadata['description'] != null ? labelMetadata['description'] : i18next.t('common:no-description'));
        self.modalValidations.html(validationsText);
        self.modalTimestamp.html(labelDate.format('LL, LT') + " (" + labelDate.fromNow() + ")");
        self.modalImageDate.html(imageDate.format('MMMM YYYY'));
        self.modalPanoId.html(labelMetadata['gsv_panorama_id']);
        self.modalLabelId.html(labelMetadata['label_id']);
        self.modalStreetId.html(labelMetadata['street_edge_id']);
        self.modalRegionId.html(labelMetadata['region_id']);
        if (self.admin) {
            self.modalTask.html("<a href='/admin/task/"+labelMetadata['audit_task_id']+"'>"+
                labelMetadata['audit_task_id']+"</a> by <a href='/admin/user/" + encodeURI(labelMetadata['username']) + "'>" +
                labelMetadata['username'] + "</a>");
        }
        // If the signed in user has already validated this label, make the button look like it has been clicked.
        if (labelMetadata['user_validation']) _resetButtonColors(labelMetadata['user_validation']);
    }

    _init();

    self.showLabel = showLabel;

    return self;
}

function Admin(_, $, difficultRegionIds) {
    var self = {};
    var mapLoaded = false;
    var graphsLoaded = false;
    var mapData = InitializeMapLayerContainer();
    var map;
    var auditedStreetLayer;
    var unauditedStreetLayer;
    var analyticsTabMapParams = {
        popupType: 'completionRate',
        regionColors: [
            '#08306b', '#08519c', '#08719c', '#2171b5', '#4292c6',
            '#6baed6', '#82badb', '#9ecae1', '#b3d3e8', '#c6dbef'
        ],
        neighborhoodPolygonStyle: {
            color: '#888',
            weight: 1,
            opacity: 0.25,
            fillColor: '#f00',
            fillOpacity: 1.0
        },
        mouseoverStyle: {
            opacity: 1.0,
            weight: 3,
            color: '#000'
        },
        mouseoutStyle: {
            opacity: 0.25,
            weight: 1,
            color: '#888'
        },
        polygonFillMode: 'completionRate',
        zoomControl: true,
        scrollWheelZoom: false,
        mapName: 'admin-choropleth',
        mapStyle: 'mapbox://styles/mapbox/light-v10'
    };
    var mapTabMapParams = {
        popupType: 'none',
        neighborhoodPolygonStyle: {
            color: '#888',
            weight: 2,
            opacity: 0.80,
            fillColor: '#808080',
            fillOpacity: 0.1
        },
        mouseoverStyle: {
            color: '#000',
            opacity: 1.0,
            weight: 3
        },
        mouseoutStyle: {
            color: '#888',
            opacity: 0.8,
            weight: 2
        },
        polygonFillMode: 'singleColor',
        scrollWheelZoom: true,
        zoomControl: true,
        mapName: 'label-map',
        mapStyle: 'mapbox://styles/mapbox/streets-v11'
    };
    var streetParams = {
        labelPopup: true,
        includeLabelColor: true,
        auditedStreetColor: 'black',
        unauditedStreetColor: 'gray'
    };

    function initializeAdminGSVLabelView() {
        self.adminGSVLabelView = AdminGSVLabelView(true);
    }

    function initializeAdminGSVCommentView(){
        self.adminGSVCommentView = AdminGSVCommentView(true);
    }

    function initializeAdminGSVCommentWindow(){
        $('.show-comment-location').click(function(e) { 
            e.preventDefault();
            var heading = parseFloat($(this).data('heading'));
            var pitch = parseFloat($(this).data('pitch'));
            var zoom = Number($(this).data('zoom'));
            var labelId = parseInt($(this).data('labelId'));
            self.adminGSVCommentView.showCommentGSV(this.innerHTML, heading, pitch, zoom, labelId);
        });
    }

    function initializeAdminLabelSearch() {
        self.adminLabelSearch = AdminLabelSearch();
    }

    function initializeLabelTable() {
        $('.labelView').click(function (e) {
            e.preventDefault();
            self.adminGSVLabelView.showLabel($(this).data('labelId'));
        });
    }

    function isResearcherRole(roleName) {
        return ['Researcher', 'Administrator', 'Owner'].indexOf(roleName) > 0;
    }

    function toggleLayersAdmin(label, checkboxId, sliderId) {
        toggleLayers(label, checkboxId, sliderId, map, mapData);
    }

    function filterLayersAdmin(checkboxId) {
        filterLayers(checkboxId, mapData);
    }

    function toggleAuditedStreetLayerAdmin() {
        toggleAuditedStreetLayer(map, auditedStreetLayer);
    }

    function toggleUnauditedStreetLayerAdmin() {
        toggleUnauditedStreetLayer(map, unauditedStreetLayer);
    }

    // Takes an array of objects and the name of a property of the objects, returns summary stats for that property.
    function getSummaryStats(data, col, options) {
        options = options || {};
        var excludeResearchers = options.excludeResearchers || false;

        var sum = 0;
        var filteredData = [];
        for (var j = 0; j < data.length; j++) {
            if (!excludeResearchers || !isResearcherRole(data[j].role)) {
                sum += data[j][col];
                filteredData.push(data[j])
            }
        }
        var mean = sum / filteredData.length;
        var i = filteredData.length / 2;
        filteredData.sort(function(a, b) {return (a[col] > b[col]) ? 1 : ((b[col] > a[col]) ? -1 : 0);} );

        var median = 0;
        var max = 0;
        var min = 0;

        if (filteredData.length > 0) { // Prevent errors in development where there may be no data
            median = (filteredData.length / 2) % 1 == 0 ? (filteredData[i - 1][col] + filteredData[i][col]) / 2 : filteredData[Math.floor(i)][col];
            min = filteredData[0][col];
            max = filteredData[filteredData.length-1][col];
        }

        var std = 0;
        for(var k = 0; k < filteredData.length; k++) {
            std += Math.pow(filteredData[k][col] - mean, 2);
        }
        std /= filteredData.length;
        std = Math.sqrt(std);

        return {mean:mean, median:median, std:std, min:min, max:max};
    }

    // takes in some data, summary stats, and optional arguments, and outputs the spec for a vega-lite chart
    function getVegaLiteHistogram(data, mean, median, options) {
        options = options || {};
        var xAxisTitle = options.xAxisTitle || "TODO, fill in x-axis title";
        var yAxisTitle = options.yAxisTitle || "Counts";
        var height = options.height || 300;
        var width = options.width || 600;
        var col = options.col || "count"; // most graphs we are making are made of up counts
        var xDomain = options.xDomain || [0, data[data.length-1][col]];
        var binStep = options.binStep || 1;
        var legendOffset = options.legendOffset || 0;
        var excludeResearchers = options.excludeResearchers || false;

        // var transformList = excludeResearchers ? [{"filter": "!datum.is_researcher"}] : [];
        var nonResearcherRoles = ['Registered', 'Anonymous', 'Turker'];
        var transformList = excludeResearchers ? [{"filter": {"field": "role", "oneOf": nonResearcherRoles}}] : [];

        return {
            "height": height,
            "width": width,
            "data": {"values": data},
            "transform": transformList,
            "layer": [
                {
                    "mark": "bar",
                    "encoding": {
                        "x": {
                            "field": col,
                            "type": "quantitative",
                            "axis": {"title": xAxisTitle, "labelAngle": 0, "tickCount":8},
                            "bin": {"step": binStep}
                        },
                        "y": {
                            "aggregate": "count",
                            "field": "*",
                            "type": "quantitative",
                            "axis": {
                                "title": yAxisTitle
                            }
                        }
                    }
                },
                { // creates lines marking summary statistics
                    "data": {"values": [
                        {"stat": "mean", "value": mean}, {"stat": "median", "value": median}]
                    },
                    "mark": "rule",
                    "encoding": {
                        "x": {
                            "field": "value", "type": "quantitative",
                            "axis": {"labels": false, "ticks": false, "title": "", "grid": false},
                            "scale": {"domain": xDomain}
                        },
                        "color": {
                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                            "legend": {
                                "title": "Summary Stats",
                                "values": ["mean: " + mean.toFixed(2), "median: " + median.toFixed(2)],
                                "offset": legendOffset
                            }
                        },
                        "size": {
                            "value": 2
                        }
                    }
                }
            ],
            "resolve": {"x": {"scale": "independent"}},
            "config": {
                "axis": {
                    "titleFontSize": 16
                }
            }
        };
    }

    $('.nav-pills').on('click', function (e) {
        if (e.target.id == "visualization" && mapLoaded == false) {
            var loadPolygons = $.getJSON('/neighborhoods');
            var loadPolygonRates = $.getJSON('/adminapi/neighborhoodCompletionRate');
            var loadMapParams = $.getJSON('/cityMapParams');
            var loadStreets = $.getJSON('/contribution/streets/all');
            var loadSubmittedLabels = $.getJSON('/labels/all');
            // When the polygons, polygon rates, and map params are all loaded the polygon regions can be rendered.
            var renderPolygons = $.when(loadPolygons, loadPolygonRates, loadMapParams).done(function(data1, data2, data3) {
                map = Choropleth(_, $, difficultRegionIds, mapTabMapParams, [], data1[0], data2[0], data3[0]);
            });
            // When the polygons have been rendered and the audited streets have loaded, the streets can be rendered.
            var renderStreets = $.when(renderPolygons, loadStreets).done(function(data1, data2) {
                var auditedStreets = { features: data2[0].features.filter(edges => edges.properties.audited) };
                var unauditedStreets = { features: data2[0].features.filter(edges => !edges.properties.audited) };
                auditedStreetLayer = InitializeStreets(map, streetParams, auditedStreets);
                unauditedStreetLayer = InitializeStreets(map, streetParams, unauditedStreets);
            });
            // When the audited streets have been rendered and the submitted labels have loaded,
            // the submitted labels can be rendered.
            $.when(renderStreets, loadSubmittedLabels).done(function(data1, data2) {
                mapData = InitializeSubmittedLabels(map, streetParams, AdminGSVLabelView(true), mapData, data2[0])
            })
            mapLoaded = true;
        }
        else if (e.target.id == "analytics" && graphsLoaded == false) {

            var opt = {
                "mode": "vega-lite",
                "actions": false
            };

            $.getJSON("/adminapi/completionRateByDate", function (data) {
                var chart = {
                    "data": {"values": data[0], "format": {"type": "json"}},
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    },
                    "vconcat": [
                        {
                            "height":300,
                            "width": 875,
                            "mark": "area",
                            "encoding": {
                                "x": {
                                    "field": "date",
                                    "type": "temporal",
                                    "scale": {"domain": {"selection": "brush", "field": "date"}},
                                    "axis": {"title": "Date", "labelAngle": 0}
                                },
                                "y": {
                                    "field": "completion", 
                                    "type": "quantitative", "scale": {
                                        "domain": [0,100]
                                    },
                                    "axis": {"title": "City Coverage (%)"}
                                }
                            }
                        },
                        {
                        "height": 60,
                        "width": 875,
                        "mark": "area",
                        "selection": {"brush": {"type": "interval", "encodings": ["x"]}},
                        "encoding": {
                            "x": {
                                "field": "date", 
                                "type": "temporal",
                                "axis": {"title": "Date", "labelAngle": 0}
                            },
                            "y": {
                                "field": "completion",
                                "type": "quantitative", "scale": {
                                    "domain": [0,100]
                                },
                                "axis": {
                                    "title": "City Coverage (%)",
                                    "tickCount": 3, "grid": true}
                            }
                        }
                        }
                    ]
                };
                vega.embed("#completion-progress-chart", chart, opt, function(error, results) {});
            });

            $.getJSON('/adminapi/labels/all', function (data) {
                for (var i = 0; i < data.features.length; i++) {
                    data.features[i].label_type = data.features[i].properties.label_type;
                    data.features[i].severity = data.features[i].properties.severity;
                }
                var curbRamps = data.features.filter(function(label) {return label.properties.label_type === "CurbRamp"});
                var noCurbRamps = data.features.filter(function(label) {return label.properties.label_type === "NoCurbRamp"});
                var obstacles = data.features.filter(function(label) {return label.properties.label_type === "Obstacle"});
                var surfaceProblems = data.features.filter(function(label) {return label.properties.label_type === "SurfaceProblem"});
                var noSidewalks = data.features.filter(function(label) {return label.properties.label_type === "NoSidewalk"});
                var crosswalks = data.features.filter(function(label) {return label.properties.label_type === "Crosswalk"});
                var pedestrianSignals = data.features.filter(function(label) {return label.properties.label_type === "Signal"});
                
                var curbRampStats = getSummaryStats(curbRamps, "severity");
                $("#curb-ramp-mean").html((curbRampStats.mean).toFixed(2));
                $("#curb-ramp-std").html((curbRampStats.std).toFixed(2));
                
                var noCurbRampStats = getSummaryStats(noCurbRamps, "severity");
                $("#missing-ramp-mean").html((noCurbRampStats.mean).toFixed(2));
                $("#missing-ramp-std").html((noCurbRampStats.std).toFixed(2));
                
                var obstacleStats = getSummaryStats(obstacles, "severity");
                $("#obstacle-mean").html((obstacleStats.mean).toFixed(2));
                $("#obstacle-std").html((obstacleStats.std).toFixed(2));

                var surfaceProblemStats = getSummaryStats(surfaceProblems, "severity");
                $("#surface-mean").html((surfaceProblemStats.mean).toFixed(2));
                $("#surface-std").html((surfaceProblemStats.std).toFixed(2));
                
                var noSidewalkStats = getSummaryStats(noSidewalks, "severity");
                $("#no-sidewalk-mean").html((noSidewalkStats.mean).toFixed(2));
                $("#no-sidewalk-std").html((noSidewalkStats.std).toFixed(2));
                
                var crosswalkStats = getSummaryStats(crosswalks, "severity");
                $("#crosswalk-mean").html((crosswalkStats.mean).toFixed(2));
                $("#crosswalk-std").html((crosswalkStats.std).toFixed(2));

                var pedestrianSignalStats = getSummaryStats(pedestrianSignals, "severity");
                $("#signal-mean").html((pedestrianSignalStats.mean).toFixed(2));
                $("#signal-std").html((pedestrianSignalStats.std).toFixed(2));

                var allData = data.features;
                var allDataStats = getSummaryStats(allData, "severity");
                $("#labels-mean").html((allDataStats.mean).toFixed(2));
                $("#labels-std").html((allDataStats.std).toFixed(2));

                var subPlotHeight = 150; // Before, it was 150
                var subPlotWidth = 130; // Before, it was 149

                var chart = {
                    "hconcat": [
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": curbRamps},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Curb Ramp Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": "# of labels"}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": obstacles},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Obstacle Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": noSidewalks},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "No Sidewalk Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": pedestrianSignals},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Pedestrian Signal Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 10
                        }
                    }
                };

                var chart2 = {
                    "hconcat": [
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": noCurbRamps},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Missing Curb Ramp Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": "# of labels"}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": surfaceProblems},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Surface Problem Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": crosswalks},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Crosswalk Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 10
                        }
                    }
                };

                vega.embed("#severity-histograms", chart, opt, function(error, results) {});
                vega.embed("#severity-histograms2", chart2, opt, function(error, results) {});
            });
            $.getJSON('/adminapi/neighborhoodCompletionRate', function (data) {
                // Create a choropleth.
                var loadPolygons = $.getJSON('/neighborhoods');
                var loadPolygonRates = $.getJSON('/adminapi/neighborhoodCompletionRate');
                var loadMapParams = $.getJSON('/cityMapParams');
                $.when(loadPolygons, loadPolygonRates, loadMapParams).done(function(data1, data2, data3) {
                    Choropleth(_, $, difficultRegionIds, analyticsTabMapParams, [], data1[0], data2[0], data3[0]);
                });

                // Make charts showing neighborhood completion rate.
                for (var j = 0; j < data.length; j++) {
                    data[j].rate *= 100.0; // change from proportion to percent
                }
                var stats = getSummaryStats(data, "rate");
                $("#neighborhood-std").html((stats.std).toFixed(2) + "%");

                var coverageRateChartSortedByCompletion = {
                    "width": 810,
                    "height": 1200,
                    "data": {
                        "values": data, "format": {
                            "type": "json"
                        }
                    },
                    "mark": "bar",
                    "encoding": {
                        "x": {
                            "field": "rate", "type": "quantitative",
                            "axis": {"title": "Neighborhood Completion (%)"}
                        },
                        "y": {
                            "field": "name", "type": "nominal",
                            "axis": {"title": "Neighborhood"},
                            "sort": {"field": "rate", "op": "max", "order": "ascending"}
                        }
                    },
                    "config": {
                        "axis": {"titleFontSize": 16, "labelFontSize": 8}
                    }
                };

                var coverageRateChartSortedAlphabetically = {
                    "width": 810,
                    "height": 1200,
                    "data": {
                        "values": data, "format": {
                            "type": "json"
                        }
                    },
                    "mark": "bar",
                    "encoding": {
                        "x": {
                            "field": "rate", "type": "quantitative",
                            "axis": {"title": "Neighborhood Completion (%)"}
                        },
                        "y": {
                            "field": "name", "type": "nominal",
                            "axis": {"title": "Neighborhood"},
                            "sort": {"field": "name", "op": "max", "order": "descending"}
                        }
                    },
                    "config": {
                        "axis": {"titleFontSize": 16, "labelFontSize": 8}
                    }
                };
                vega.embed("#neighborhood-completion-rate", coverageRateChartSortedByCompletion, opt, function(error, results) {});

                document.getElementById("neighborhood-completion-sort-button").addEventListener("click", function() {
                    vega.embed("#neighborhood-completion-rate", coverageRateChartSortedByCompletion, opt, function(error, results) {});
                });
                document.getElementById("neighborhood-alphabetical-sort-button").addEventListener("click", function() {
                    vega.embed("#neighborhood-completion-rate", coverageRateChartSortedAlphabetically, opt, function(error, results) {});
                });

                var histOpts = {col: "rate", xAxisTitle:"Neighborhood Completion (%)", xDomain:[0, 100],
                                width:400, height:250, binStep:10};
                var coverageRateHist = getVegaLiteHistogram(data, stats.mean, stats.median, histOpts);

                vega.embed("#neighborhood-completed-distance", coverageRateHist, opt, function(error, results) {});

            });
            $.getJSON('/adminapi/validationCounts', function (data) {
                var filteredData = data[0].map(function(x) {
                    return {
                        role: x.role,
                        total: x.count,
                        agreed: x.agreed,
                    }
                });

                var pcts = filteredData.filter(function(x) { // Must have 10+ labels validated
                    return x.total >= 10;
                }).map(function (x) { // Convert to percentages
                    return {
                        count: (x.agreed / x.total) * 100,
                        role: x.role
                    };
                });

                var stats = getSummaryStats(pcts, "count");
                $("#validation-agreed-std").html((stats.std).toFixed(2) + " %");

                var histOpts = {xAxisTitle:"Validations Placed Agreed With (%)", xDomain:[0, 100], binStep:5};
                var coverageRateHist = getVegaLiteHistogram(pcts, stats.mean, stats.median, histOpts);
                vega.embed("#validation-agreed", coverageRateHist, opt, function(error, results) {});

            });
            $.getJSON("/contribution/auditCounts/all", function (data) {
                var stats = getSummaryStats(data[0], "count");

                $("#audit-std").html((stats.std).toFixed(2) + " Street Audits");

                var histOpts = {xAxisTitle:"# Street Audits per Day", xDomain:[0, stats.max], width:250, binStep:50, legendOffset:-80};
                var hist = getVegaLiteHistogram(data[0], stats.mean, stats.median, histOpts);

                var chart = {
                    "data": {"values": data[0]},
                    "hconcat": [
                        {
                            "height": 300,
                            "width": 550,
                            "layer": [
                                {
                                    "mark": "bar",
                                    "encoding": {
                                        "x": {
                                            "field": "date",
                                            "type": "temporal",
                                            "axis": {"title": "Date", "labelAngle": 0}
                                        },
                                        "y": {
                                            "field": "count",
                                            "type": "quantitative",
                                            "axis": {
                                                "title": "# Street Audits per Day"
                                            }
                                        }
                                    }
                                },
                                { // creates lines marking summary statistics
                                    "data": {"values": [
                                        {"stat": "mean", "value": stats.mean}, {"stat": "median", "value": stats.median}]
                                    },
                                    "mark": "rule",
                                    "encoding": {
                                        "y": {
                                            "field": "value", "type": "quantitative",
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, stats.max]}
                                        },
                                        "color": {
                                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                                            "legend": false
                                        },
                                        "size": {
                                            "value": 1
                                        }
                                    }
                                }
                            ],
                            "resolve": {"y": {"scale": "independent"}}
                        },
                        hist
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                vega.embed("#audit-count-chart", chart, opt, function(error, results) {});
            });
            $.getJSON("/userapi/labelCounts/all", function (data) {
                var stats = getSummaryStats(data[0], "count");
                $("#label-std").html((stats.std).toFixed(2) + " Labels");

                var histOpts = {xAxisTitle:"# Labels per Day", xDomain:[0, stats.max], width:250, binStep:200, legendOffset:-80};
                var hist = getVegaLiteHistogram(data[0], stats.mean, stats.median, histOpts);

                var chart = {
                    "data": {"values": data[0]},
                    "hconcat": [
                        {
                            "height": 300,
                            "width": 550,
                            "layer": [
                                {
                                    "mark": "bar",
                                    "encoding": {
                                        "x": {
                                            "field": "date",
                                            "type": "temporal",
                                            "axis": {"title": "Date", "labelAngle": 0}
                                        },
                                        "y": {
                                            "field": "count",
                                            "type": "quantitative",
                                            "axis": {
                                                "title": "# Labels per Day"
                                            }
                                        }
                                    }
                                },
                                { // creates lines marking summary statistics
                                    "data": {"values": [
                                            {"stat": "mean", "value": stats.mean}, {"stat": "median", "value": stats.median}]
                                    },
                                    "mark": "rule",
                                    "encoding": {
                                        "y": {
                                            "field": "value", "type": "quantitative",
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, stats.max]}
                                        },
                                        "color": {
                                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                                            "legend": false
                                        },
                                        "size": {
                                            "value": 2
                                        }
                                    }
                                }
                            ],
                            "resolve": {"y": {"scale": "independent"}}
                        },
                        hist
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                vega.embed("#label-count-chart", chart, opt, function(error, results) {});
            });
            $.getJSON("/userapi/validationCounts/all", function (data) {
                var stats = getSummaryStats(data[0], "count");
                $("#validation-std").html((stats.std).toFixed(2) + " Validations");

                var histOpts = {xAxisTitle:"# Validations per Day", xDomain:[0, stats.max], width:250, binStep:200, legendOffset:-80};
                var hist = getVegaLiteHistogram(data[0], stats.mean, stats.median, histOpts);

                var chart = {
                    "data": {"values": data[0]},
                    "hconcat": [
                        {
                            "height": 300,
                            "width": 550,
                            "layer": [
                                {
                                    "mark": "bar",
                                    "encoding": {
                                        "x": {
                                            "field": "date",
                                            "type": "temporal",
                                            "axis": {"title": "Date", "labelAngle": 0}
                                        },
                                        "y": {
                                            "field": "count",
                                            "type": "quantitative",
                                            "axis": {
                                                "title": "# Validations per Day"
                                            }
                                        }
                                    }
                                },
                                { // creates lines marking summary statistics
                                    "data": {"values": [
                                            {"stat": "mean", "value": stats.mean}, {"stat": "median", "value": stats.median}]
                                    },
                                    "mark": "rule",
                                    "encoding": {
                                        "y": {
                                            "field": "value", "type": "quantitative",
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, stats.max]}
                                        },
                                        "color": {
                                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                                            "legend": false
                                        },
                                        "size": {
                                            "value": 2
                                        }
                                    }
                                }
                            ],
                            "resolve": {"y": {"scale": "independent"}}
                        },
                        hist
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                vega.embed("#validation-count-chart", chart, opt, function(error, results) {});
            });
            $.getJSON("/adminapi/userMissionCounts", function (data) {
                var allData = data[0];
                var regData = allData.filter(user => user.role === 'Registered' || isResearcherRole(user.role));
                var anonData = allData.filter(user => user.role === 'Anonymous');
                var turkerData = allData.filter(user => user.role === 'Turker');

                var allStats = getSummaryStats(allData, "count");
                var allFilteredStats = getSummaryStats(allData, "count", {excludeResearchers: true});
                var regStats = getSummaryStats(regData, "count");
                var regFilteredStats = getSummaryStats(regData, "count", {excludeResearchers: true});
                var turkerStats = getSummaryStats(turkerData, "count");
                var anonStats = getSummaryStats(anonData, "count");

                $("#missions-std").html((allFilteredStats.std).toFixed(2) + " Missions");
                $("#reg-missions-std").html((regFilteredStats.std).toFixed(2) + " Missions");
                $("#turker-missions-std").html((turkerStats.std).toFixed(2) + " Missions");
                $("#anon-missions-std").html((anonStats.std).toFixed(2) + " Missions");

                var allHistOpts = {
                    xAxisTitle: "# Missions per User (all)", xDomain: [0, allStats.max], width: 187,
                    binStep: 15, legendOffset: -80
                };
                var allFilteredHistOpts = {
                    xAxisTitle: "# Missions per User (all)", xDomain: [0, allFilteredStats.max],
                    width: 187, binStep: 15, legendOffset: -80, excludeResearchers: true
                };
                var regHistOpts = {
                    xAxisTitle: "# Missions per Registered User", xDomain: [0, regStats.max], width: 187,
                    binStep: 10, legendOffset: -80
                };
                var regFilteredHistOpts = {
                    xAxisTitle: "# Missions per Registered User", width: 187, legendOffset: -80,
                    xDomain: [0, regFilteredStats.max], excludeResearchers: true, binStep: 10
                };
                var turkerHistOpts = {
                    xAxisTitle: "# Missions per Turker User", xDomain: [0, turkerStats.max], width: 187,
                    binStep: 15, legendOffset: -80
                };
                var anonHistOpts = {
                    xAxisTitle: "# Missions per Anon User", xDomain: [0, anonStats.max], width: 187,
                    binStep: 1, legendOffset: -80
                };

                var allChart = getVegaLiteHistogram(allData, allStats.mean, allStats.median, allHistOpts);
                var allFilteredChart = getVegaLiteHistogram(allData, allFilteredStats.mean, allFilteredStats.median, allFilteredHistOpts);
                var regChart = getVegaLiteHistogram(regData, regStats.mean, regStats.median, regHistOpts);
                var regFilteredChart = getVegaLiteHistogram(regData, regFilteredStats.mean, regFilteredStats.median, regFilteredHistOpts);
                var turkerChart = getVegaLiteHistogram(turkerData, turkerStats.mean, turkerStats.median, turkerHistOpts);
                var anonChart = getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median, anonHistOpts);

                // Only includes charts with data as charts with no data prevent all charts from rendering.
                var combinedChart = {"hconcat": []};
                var combinedChartFiltered = {"hconcat": []};
                
                [allChart, regChart, turkerChart, anonChart].forEach(element => {
                    if (element.data.values.length > 0) {
                        combinedChart.hconcat.push(element);
                    }
                });
                
                [allFilteredChart, regFilteredChart, turkerChart, anonChart].forEach(element => {
                    if (element.data.values.length > 0) {
                        combinedChartFiltered.hconcat.push(element);
                    }
                });

                vega.embed("#mission-count-chart", combinedChartFiltered, opt, function (error, results) {
                });

                var checkbox = document.getElementById("mission-count-include-researchers-checkbox").addEventListener("click", function (cb) {
                    if (cb.srcElement.checked) {
                        $("#missions-std").html((allStats.std).toFixed(2) + " Missions");
                        $("#reg-missions-std").html((regStats.std).toFixed(2) + " Missions");
                        vega.embed("#mission-count-chart", combinedChart, opt, function (error, results) {
                        });
                    } else {
                        $("#missions-std").html((allFilteredStats.std).toFixed(2) + " Missions");
                        $("#reg-missions-std").html((regFilteredStats.std).toFixed(2) + " Missions");
                        vega.embed("#mission-count-chart", combinedChartFiltered, opt, function (error, results) {
                        });
                    }
                });
            });
            $.getJSON("/adminapi/labelCounts", function (data) {
                var allData = data[0];
                var regData = allData.filter(user => user.role === 'Registered' || isResearcherRole(user.role));
                var turkerData = allData.filter(user => user.role === 'Turker');
                var anonData = allData.filter(user => user.role === 'Anonymous');

                var allStats = getSummaryStats(allData, "count");
                var allFilteredStats = getSummaryStats(allData, "count", {excludeResearchers: true});
                var regStats = getSummaryStats(regData, "count");
                var regFilteredStats = getSummaryStats(regData, "count", {excludeResearchers: true});
                var turkerStats = getSummaryStats(turkerData, "count");
                var anonStats = getSummaryStats(anonData, "count");

                $("#all-labels-std").html((allFilteredStats.std).toFixed(2) + " Labels");
                $("#reg-labels-std").html((regFilteredStats.std).toFixed(2) + " Labels");
                $("#turker-labels-std").html((turkerStats.std).toFixed(2) + " Labels");
                $("#anon-labels-std").html((anonStats.std).toFixed(2) + " Labels");

                var allHistOpts = {
                    xAxisTitle: "# Labels per User (all)", xDomain: [0, allStats.max], width: 187,
                    binStep: 500, legendOffset: -80
                };
                var allFilteredHistOpts = {
                    xAxisTitle: "# Labels per User (all)", xDomain: [0, allFilteredStats.max],
                    width: 187, binStep: 500, legendOffset: -80, excludeResearchers: true
                };
                var regHistOpts = {
                    xAxisTitle: "# Labels per Registered User", xDomain: [0, regStats.max], width: 187,
                    binStep: 500, legendOffset: -80
                };
                var regFilteredHistOpts = {
                    xAxisTitle: "# Labels per Registered User", width: 187, legendOffset: -80,
                    xDomain: [0, regFilteredStats.max], excludeResearchers: true, binStep: 500
                };
                var turkerHistOpts = {
                    xAxisTitle: "# Labels per Turker User", xDomain: [0, turkerStats.max], width: 187,
                    binStep: 500, legendOffset: -80
                };
                var anonHistOpts = {
                    xAxisTitle: "# Labels per Anon User", xDomain: [0, anonStats.max],
                    width: 187, legendOffset: -80, binStep: 2
                };

                var allChart = getVegaLiteHistogram(allData, allStats.mean, allStats.median, allHistOpts);
                var allFilteredChart = getVegaLiteHistogram(allData, allFilteredStats.mean, allFilteredStats.median, allFilteredHistOpts);
                var regChart = getVegaLiteHistogram(regData, regStats.mean, regStats.median, regHistOpts);
                var regFilteredChart = getVegaLiteHistogram(regData, regFilteredStats.mean, regFilteredStats.median, regFilteredHistOpts);
                var turkerChart = getVegaLiteHistogram(turkerData, turkerStats.mean, turkerStats.median, turkerHistOpts);
                var anonChart = getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median, anonHistOpts);

                // Only includes charts with data as charts with no data prevent all charts from rendering.
                var combinedChart = {"hconcat": []};
                var combinedChartFiltered = {"hconcat": []};

                [allChart, regChart, turkerChart, anonChart].forEach(element => {
                    if (element.data.values.length > 0) {
                        combinedChart.hconcat.push(element);
                    }
                });
                
                [allFilteredChart, regFilteredChart, turkerChart, anonChart].forEach(element => {
                    if (element.data.values.length > 0) {
                        combinedChartFiltered.hconcat.push(element);
                    }
                });

                vega.embed("#label-count-hist", combinedChartFiltered, opt, function (error, results) {
                });

                var checkbox = document.getElementById("label-count-include-researchers-checkbox").addEventListener("click", function (cb) {
                    if (cb.srcElement.checked) {
                        $("#all-labels-std").html((allStats.std).toFixed(2) + " Labels");
                        $("#reg-labels-std").html((regStats.std).toFixed(2) + " Labels");
                        vega.embed("#label-count-hist", combinedChart, opt, function (error, results) {
                        });
                    } else {
                        $("#all-labels-std").html((allFilteredStats.std).toFixed(2) + " Labels");
                        $("#reg-labels-std").html((regFilteredStats.std).toFixed(2) + " Labels");
                        vega.embed("#label-count-hist", combinedChartFiltered, opt, function (error, results) {
                        });
                    }
                });
            });
            $.getJSON("/adminapi/validationCounts", function (data) {
                var allData = data[0];
                var regData = allData.filter(user => user.role === 'Registered' || isResearcherRole(user.role));
                var turkerData = allData.filter(user => user.role === 'Turker');
                var anonData = allData.filter(user => user.role === 'Anonymous');

                var allStats = getSummaryStats(allData, "count");
                var allFilteredStats = getSummaryStats(allData, "count", {excludeResearchers: true});
                var regStats = getSummaryStats(regData, "count");
                var regFilteredStats = getSummaryStats(regData, "count", {excludeResearchers: true});
                var turkerStats = getSummaryStats(turkerData, "count");
                var anonStats = getSummaryStats(anonData, "count");

                $("#all-validation-std").html((allFilteredStats.std).toFixed(2) + " labels");
                $("#reg-validation-std").html((regFilteredStats.std).toFixed(2) + " labels");
                $("#turker-validation-std").html((turkerStats.std).toFixed(2) + " labels");
                $("#anon-validation-std").html((anonStats.std).toFixed(2) + " labels");

                var allHistOpts = {
                    xAxisTitle: "# Labels Validated per User (all)", xDomain: [0, allStats.max], width: 187,
                    binStep: 50, legendOffset: -80
                };
                var allFilteredHistOpts = {
                    xAxisTitle: "# Labels Validated per User (all)", xDomain: [0, allFilteredStats.max],
                    width: 187, binStep: 50, legendOffset: -80, excludeResearchers: true
                };
                var regHistOpts = {
                    xAxisTitle: "# Labels Validated per Registered User", xDomain: [0, regStats.max], width: 187,
                    binStep: 50, legendOffset: -80
                };
                var regFilteredHistOpts = {
                    xAxisTitle: "# Labels Validated per Registered User", width: 187, legendOffset: -80,
                    xDomain: [0, regFilteredStats.max], excludeResearchers: true, binStep: 50
                };
                var turkerHistOpts = {
                    xAxisTitle: "# Labels Validated per Turker User", xDomain: [0, turkerStats.max], width: 187,
                    binStep: 50, legendOffset: -80
                };
                var anonHistOpts = {
                    xAxisTitle: "# Labels Validated per Anon User", xDomain: [0, anonStats.max],
                    width: 187, legendOffset: -80, binStep: 2
                };

                var allChart = getVegaLiteHistogram(allData, allStats.mean, allStats.median, allHistOpts);
                var allFilteredChart = getVegaLiteHistogram(allData, allFilteredStats.mean, allFilteredStats.median, allFilteredHistOpts);
                var regChart = getVegaLiteHistogram(regData, regStats.mean, regStats.median, regHistOpts);
                var regFilteredChart = getVegaLiteHistogram(regData, regFilteredStats.mean, regFilteredStats.median, regFilteredHistOpts);
                var turkerChart = getVegaLiteHistogram(turkerData, turkerStats.mean, turkerStats.median, turkerHistOpts);
                var anonChart = getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median, anonHistOpts);

                // Only includes charts with data as charts with no data prevent all charts from rendering.
                var combinedChart = {"hconcat": []};
                var combinedChartFiltered = {"hconcat": []};

                [allChart, regChart, turkerChart, anonChart].forEach(element => {
                    if (element.data.values.length > 0) {
                        combinedChart.hconcat.push(element);
                    }
                });
                
                [allFilteredChart, regFilteredChart, turkerChart, anonChart].forEach(element => {
                    if (element.data.values.length > 0) {
                        combinedChartFiltered.hconcat.push(element);
                    }
                });

                vega.embed("#validation-count-hist", combinedChartFiltered, opt, function (error, results) {
                });

                var checkbox = document.getElementById("validation-count-include-researchers-checkbox").addEventListener("click", function (cb) {
                    if (cb.srcElement.checked) {
                        $("#all-validation-std").html((allStats.std).toFixed(2) + " Validations");
                        $("#reg-validation-std").html((regStats.std).toFixed(2) + " Validations");
                        vega.embed("#validation-count-hist", combinedChart, opt, function (error, results) {
                        });
                    } else {
                        $("#all-validation-std").html((allFilteredStats.std).toFixed(2) + " Validations");
                        $("#reg-validation-std").html((regFilteredStats.std).toFixed(2) + " Validations");
                        vega.embed("#validation-count-hist", combinedChartFiltered, opt, function (error, results) {
                        });
                    }
                });
            });
            $.getJSON("/adminapi/allSignInCounts", function (data) {
                var stats = getSummaryStats(data[0], "count");
                var filteredStats = getSummaryStats(data[0], "count", {excludeResearchers:true});
                var histOpts = {xAxisTitle:"# Logins per Registered User", binStep:5, xDomain:[0, stats.max]};
                var histFilteredOpts = {xAxisTitle:"# Logins per Registered User", xDomain:[0, filteredStats.max],
                                        excludeResearchers:true};

                var chart = getVegaLiteHistogram(data[0], stats.mean, stats.median, histOpts);
                var filteredChart = getVegaLiteHistogram(data[0], filteredStats.mean, filteredStats.median, histFilteredOpts);

                $("#login-count-std").html((filteredStats.std).toFixed(2) + " Logins");
                vega.embed("#login-count-chart", filteredChart, opt, function(error, results) {});

                var checkbox = document.getElementById("login-count-include-researchers-checkbox").addEventListener("click", function(cb) {
                    if (cb.srcElement.checked) {
                        $("#login-count-std").html((stats.std).toFixed(2) + " Logins");
                        vega.embed("#login-count-chart", chart, opt, function (error, results) {});
                    } else {
                        $("#login-count-std").html((filteredStats.std).toFixed(2) + " Logins");
                        vega.embed("#login-count-chart", filteredChart, opt, function(error, results) {});
                    }
                });
            });

            // Creates chart showing how many audit page visits there are, how many people click via choropleth, how
            // many click "start exploring" on navbar, and how many click "start exploring" on the landing page itself.
            $.getJSON("/adminapi/webpageActivity/Visit_Audit", function(visitAuditEvents){
            $.getJSON("/adminapi/webpageActivity/Click/module=StartExploring/location=Index", function(clickStartExploringMainIndexEvents){
            $.getJSON("/adminapi/webpageActivity/Click/module=Choropleth/target=audit", function(choroplethClickEvents){
            $.getJSON("/adminapi/webpageActivity/Referrer=mturk", function(turkerRedirectEvents){
            // YES, we encode twice. This solves an issue with routing on the test/production server. AdminController.scala decodes twice.
            $.getJSON("/adminapi/webpageActivity/Click/module=StartExploring/location=Navbar/"+encodeURIComponent(encodeURIComponent("route=/")), function(clickStartExploringNavIndexEvents){
            $.getJSON("/adminapi/webpageActivity/Click/module=StartMapping/location=Navbar/"+encodeURIComponent(encodeURIComponent("route=/")), function(clickStartMappingNavIndexEvents){
                // Only consider events that take place after all logging was merged (timestamp equivalent to July 20, 2017 17:02:00)
                // TODO switch this to make use of versioning on the backend once it is implemented...
                // See: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/653
                var numVisitAudit = visitAuditEvents[0].filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;
                var numClickStartMappingMainIndex = clickStartExploringMainIndexEvents[0].filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;
                var numChoroplethClicks = choroplethClickEvents[0].filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;
                var numTurkerRedirects = turkerRedirectEvents[0].filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;
                var numClickStartMappingNavIndex = clickStartMappingNavIndexEvents[0].concat(clickStartExploringNavIndexEvents[0]).filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;

                // Fill in values in "How users access Audit Page from Landing Page:" table
                $("#audit-access-table-start-main").append(
                    '<td style="text-align: right;">'+
                        numClickStartMappingMainIndex+
                    '</td>'+
                    '<td style="text-align: right;">'+
                        (parseInt(numClickStartMappingMainIndex)/parseInt(numVisitAudit)*100).toFixed(1)+'%'+
                    '</td>'
                );
                $("#audit-access-table-start-nav").append(
                    '<td style="text-align: right;">'+
                        numClickStartMappingNavIndex+
                    '</td>'+
                    '<td style="text-align: right;">'+
                        (parseInt(numClickStartMappingNavIndex)/parseInt(numVisitAudit)*100).toFixed(1)+'%'+
                    '</td>'
                );
                $("#audit-access-table-choro").append(
                    '<td style="text-align: right;">'+
                    numChoroplethClicks+
                    '</td>'+
                    '<td style="text-align: right;">'+
                    (parseInt(numChoroplethClicks)/parseInt(numVisitAudit)*100).toFixed(1)+'%'+
                    '</td>'
                );
                $("#audit-access-table-turker").append(
                    '<td style="text-align: right;">'+
                    numTurkerRedirects+
                    '</td>'+
                    '<td style="text-align: right;">'+
                    (parseInt(numTurkerRedirects)/parseInt(numVisitAudit)*100).toFixed(1)+'%'+
                    '</td>'
                );
                $("#audit-access-table-total").append(
                    '<td style="text-align: right;">'+
                        numVisitAudit+
                    '</td>'+
                    '<td style="text-align: right;">'+
                        '100.0%'+
                    '</td>'
                );
            });
            });
            });
            });
            });
            });
            graphsLoaded = true;
        }
    });

    function changeRole(e) {
        var userId = $(this).parent() // <li>
            .parent() // <ul>
            .siblings('button')
            .attr('id')
            .substring("userRoleDropdown".length); // userId is stored in id of dropdown
        var newRole = this.innerText;
        
        data = {
            'user_id': userId,
            'role_id': newRole
        };
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: '/adminapi/setRole',
            type: 'put',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                // Change dropdown button to reflect new role.
                var button = $('#userRoleDropdown' + result.user_id);
                var buttonContents = button.html();
                var newRole = result.role;
                button.html(buttonContents.replace(/Registered|Turker|Researcher|Administrator|Anonymous/g, newRole));
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    function clearPlayCache() {
        $.ajax( {
            url: '/adminapi/clearPlayCache',
            type: 'put',
            success: function () {
                clearPlayCacheSuccess.innerHTML = i18next.t("admin-clear-play-cache");
            }
        } )
    }

    initializeLabelTable();
    initializeAdminGSVLabelView();
    initializeAdminLabelSearch();
    initializeAdminGSVCommentView();
    initializeAdminGSVCommentWindow();
    
    self.clearPlayCache = clearPlayCache;
    self.toggleLayers = toggleLayersAdmin;
    self.filterLayers = filterLayersAdmin;
    self.toggleAuditedStreetLayer = toggleAuditedStreetLayerAdmin;
    self.toggleUnauditedStreetLayer = toggleUnauditedStreetLayerAdmin;

    $('.change-role').on('click', changeRole);

    return self;
}

function AdminLabelSearch() {
    var adminGSVLabelView;


    function _init() {
        adminGSVLabelView = AdminGSVLabelView(true);
    }

    // Prevents the page from refreshing when the enter key is pressed.
    $('#form-control-input').keypress(function(e) {
        if (e.keyCode === 13) {
            var labelId = $('#form-control-input').val();
            adminGSVLabelView.showLabel(labelId);
            return false;
        }
    });

    /**
     * Pull information from the Label information box when the submit button is clicked.
     */
    $('#submit').on('click', function(e) {
        var labelId = $('#form-control-input').val();
        adminGSVLabelView.showLabel(labelId);
    });

    _init();
    
    return self;
}

/**
 *
 *
 * @param svHolder: One single DOM element
 * @param admin
 * @returns {{className: string}}
 * @constructor
 */
function AdminPanorama(svHolder, buttonHolder, admin) {
    var self = {
        className: "AdminPanorama",
        label: undefined,
        labelMarkers: [],
        panoId: undefined,
        panorama: undefined,
        admin: admin
    };

    var icons = {
        CurbRamp : '/assets/images/icons/AdminTool_CurbRamp.png',
        NoCurbRamp : '/assets/images/icons/AdminTool_NoCurbRamp.png',
        Obstacle : '/assets/images/icons/AdminTool_Obstacle.png',
        SurfaceProblem : '/assets/images/icons/AdminTool_SurfaceProblem.png',
        Other : '/assets/images/icons/AdminTool_Other.png',
        Occlusion : '/assets/images/icons/AdminTool_Other.png',
        NoSidewalk : '/assets/images/icons/AdminTool_NoSidewalk.png',
        Crosswalk : '/assets/images/icons/AdminTool_Crosswalk.png',
        Signal : '/assets/images/icons/AdminTool_Signal.png'
    };

    // Determined experimentally; varies w/ GSV Panorama size
    var zoomLevel = {
        1: 1,
        2: 1.95,
        3: 2.95
    };

    /**
     * This function initializes the Panorama
     */
    function _init () {
        self.buttonHolder = $(buttonHolder);
        self.svHolder = $(svHolder);
        self.svHolder.addClass("admin-panorama");

        // svHolder's children are absolutely aligned, svHolder's position has to be either absolute or relative
        if(self.svHolder.css('position') != "absolute" && self.svHolder.css('position') != "relative")
            self.svHolder.css('position', 'relative');

        // GSV will be added to panoCanvas
        self.panoCanvas = $("<div id='pano'>").css({
            width: self.svHolder.width(),
            height: self.svHolder.height()
        })[0];

        self.panoNotAvailable = $("<div id='pano-not-avail'>Oops, our fault but there is no longer imagery available " +
            "for this label.</div>").css({
            'font-size': '200%',
            'padding-bottom': '15px'
        })[0];

        self.panoNotAvailableDetails =
            $("<div id='pano-not-avail-2'>We use the Google Maps API to show the sidewalk images and sometimes Google" +
                " removes these images so we can no longer access them. Sorry about that.</div>").css({
            'font-size': '85%',
            'padding-bottom': '15px'
        })[0];

        self.panoNotAvailableAuditSuggestion = 
            $('<div id="pano-not-avail-audit"><a>Explore the street</a> again to use Google\'s newer images!</div>').css({
            'font-size': '85%',
            'padding-bottom': '15px'
        })[0];

        self.svHolder.append($(self.panoCanvas));
        self.svHolder.append($(self.panoNotAvailable));
        self.svHolder.append($(self.panoNotAvailableDetails));
        self.svHolder.append($(self.panoNotAvailableAuditSuggestion));

        self.panorama = typeof google != "undefined" ? new google.maps.StreetViewPanorama(self.panoCanvas, { mode: 'html4' }) : null;
        self.panorama.addListener('pano_changed', function() {
            // Show the correct set of labels for the given pano.
            var currentPano = self.panorama.getPano();
            for (var marker of self.labelMarkers) {
                if (marker.panoId === currentPano) {
                    marker.marker.setVisible(true);
                } else {
                    marker.marker.setVisible(false);
                }
            }
        });

        if (self.panorama) {
            self.panorama.set('addressControl', false);
            self.panorama.set('clickToGo', false);
            self.panorama.set('disableDefaultUI', true);
            self.panorama.set('linksControl', false);
            self.panorama.set('navigationControl', false);
            self.panorama.set('panControl', false);
            self.panorama.set('zoomControl', false);
            self.panorama.set('keyboardShortcuts', false);
            self.panorama.set('motionTracking', false);
            self.panorama.set('motionTrackingControl', false);
            self.panorama.set('showRoadLabels', false);

            // Disable moving by clicking if on /labelmap, enable if on admin page.
            if (admin) self.panorama.set('clickToGo', true);
            else       self.panorama.set('clickToGo', false);
        }

        return this;
    }

    function setPov(heading, pitch, zoom) {
        self.panorama.set('pov', {heading: heading, pitch: pitch});
        self.panorama.set('zoom', zoomLevel[zoom]);
    }

    /**
     * Sets the panorama ID and POV from label metadata
     * @param panoId
     * @param heading
     * @param pitch
     * @param zoom
     * @param callbackParam
     */
    function setPano(panoId, heading, pitch, zoom, callbackParam) {
        if (typeof google != "undefined") {
            self.panorama.registerPanoProvider(function(pano) {
                if (pano === 'tutorial' || pano === 'afterWalkTutorial') {
                    return getCustomPanorama(pano);
                }

                return null;
            });
            
            self.svHolder.css('visibility', 'hidden');
            self.panoId = panoId;

            self.panorama.setPano(panoId);
            self.panorama.set('pov', {heading: heading, pitch: pitch});
            self.panorama.set('zoom', zoomLevel[zoom]);

            // Based off code from Onboarding.
            // We write another callback function because of a bug in the Google Maps API that
            // causes the screen to go black.
            // This callback gives time for the pano to load for 500ms. Afterwards, we trigger a
            // resize and reset the POV/Zoom.
            function callback (n) {
                google.maps.event.trigger(self.panorama, 'resize');
                self.panorama.set('pov', {heading: heading, pitch: pitch});
                self.panorama.set('zoom', zoomLevel[zoom]);
                self.svHolder.css('visibility', 'visible');

                // Show pano if it exists, an error message if there is no GSV imagery, and another error message if we
                // wait a full 2 seconds without getting a response from Google.
                if (self.panorama.getStatus() === "OK" || self.panoId == 'tutorial' || self.panoId == 'afterWalkTutorial') {
                    $(self.panoCanvas).css('display', 'block');
                    $(self.panoNotAvailable).css('display', 'none');
                    $(self.panoNotAvailableDetails).css('display', 'none');
                    $(self.panoNotAvailableAuditSuggestion).css('display', 'none');
                    $(self.buttonHolder).css('display', 'block');
                    if (self.label) renderLabel(self.label);
                } else if (self.panorama.getStatus() === "ZERO_RESULTS") {
                    $(self.svHolder).css('height', '');
                    $(self.panoNotAvailable).text('Oops, our fault but there is no longer imagery available for this label.');
                    $(self.panoCanvas).css('display', 'none');
                    $(self.panoNotAvailable).css('display', 'block');
                    $(self.panoNotAvailableDetails).css('display', 'block');
                    $("a").attr("href", "/audit/street/" + self.label['streetEdgeId']);
                    $(self.panoNotAvailableAuditSuggestion).css('display', 'block');
                    $(self.buttonHolder).css('display', 'none');
                } else if (n < 1) {
                    $(self.svHolder).css('height', '');
                    $(self.panoNotAvailable).text('We had trouble connecting to Google Street View, please try again later!');
                    $(self.panoCanvas).css('display', 'none');
                    $(self.panoNotAvailable).css('display', 'block');
                    $(self.panoNotAvailableDetails).css('display', 'none');
                    $(self.panoNotAvailableAuditSuggestion).css('display', 'none');
                    $(self.buttonHolder).css('display', 'none');
                } else {
                    setTimeout(callback, 200, n - 1);
                }
                callbackParam();
            }
            setTimeout(callback, 200, 10);
        }
        return this;
    }

    function setLabel (label) {
        self.label = label;
    }

    /**
     * Renders a Panomarker (label) onto Google Streetview Panorama.
     * @param label: instance of AdminPanoramaLabel
     * @returns {renderLabel}
     */
    function renderLabel (label) {
        var url = icons[label['label_type']];
        var pos = getPosition(label['canvasX'], label['canvasY'], label['originalCanvasWidth'],
            label['originalCanvasHeight'], label['zoom'], label['heading'], label['pitch']);
        self.labelMarkers.push({
            panoId: self.panorama.getPano(),
            marker: new PanoMarker({
                container: self.panoCanvas,
                pano: self.panorama,
                position: {heading: pos.heading, pitch: pos.pitch},
                icon: url,
                size: new google.maps.Size(20, 20),
                anchor: new google.maps.Point(10, 10)
            })
        });
        return this;
    }

    /**
     * Calculates heading and pitch for a Google Maps marker using (x, y) coordinates
     * From PanoMarker spec
     * @param canvas_x          X coordinate (pixel) for label
     * @param canvas_y          Y coordinate (pixel) for label
     * @param canvas_width      Original canvas width
     * @param canvas_height     Original canvas height
     * @param zoom              Original zoom level of label
     * @param heading           Original heading of label
     * @param pitch             Original pitch of label
     * @returns {{heading: number, pitch: number}}
     */
    function getPosition(canvas_x, canvas_y, canvas_width, canvas_height, zoom, heading, pitch) {
        function sgn(x) {
            return x >= 0 ? 1 : -1;
        }

        var PI = Math.PI;
        var cos = Math.cos;
        var sin = Math.sin;
        var tan = Math.tan;
        var sqrt = Math.sqrt;
        var atan2 = Math.atan2;
        var asin = Math.asin;
        var fov = get3dFov(zoom) * PI / 180.0;
        var width = canvas_width;
        var height = canvas_height;
        var h0 = heading * PI / 180.0;
        var p0 = pitch * PI / 180.0;
        var f = 0.5 * width / tan(0.5 * fov);
        var x0 = f * cos(p0) * sin(h0);
        var y0 = f * cos(p0) * cos(h0);
        var z0 = f * sin(p0);
        var du = (canvas_x) - width / 2;
        var dv = height / 2 - (canvas_y - 5);
        var ux = sgn(cos(p0)) * cos(h0);
        var uy = -sgn(cos(p0)) * sin(h0);
        var uz = 0;
        var vx = -sin(p0) * sin(h0);
        var vy = -sin(p0) * cos(h0);
        var vz = cos(p0);
        var x = x0 + du * ux + dv * vx;
        var y = y0 + du * uy + dv * vy;
        var z = z0 + du * uz + dv * vz;
        var R = sqrt(x * x + y * y + z * z);
        var h = atan2(x, y);
        var p = asin(z / R);
        return {
            heading: h * 180.0 / PI,
            pitch: p * 180.0 / PI
        };
    }

    /**
     * This calculates the heading and position for placing this Label onto the panorama from the same POV as when the
     * user placed the label.
     * @returns {{heading: number, pitch: number}}
     */
    function getOriginalPosition () {
        return getPosition(self.label['canvasX'], self.label['canvasY'], self.label['originalCanvasWidth'],
            self.label['originalCanvasHeight'], self.label['zoom'], self.label['heading'], self.label['pitch']);
    }

    /**
     * From panomarker spec
     * @param zoom
     * @returns {number}
     */
    function get3dFov (zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // linear descent
            195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
    }

    /**
     * TODO: Find a way to use the method in MapService.js to avoid copied code.
     * If the user is going through the tutorial, it will return the custom/stored panorama for either the initial
     * tutorial view or the "after walk" view.
     * @param pano - the pano ID/name of the wanted custom panorama.
     * @returns custom Google Street View panorama.
     * */
    function getCustomPanorama(pano) {
        if (pano === 'tutorial') {
            return {
                location: {
                    pano: 'tutorial',
                    latLng: new google.maps.LatLng(38.94042608, -77.06766133)
                },
                links: [{
                    heading: 342,
                    description: 'Exit',
                    pano: "afterWalkTutorial"
                }],
                copyright: 'Imagery (c) 2010 Google',
                tiles: {
                    tileSize: new google.maps.Size(2048, 1024),
                    worldSize: new google.maps.Size(4096, 2048),
                    centerHeading: 51,
                    getTileUrl: function(pano, zoom, tileX, tileY) {
                        return "/assets/javascripts/SVLabel/img/onboarding/tiles/tutorial/" + zoom + "-" + tileX + "-" + tileY + ".jpg";
                    }
                }
            };
        } else if (pano === 'afterWalkTutorial') {
            return {
                location: {
                    pano: 'afterWalkTutorial',
                    latLng: new google.maps.LatLng(38.94061618, -77.06768201)
                },
                links: [],
                copyright: 'Imagery (c) 2010 Google',
                tiles: {
                    tileSize: new google.maps.Size(1700, 850),
                    worldSize: new google.maps.Size(3400, 1700),
                    centerHeading: 344,
                    getTileUrl: function(pano, zoom, tileX, tileY) {
                        return "/assets/javascripts/SVLabel/img/onboarding/tiles/afterwalktutorial/" + zoom + "-" + tileX + "-" + tileY + ".jpg";
                    }
                }
            };
        }
    }

    /**
     * Returns the panorama ID for the current panorama.
     * @returns {google.maps.StreetViewPanorama} Google StreetView Panorama Id
     */
    function getPanoId() {
        return self.panorama.getPano();
    }

    /**
     * Returns the lat lng of this panorama. Note that sometimes position is null/undefined
     * (probably a bug in GSV), so sometimes this function returns null.
     * @returns {{lat, lng}}
     */
    function getPos() {
        let position = self.panorama.getPosition();
        return (position) ? {'lat': position.lat(), 'lng': position.lng()} : null;
    }

    /**
     * Returns the pov of the viewer.
     * @returns {{heading: float, pitch: float, zoom: float}}
     */
    function getPov() {
        let pov = self.panorama.getPov();

        // Pov can be less than 0. So adjust it.
        while (pov.heading < 0) {
            pov.heading += 360;
        }

        // Pov can be more than 360. Adjust it.
        while (pov.heading > 360) {
            pov.heading -= 360;
        }
        return pov;
    }

    _init();

    self.setPov = setPov;
    self.setPano = setPano;
    self.setLabel = setLabel;
    self.renderLabel = renderLabel;
    self.getOriginalPosition = getOriginalPosition;
    self.getPanoId = getPanoId;
    self.getPosition = getPos;
    self.getPov = getPov;

    return self;
}

/**
 *
 * @param labelId
 * @param labelType
 * @param canvasX
 * @param canvasY
 * @param originalCanvasWidth
 * @param originalCanvasHeight
 * @param heading
 * @param pitch
 * @param zoom
 * @param streetEdgeId
 * @returns {{className: string}}
 * @constructor
 */
function AdminPanoramaLabel(labelId, labelType, canvasX, canvasY, originalCanvasWidth, originalCanvasHeight,
                            heading, pitch, zoom, streetEdgeId) {
    var self = { className: "AdminPanoramaLabel" };

    /**
     * This function initializes the Panorama
     */
    function _init () {
        self.labelId = labelId;
        self.label_type = labelType;
        self.canvasX = canvasX;
        self.canvasY = canvasY;
        self.originalCanvasWidth = originalCanvasWidth;
        self.originalCanvasHeight = originalCanvasHeight;
        self.heading = heading;
        self.pitch = pitch;
        self.zoom = zoom;
        self.streetEdgeId = streetEdgeId;
        return this;
    }

    _init();

    return self;
}
function AdminTask(params) {
    var self = { auditTaskId: params.auditTaskId };
    var _data = {};

    L.mapbox.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var map = L.mapbox.map('map', null, {
        zoomControl: false,
        scrollWheelZoom: false,
        touchZoom: false,
        doubleClickZoom: true
    }).addLayer(L.mapbox.styleLayer('mapbox://styles/mapbox/streets-v11'));

    (function mapAnimation () {
        var colorScheme = util.misc.getLabelColors();
        var lastPaused = 0;
        // Prepare a layer to put d3 stuff
        var svg = d3.select(map.getPanes().overlayPane).append('svg');  // The base svg
        var g = svg.append('g').attr('class', 'leaflet-zoom-hide');  // The root group
        
        // Plays/Pauses the stream.
        $('#control-btn').on('click', function() {
            if (document.getElementById('control-btn').innerHTML === 'Play') {
                playAnimation();
            } else if (document.getElementById('control-btn').innerHTML === 'Pause') {
                pauseAnimation();
            }
        });

        
        // Adds input listeners and pauses playback whenever fields are changed.
        var elements = document.getElementsByTagName('input');
        for (let i = 0; i < elements.length; ++i) {
            elements[i].addEventListener('input', function() {
                pauseAnimation();
            });
        }
        
        // The animation is played again by recalculating the stream again from where it stopped.
        function playAnimation() {
            let speedMultiplier = document.getElementById('speed-multiplier').value;
            let maxWaitMs = (document.getElementById('wait-time').value) * 1000;
            let skipFillTimeMs = (document.getElementById('fill-time').value) * 1000;
            // Import the sample data and start animating.
            var geojsonURL = '/adminapi/auditpath/' + self.auditTaskId;
            d3.json(geojsonURL, function (collection) {
                animate(collection, lastPaused, speedMultiplier, maxWaitMs, skipFillTimeMs);
            });
            document.getElementById('control-btn').innerHTML = 'Pause';
        }

        // This function "pauses" the animation by saving the last moment where it stopped.
        function pauseAnimation() {
            console.log('int4erupreur');
            d3.selectAll('*').transition();
            document.getElementById('control-btn').innerHTML = 'Play';
        }

        /**
         * This function animates how a user (represented as a yellow circle) walked through the map and labeled
         * accessibility attributes.
         *
         * param walkTrajectory A trajectory of a user's auditing activity in a GeoJSON FeatureCollection format.
         */
        function animate(walkTrajectory, startTime, speedMultiplier, maxWaitMs, skipFillTimeMs) {
            // https://github.com/mbostock/d3/wiki/Geo-Streams#stream-transforms
            var initialCoordinate = walkTrajectory.features[startTime].geometry.coordinates;
            var transform = d3.geo.transform({point: projectPoint});
            var d3path = d3.geo.path().projection(transform);
            var featuresdata = walkTrajectory.features;
            var timedata = [];
            var markerGroup = g.append('g').data(featuresdata);
            var marker = markerGroup.append('circle')
                .attr('r', 2)
                .attr('id', 'marker')
                .attr('class', 'travel-marker');
            var markerNose = markerGroup.append('line')
                .attr({'x1': 0, 'y1': -3, 'x2': 0, 'y2': -10})
                .attr('stroke', 'gray')
                .attr('stroke-width', 2);

            map.setView([initialCoordinate[1], initialCoordinate[0]], 18);

            // Set the initial heading
            markerGroup.attr('transform', function () {
                var y = featuresdata[startTime].geometry.coordinates[1];
                var x = featuresdata[startTime].geometry.coordinates[0];
                var heading = featuresdata[startTime].properties.heading;
                return 'translate(' +
                    map.latLngToLayerPoint(new L.LatLng(y, x)).x + ',' +
                    map.latLngToLayerPoint(new L.LatLng(y, x)).y + ')' +
                    'rotate(' + heading + ')';
            });


            // Get the bounding box and align the svg
            var bounds = d3path.bounds(walkTrajectory);
            var topLeft = bounds[0];
            var bottomRight = bounds[1];
            svg.attr('width', bottomRight[0] - topLeft[0] + 120)
                .attr('height', bottomRight[1] - topLeft[1] + 120)
                .style('left', topLeft[0] - 50 + 'px')
                .style('top', topLeft[1] - 50 + 'px');
            g.attr('transform', 'translate(' + (-topLeft[0] + 50) + ',' + (-topLeft[1] + 50) + ')');

            // Apply the toLine function to align the path to
            markerGroup.attr('transform', function () {
                var y = featuresdata[startTime].geometry.coordinates[1];
                var x = featuresdata[startTime].geometry.coordinates[0];
                return 'translate(' +
                    map.latLngToLayerPoint(new L.LatLng(y, x)).x + ',' +
                    map.latLngToLayerPoint(new L.LatLng(y, x)).y + ')';
            });

            // Animate the marker's radius to 7px.
            markerGroup = markerGroup.attr('counter', startTime)
                .transition()
                .each('start', function () {
                    var thisMarker = d3.select(d3.select(this).node().children[0]);
                    var thisMarkerNose = d3.select(d3.select(this).node().children[0]);

                    thisMarker.transition()
                        .duration(250)
                        .attr('r', 7);
                })
                .duration(750);

            // Chain transitions.
            var timeToPlaybackTask = 0;
            var totalDuration = 0;
            var totalSkips = 0;
            var skippedTime = 0;

            for (let i = 0; i < featuresdata.length; i++) {
                // This controls the speed.
                featuresdata[i].properties.timestamp /= speedMultiplier;

                if (i > 0) {
                    let duration = featuresdata[i].properties.timestamp - featuresdata[i - 1].properties.timestamp;
                    if (duration > maxWaitMs) {
                        totalSkips += 1;
                        skippedTime += duration;
                        duration = skipFillTimeMs;
                    }
                    timedata[i] = timedata[i-1] + duration;
                    console.log(skipFillTimeMs);
                } else {
                    timedata[i] = 0;
                }
            }
            timeToPlaybackTask = timedata[featuresdata.length - 1];
            console.log(`Speed being multiplied by ${speedMultiplier}.`);
            console.log(`${totalSkips} pauses over ${maxWaitMs / 1000} sec totalling ${skippedTime / 1000} sec. Pausing for ${skipFillTimeMs / 1000} sec during those.`);
            console.log(`Time to replay task: ${timeToPlaybackTask / 1000} seconds`);

            document.getElementById('total-time-label').innerHTML = (timeToPlaybackTask/1000).toFixed(0);
            var currentTimestamp = featuresdata[startTime].properties.timestamp;
            var currPano = null;
            var renderedLabels = [];
            for (let i = startTime; i < featuresdata.length; i++) {
                var duration = featuresdata[i].properties.timestamp - currentTimestamp;
                currentTimestamp = featuresdata[i].properties.timestamp;

                // If there is a greater than 30 second pause, log to console but only pause for 1 second.
                if (duration > maxWaitMs) {
                    duration = skipFillTimeMs;
                }
                markerGroup = markerGroup.transition()
                    .duration(duration)
                    .attr('transform', function () {
                        var y = featuresdata[i].geometry.coordinates[1];
                        var x = featuresdata[i].geometry.coordinates[0];
                        var heading = featuresdata[i].properties.heading;
                        return 'translate(' +
                            map.latLngToLayerPoint(new L.LatLng(y, x)).x + ',' +
                            map.latLngToLayerPoint(new L.LatLng(y, x)).y + ')' +
                            'rotate(' + heading + ')';
                    })
                    .each('start', function () {
                        var counter = d3.select(this).attr('counter');
                        var d = featuresdata[counter];

                        if (!self.panorama) self.panorama = AdminPanorama($('#svholder')[0]);

                        if (currPano === null || currPano !== d.properties.panoId) {
                            currPano = d.properties.panoId;
                            self.panorama.setPano(d.properties.panoId, d.properties.heading, d.properties.pitch, d.properties.zoom);
                        } else {
                            self.panorama.setPov(d.properties.heading, d.properties.pitch, d.properties.zoom);
                        }

                        self.showEvent(d.properties);

                        if (d) {
                            map.setView([d.geometry.coordinates[1], d.geometry.coordinates[0]], 18);

                            // If the 'label' is in the data, draw the label data and attach mouseover/mouseout events.
                            if ('label' in d.properties && !renderedLabels.includes(d.properties.label.label_id)) {
                                var label = d.properties.label;
                                var fill = (label.label_type in colorScheme) ? colorScheme[label.label_type].fillStyle : 'rgb(128, 128, 128)';
                                var p = map.latLngToLayerPoint(new L.LatLng(label.coordinates[1], label.coordinates[0]));
                                var c = g.append('circle')
                                    .attr('r', 5)
                                    .attr('cx', p.x)
                                    .attr('cy', p.y)
                                    .attr('fill', fill)
                                    .attr('stroke-width', 1)
                                    .on('mouseover', function () {
                                        d3.select(this).attr('r', 15);
                                    })
                                    .on('mouseout', function () {
                                        d3.select(this).attr('r', 5);
                                    });

                                var adminPanoramaLabel = AdminPanoramaLabel(
                                    label.label_id, label.label_type, label.canvasX, label.canvasY,
                                    d.properties.canvasWidth, d.properties.canvasHeight, d.properties.heading,
                                    d.properties.pitch, d.properties.zoom
                                );
                                self.panorama.renderLabel(adminPanoramaLabel);
                                renderedLabels.push(label.label_id);

                            }
                        }

                        document.getElementById('current-time-label').innerText = `${(timedata[counter]/1000).toFixed(0)}`;

                        $('#timeline-active').animate({
                            width: 360 * (timedata[counter]/timeToPlaybackTask)
                        }, 0);

                        $('#timeline-handle').animate({
                            left: 360 * (timedata[counter]/timeToPlaybackTask)
                        }, 0);

                        // console.log(`duration: ${duration}`);
                        d3.select(this).attr('counter', ++counter);
                        lastPaused = d3.select(this).attr('counter');

                        // Outputs message to refresh page.
                        if (lastPaused >= featuresdata.length) {
                            document.getElementById('control-btn').innerHTML = "Refresh Page to Replay";
                        }
                    });
            }
        }

        function projectPoint(x, y) {
            // https://github.com/mbostock/d3/wiki/Geo-Streams#stream-transforms
            var point = map.latLngToLayerPoint(new L.LatLng(y, x));
            this.stream.point(point.x, point.y);
        }
    })();

    self.showEvent = function(data) {
        var eventsholder = $('#eventsholder');
        var event = $("<div class='event'/>");
        event.append("<div class='type'>" + data['action'] + "</div>");
        event.append("<div class='desc'>"+ data['note'] +"</div>");

        event.hide().prependTo(eventsholder).fadeIn(300);
    };
    
    self.data = _data;
    return self;
}

function AdminUser(user) {
    var params = {
        popupType: 'none',
        neighborhoodPolygonStyle: {
            color: '#407770',
            weight: 2,
            opacity: 0.6,
            fillColor: '#5d6d6b',
            fillOpacity: 0.1, 
            dashArray: '6,6'
        },
        mouseoverStyle: {
            color: '#5d6d6b',
            opacity: 1.0,
            weight: 2
        },
        mouseoutStyle: {
            color: '#407770',
            opacity: 0.6,
            weight: 2
        },
        webpageActivity: 'Click_module=AdminUserMap_regionId=',
        polygonFillMode: 'singleColor',
        zoomControl: true,
        scrollWheelZoom: true,
        mapName: 'admin-map',
        mapStyle: 'mapbox://styles/mapbox/streets-v11'
    };
    var streetParams = {
        labelPopup: true,
        includeLabelCounts: true,
        auditedStreetColor: 'black'
    };
    var map;
    var layers = [];
    var loadPolygons = $.getJSON('/neighborhoods');
    var loadPolygonRates = $.getJSON('/adminapi/neighborhoodCompletionRate');
    var loadMapParams = $.getJSON('/cityMapParams');
    var loadAuditedStreets = $.getJSON('/adminapi/auditedStreets/' + encodeURI(user));
    var loadSubmittedLabels = $.getJSON('/adminapi/labelLocations/' + encodeURI(user));
    // When the polygons, polygon rates, and map params are all loaded the polygon regions can be rendered.
    var renderPolygons = $.when(loadPolygons, loadPolygonRates, loadMapParams).done(function(data1, data2, data3) {
        map = Choropleth(_, $, 'null', params, layers, data1[0], data2[0], data3[0]);
    });
    // When the polygons have been rendered and the audited streets have loaded,
    // the audited streets can be rendered.
    var renderAuditedStreets = $.when(renderPolygons, loadAuditedStreets).done(function(data1, data2) {
        InitializeStreets(map, streetParams, data2[0]);
    });
    // When the audited streets have been rendered and the submitted labels have loaded,
    // the submitted labels can be rendered.
    $.when(renderAuditedStreets, loadSubmittedLabels).done(function(data1, data2) {
        InitializeSubmittedLabels(map, streetParams, AdminGSVLabelView(true), InitializeMapLayerContainer(), data2[0])
        setRegionFocus(map, layers)
    })
    
    $.getJSON('/adminapi/tasks/' + encodeURI(user), function (data) {
        var grouped = _.groupBy(data, function (o) { return o.audit_task_id});
        var auditTaskId;
        var auditTaskIds = Object.keys(grouped);
        var tableRows = '';
        var labelCounter;
        var i;
        var auditTaskIdsLength = auditTaskIds.length;
        var j;
        var labelsLength;
        var labelType;
        auditTaskIds.sort(function (id1, id2) {
            var timestamp1 = grouped[id1][0].task_start;
            var timestamp2 = grouped[id2][0].task_start;
            if (timestamp1 < timestamp2) { return -1; }
            else if (timestamp1 > timestamp2) { return 1; }
            else { return 0; }
        });

        for (i = auditTaskIdsLength - 1; i >= 0; i--) {
            labelCounter = { 'CurbRamp': 0, 'NoCurbRamp': 0, 'Obstacle': 0, 'SurfaceProblem': 0, 'NoSidewalk': 0, 'Other': 0 };
            auditTaskId = auditTaskIds[i];
            labelsLength = grouped[auditTaskId].length;
            for (j = 0; j < labelsLength; j++) {
                labelType = grouped[auditTaskId][j]['label_type'];
                
                if (!(labelType in labelCounter)) {
                    labelType = 'Other';
                }
                labelCounter[labelType] += 1;
            }

            // No need to load locale, correct locale loaded in timestamp.
            var localDate = moment(new Date(grouped[auditTaskId][0]['task_end']));

            tableRows += "<tr>" +
                "<td class='col-xs-1'>" + localDate.format('L') + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["CurbRamp"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["NoCurbRamp"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["Obstacle"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["SurfaceProblem"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["NoSidewalk"] + "</td>" +
                "<td class='col-xs-1'>" + labelCounter["Other"] + "</td>" +
                "</tr>";
        }

        $('#task-contribution-table').append(tableRows);
    });

    return self;
}
