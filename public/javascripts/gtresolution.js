$(document).ready(function () {

    //enable popovers
    $(function () {
        $('[data-toggle="popover"]').popover()
    });

    //map and map markers
    var map;
    var mapMarkers = [];
    var mapLabels = [];
    //array that stores information about each GSV
    var panoramaContainers = [];

    //all labels not yet dealt with
    var all_labels = [];
    //labels committed to ground truth
    var ground_truth_labels = [];
    //labels designated as not ground truth
    var eliminated_labels = [];
    //cluster IDs
    var cluster_id_list = [];

    //stores which cluster is being looked at currently
    var currentClusterIndex;
    var currentLabel;
    // currentCoordinates are formats for the label's lat lng position, used to focus map
    var currentCoordinates;

    //stores the next open view to display a label on
    var nextOpenView = 0;

    //labels to be investigated in low disagreement round
    var toInvestigate = [];

    //stores foremost label zIndex
    var maxZIndex = 200;
    //list of existing toggle buttons
    var initializedToggleButtons = [];

    //stores color information for each label type
    var colorMapping = {
        CurbRamp: {fillStyle: '#00DE26'},
        NoCurbRamp: {fillStyle: '#E92771'},
        Obstacle: {fillStyle: '#00A1CB'},
        Other: {fillStyle: '#B3B3B3'},
        Occlusion: {fillStyle: '#B3B3B3'},
        NoSidewalk: {fillStyle: '#B3B3B3'},
        SurfaceProblem: {fillStyle: '#F18D05'}
    };

    //stores maps label type string to its id in the label_type table
    var labelTypeMapping = {
        CurbRamp: 1,
        NoCurbRamp: 2,
        Obstacle: 3,
        Other: 5,
        Occlusion: 6,
        NoSidewalk: 7,
        SurfaceProblem: 4
    };

    //stores information for each of the status
    var statusInfo = {
        // Not yet dealt with, no status
        null: {
            size: new google.maps.Size(18, 18),
            path: "/ground_truth/gt_",
            markerOptions: {
                strokeColor: "#000000",
                strokeOpacity: 0.8,
                fillOpacity: 0.5,
                strokeWeight: 0.5,
                status: null,
                zIndex: 100}
        },
        // Filter labels are dealt with in low disagreement round
        "Filter": {
            size: new google.maps.Size(21, 21),
            path: "/ground_truth/gt_commit_",
            markerOptions: {
                strokeColor: "#ffe500",
                strokeOpacity: 1,
                fillOpacity: 0.8,
                strokeWeight: 4,
                status: "Ground_Truth",
                zIndex: 200
            }
        },
        // When only one person placed GT labels (dealt with in modified low disagreement round)
        "One Turker": {
            size: new google.maps.Size(21, 21),
            path: "/ground_truth/gt_commit_",
            markerOptions: {
                strokeColor: "#ffe500",
                strokeOpacity: 1,
                fillOpacity: 0.8,
                strokeWeight: 4,
                status: "Ground_Truth",
                zIndex: 200
            }
        },
        // Labels in ground truth
        "Ground_Truth": {
            size: new google.maps.Size(21, 21),
            path: "/ground_truth/gt_commit_",
            markerOptions: {
                strokeColor: "#ffe500",
                strokeOpacity: 1,
                fillOpacity: 0.8,
                strokeWeight: 4,
                status: "Ground_Truth",
                zIndex: 200
            }
        },
        // Labels designated not in ground truth
        "No_Ground_Truth": {
            size: new google.maps.Size(18, 18),
            path: "/ground_truth/gt_exclude_",
            markerOptions: {
                strokeColor: "#757470",
                strokeWeight: 0.5,
                strokeOpacity: 0.5,
                status: "No_Ground_Truth",
                zIndex: 50,
                fillOpacity: 0.2
            }
        }
    };


    //initialize all markers on the side map
    function initializeAllMapMarkers() {
        //array to store all markers to be shown
        var features = [];
        //iterate through and add remaining labels
        for (var clusterId in all_labels) {
            for (j = 0; j < all_labels[clusterId].length; j++) {
                var lbl = all_labels[clusterId][j];
                features.push({
                    position: new google.maps.LatLng(lbl.lat, lbl.lng),
                    type: lbl.label_type,
                    meta: lbl,
                    status: null
                });
            }
        }
        //iterate through and add ground truth labels
        for (j = 0; j < ground_truth_labels.length; j++) {
            var lbl = ground_truth_labels[j];
            features.push({
                position: new google.maps.LatLng(lbl.lat, lbl.lng),
                type: lbl.label_type,
                meta: lbl,
                status: "Ground_Truth"
            });
        }
        //iterate through and add designated not ground truth labels
        for (j = 0; j < eliminated_labels.length; j++) {
            var lbl = eliminated_labels[j];
            features.push({
                position: new google.maps.LatLng(lbl.lat, lbl.lng),
                type: lbl.label_type,
                meta: lbl,
                status: "No_Ground_Truth"
            });
        }
        //itearate through labels still to be investigated
        for (j = 0; j < toInvestigate.length; j++) {
            var lbl = toInvestigate[j].label;
            features.push({
                position: new google.maps.LatLng(lbl.lat, lbl.lng),
                type: lbl.label_type,
                meta: lbl,
                status: "Filter"
            });
        }

        // Create markers for all labels pushed to features
        features.forEach(function (feature) {
            //create the marker
            var marker = new google.maps.Circle({
                id: "marker" + feature.meta.label_id,
                meta: feature.meta,
                clicked: false,
                status: feature.status,
                center: new google.maps.LatLng(feature.meta.lat, feature.meta.lng),
                radius: 0.5,
                clickabe: true,
                fillColor: colorMapping[feature.meta.label_type].fillStyle
            });
            //change styles if the label is already designated as ground truth or not ground truth
            marker.setOptions(statusInfo[feature.status].markerOptions);
            //create the associated label (to show V1, V2, etc.)
            var labeling = new google.maps.Marker({
                map: map,
                id: feature.meta.label_id,
                position: new google.maps.LatLng(feature.meta.lat, feature.meta.lng),
                draggable: false,
                label: {text: "", fontWeight: 'bold', fontSize: '12px'},
                icon: {url: "", labelOrigin: new google.maps.Point(2, 6), size: new google.maps.Size(5, 5)},
                opacity: 1,
                crossOnDrag: false,
                visible: false
            });
            //bind the marker and label
            marker.bindTo('center', labeling, 'position');
            //on marker mouse over
            marker.addListener('mouseover', function () {
                //test whether label is present within a view
                var pano = panoramaContainers.find(panoramaContainer => panoramaContainer.cluster_id === marker.meta.cluster_id && panoramaContainer.pano_id === marker.meta.pano_id);
                //if so, highlight that view with a border
                if (pano != null) {
                    pano.view.style.borderStyle = "solid";
                }
                //emphasize label on map by highlighting pink
                marker.setOptions({fillColor: '#ff38fb'});
            });
            //on marker mouse out
            marker.addListener('mouseout', function () {
                //test whether label is present within a view
                var pano = panoramaContainers.find(panoramaContainer => panoramaContainer.cluster_id === marker.meta.cluster_id && panoramaContainer.pano_id === marker.meta.pano_id);
                //if so, highlight that view with a border
                if (pano != null) {
                    pano.view.style.borderStyle = "hidden";
                }
                //deemphasize label by removing the pink highlight
                if(!marker.clicked) {
                    marker.setOptions({fillColor: colorMapping[marker.meta.label_type].fillStyle});
                }
            });
            //add marker to map, add marker and label to storage arrays
            marker.setMap(map);
            mapMarkers.push(marker);
            mapLabels.push(labeling);
        });
    }//end of initializeAllMapMarkers

    //initialize the four GSV panoramas based on data from a specific label
    function initializePanoramas(label) {
        var panosToUpdate = panoramaContainers.map(panoramaContainer => panoramaContainer.view);
        for (var i = 0; i < panosToUpdate.length; i++) {
            //update all indicated panoramas with pano_id, zoom, pov
            panoramaContainers[i].gsv_panorama = new google.maps.StreetViewPanorama(panosToUpdate[i], {
                pano: label.pano_id,
                zoom: label.zoom,
                pov: {
                    heading: label.heading,
                    pitch: label.pitch
                },
                disableDefaultUI: true,
                clickToGo: false,
                zoomControl: true,
                scrollwheel: true
            });
            panoramaContainers[i].gsv_panorama.setOptions({visible: false});
        }
    }//end of initializePanoramas

    //choose the earliest of the open views (views not displaying a label)
    //if all full, choose the first view
    function calculateNextOpenPanorama() {
        for (var i = 0; i < panoramaContainers.length; i++) {
            if (panoramaContainers[i].labels.length === 0) {
                return i;
            }
        }
        return 0;
    }// End of calculateNextOpenPanorama

    // Show a label in the panorama
    function showLabel(label, pano, status) {
        // Set pano variables to match added label
        pano.cluster_id = label.cluster_id;
        pano.pano_id = label.pano_id;
        // Update info bar above panorama
        if (pano.info.innerHTML === "Empty") {
            if (status === "Filter") {
                pano.info.innerHTML =
                    "<b>Cluster ID: </b>" + label.cluster_id + ' | ' +
                    '<b>Toggle Visible: </b>' +
                    '<a href="javascript:;" id="toggle-visible-' + label.pano_id + label.cluster_id + '">' +
                        '<span class="glyphicon glyphicon-eye-open" style="color:#000000; font-size:14px"></span>' +
                    '</a>';
            } else if (status === "One Turker") {
                pano.info.innerHTML =
                    '<b>Toggle Visible: </b>' +
                    '<a href=\"javascript:;\" id=\"toggle-visible-' + label.pano_id + label.cluster_id + '\">' +
                        '<span class=\"glyphicon glyphicon-eye-open\" style=\"color:#000000; font-size:14px\"></span>' +
                    '</a>';
            } else {
                pano.info.innerHTML = "<b>Cluster ID: </b> " + label.cluster_id + ' | ' +
                    '<b>Labels Shown: </b> <span class="labelCount">' + pano.labels.length + '</span> | ' +
                    '<b>Toggle Visible: </b>' +
                    '<a href="javascript:;" id="toggle-visible-' + label.pano_id + label.cluster_id + '">' +
                        '<span class="glyphicon glyphicon-eye-open" style="color:#000000; font-size:14px"></span>' +
                    '</a>';
            }
        }
        // If this toggle button has already been initialized, do not re-initialize
        if (initializedToggleButtons.indexOf(label.pano_id + label.cluster_id) < 0) {
            initializedToggleButtons.push(label.pano_id + label.cluster_id);
            //Toggle visibility of label markers (hide and show)
            $(document).on("click", '#toggle-visible-' + label.pano_id + label.cluster_id, function () {
                if (pano.labelMarkers[0].getIcon() === null) {
                    // If hidden, show all labels in the GSV
                    for (var i = 0; i < pano.labelMarkers.length; i++) {
                        var marker = mapMarkers.find(mkr => mkr.meta.label_id === pano.labels[i].label_id);
                        var type = pano.labels[i].label_type;
                        if(type === 'Occlusion' || type === 'NoSidewalk'){type = 'Other';}
                        if (marker != null) {
                            pano.labelMarkers[i].setIcon("assets/javascripts/SVLabel/img" + statusInfo[marker.status].path + type + ".png?size=200");
                        }
                        else {
                            pano.labelMarkers[i].setIcon("assets/javascripts/SVLabel/img" + statusInfo[null].path + type + ".png?size=200");
                        }
                    }
                } else {
                    // If showing, hide all labels in the GSV
                    for (var i = 0; i < pano.labelMarkers.length; i++) {
                        pano.labelMarkers[i].setIcon(null);
                    }
                }
            });
        }
        // Draw label, return POV focused on that issue
        var pov = renderLabel(label, pano, status);
        // Display the GSV number on the map label, unless we are just fixing severity
        if (status !== "One Turker") {
            var markerLabel = mapLabels.find(mkr => mkr.id === label.label_id);
            markerLabel.setOptions({
                visible: true,
                label: {text: (pano.number).toString(), fontWeight: 'bold', fontSize: '12px'}
            });
        }
        // Update selected panorama with pano, pov, and zoom
        var toChange = pano.gsv_panorama;
        toChange.setPano(label.pano_id);
        toChange.setPov(pov);
        toChange.setZoom(3);
        // Flash on top of GSV, prevent user from clicking during rendering
        $('#pano' + (pano.number) + '-holder').prepend(
            '<div class="loading" style="width:100%; height: 115%; z-index:5;position:absolute;background-color:rgba(255, 255, 255, 0.67)">' +
            '<p style="text-align:center;vertical-align:center;position:relative;top:50%;height:90%"></p>' +
            '</div>').children('div.loading').fadeOut('slow', function () {
            $(this).remove();
        });
        nextOpenView = calculateNextOpenPanorama();
    }// End of showLabel

    // Draw a label in the GSV
    function renderLabel(label, pano, status) {
        // Get label placement based on x/y
        var labelPosition = mapXYtoPov(label.sv_canvas_x, label.sv_canvas_y, label.canvas_width, label.canvas_height, label.zoom, label.heading, label.pitch);
        // Create a marker for the label in the panorama
        var id = "label-id-" + label.label_id;
        var size = statusInfo[status].size;
        var type = label.label_type;
        if(type === 'Occlusion' || type === 'NoSidewalk'){type = 'Other';}
        var label_marker = new PanoMarker({
            pano: pano.gsv_panorama,
            container: pano.view,
            position: {heading: labelPosition.heading, pitch: labelPosition.pitch},
            icon: "assets/javascripts/SVLabel/img" + statusInfo[status].path + type + ".png?size=200",
            id: id,
            size: size,
            optimized: false
        });
        //store marker
        pano.labelMarkers.push(label_marker);
        //add listeners to the marker
        var markerIndex = pano.labelMarkers.length - 1;
        //CLICK
        google.maps.event.addListener(pano.labelMarkers[markerIndex], 'click', function () {
            // Bring label to the front
            maxZIndex++;
            pano.labelMarkers[markerIndex].setOptions({zIndex: maxZIndex});
            // Hide all other popovers
            for (var i = 0; i < pano.labelMarkers.length; i++) {
                if (i != markerIndex) {
                    $('#' + pano.labelMarkers[i].getId()).popover('hide');
                    var closeMarker = mapMarkers.find(mkr => mkr.meta.label_id === pano.labels[i].label_id);
                    closeMarker.setOptions({fillColor: colorMapping[closeMarker.meta.label_type].fillStyle});
                    closeMarker.clicked= false;
                }
            }
            // Empasize/deemphasize corresponding label on map
            var marker = mapMarkers.find(mkr => mkr.meta.label_id === label.label_id);
            if (marker.clicked) {
                marker.setOptions({fillColor: colorMapping[marker.meta.label_type].fillStyle}); marker.clicked = false
            } else {marker.setOptions({fillColor: '#ff38fb'}); marker.clicked = true;}
            // Create and open popover for label
            createPopover(pano, label, status);
        });

        // CHANGE IN POV
        google.maps.event.addListener(pano.gsv_panorama, 'pov_changed', function () {
            // Popover follows marker when POV is changed (no need to update if we are just doing severity update)
            createPopover(pano, label, status);
            $("#" + id).popover('hide');
            if (status !== "One Turker") {
                var closeMarker = mapMarkers.find(mkr => mkr.meta.label_id === label.label_id);
                closeMarker.setOptions({fillColor: colorMapping[closeMarker.meta.label_type].fillStyle});
                closeMarker.clicked = false;
            }
        });
        // Return POV focused on the placed marker
        return {heading: labelPosition.heading, pitch: labelPosition.pitch};
    }// End of renderLabel

    // Create popover for marker
    function createPopover(pano, data, status) {
        if (status === "Filter") {
            return;
        } // Do not give second round labels popovers
        var labelIndex = pano.labels.findIndex(lbl => lbl.label_id === data.label_id);
        var markerElement = $("#label-id-" + data.label_id);

        // Create popup
        // Ground truth yes/no buttons and send to back button are common to all label types
        var popupButtonHtml = 'Ground Truth: ' +
            '<input type="button" id="commit' + data.label_id + '" style="margin-top:1px" value="Yes"/>' +
            '<input type="button" id="noCommit' + data.label_id + '" style="margin-top:4px" value="No"/>' +
            '<input type="button" id="sendToBack' + data.label_id + '" style="margin-top:4px; margin-left:8px" value="Send to Back"/>';

        // Labeler name is common to all label types as well
        var labelDescriptors = '<p style="text-align:center; margin-bottom:2px">' +
                               '<b>Labeler:</b>&nbsp;' + data.turker_id;

        // For the label types with gray icons, include name of label type to distinguish between them
        if (['Other', 'Occlusion', 'NoSidewalk'].indexOf(data.label_type) >= 0) {
            labelDescriptors += ', <b>Label Type:</b>&nbsp;' + data.label_type;
        }

        // For occlusion and no sidewalk label types, there is no severity/temp popup, so don't try to display it
        if (['Occlusion', 'NoSidewalk'].indexOf(data.label_type) < 0) {
            labelDescriptors += ', <b>Severity:</b>&nbsp;' + data.severity +
                                ', <b>Temporary:</b>&nbsp;' + data.temporary;
        }
        labelDescriptors += '</p>';

        var popupContent = labelDescriptors + popupButtonHtml;
        markerElement.popover({
            placement: 'top',
            content: popupContent, // 9eba9e
            html: true,
            delay: 100,
            id: "#popover-" + data.label_id
        });

        // Clicking Yes for GT calls yesGroundTruth and opens severity rating popup (if that label type uses severity)
        $(document).on("click", '.popover #commit' + data.label_id, function () {
            $("#label-id-" + data.label_id).popover('hide');
            yesGroundTruth(data);
            if (['Occlusion', 'NoSidewalk'].indexOf(data.label_type) < 0) {
                changeSeverityPopover(pano, data, status);
            }
        });
        // Clicking no for ground truth hides popover and calls noGroundTruth
        $(document).on("click", '.popover #noCommit' + data.label_id, function () {
            $("#label-id-" + data.label_id).popover('hide');
            var closeMarker = mapMarkers.find(mkr => mkr.meta.label_id === data.label_id);
            closeMarker.setOptions({fillColor: colorMapping[closeMarker.meta.label_type].fillStyle});
            closeMarker.clicked= false;
            noGroundTruth(data);
        });
        // Clicking send to back calculates the minimum zIndex of the labels within the panorama, and sends the current label behind that
        $(document).on("click", '.popover #sendToBack' + data.label_id, function () {
            $("#label-id-" + data.label_id).popover('hide');
            var closeMarker = mapMarkers.find(mkr => mkr.meta.label_id === data.label_id);
            closeMarker.setOptions({fillColor: colorMapping[closeMarker.meta.label_type].fillStyle});
            closeMarker.clicked= false;
            var minZ = 1000;
            for (var j = 0; j < pano.labelMarkers.length; j++) {
                minZ = Math.min(minZ, pano.labelMarkers[j].getZIndex());
            }
            minZ--;
            pano.labelMarkers[labelIndex].setOptions({zIndex: minZ});
        });
    }// End of createPopover

    // TODO make severity selection mandatory
    function changeSeverityPopover(pano, data, status) {
      var labelIndex = pano.labels.findIndex(lbl => lbl.label_id === data.label_id);
      var markerElement = $("#label-id-" + data.label_id);
      // Create popup
      markerElement.popover('destroy');
      markerElement.popover({
          placement: 'top',
          content: 'Want to change anything?<br>' +
          'Severity: <select name="changeSeverity" id="changeSeverity' + data.label_id + '">' +
          '<option disabled selected value="none"> </option><option value="1">1</option>' +
                                                           '<option value="2">2</option>' +
                                                           '<option value="3">3</option>' +
                                                           '<option value="4">4</option>' +
                                                           '<option value="5">5</option>' +
                                                           '</select> (' + data.severity + ')<br>' +
          'Temporary: <input type="checkbox" id ="changeTemp' + data.label_id + '"> (' + data.temporary + ')<br>' +
          '<input type="button" id="updateCommit' + data.label_id + '" style="margin-top:4px" value="Update"/>',
          html: true,
          delay: 100
      });
      markerElement.popover('show');

      var marker = mapMarkers.find(mkr => mkr.meta.label_id === data.label_id);
      var toUpdate = ground_truth_labels.find(lbl => lbl.label_id === data.label_id);
      $(document).on("click", '.popover #updateCommit' + data.label_id, function () {
        // Update severity and temporary
        var newSeverity = parseInt($(".popover #changeSeverity" + data.label_id).val());
        if(newSeverity = "none") {
            newSeverity = data.severity;
        }
        var newTemp = $(".popover #changeTemp" + data.label_id).is(':checked');
        toUpdate.severity = newSeverity;
        marker.meta.severity = newSeverity;
        pano.labels[labelIndex].severity = newSeverity;
        toUpdate.temporary = newTemp;
        marker.meta.temporary = newTemp;
        pano.labels[labelIndex].temporary = newTemp;
        markerElement.popover('destroy');
        marker.setOptions({fillColor: colorMapping[marker.meta.label_type].fillStyle});
        marker.clicked = false;
        createPopover(pano,data,status);
      });

    }

    // Updates counters at bottom of page
    function updateCounters() {
        document.getElementById("gtCounter").innerHTML = "DESIGNATED GROUND TRUTH: " + ground_truth_labels.length;
        document.getElementById("notGtCounter").innerHTML = "DESIGNATED NOT GROUND TRUTH: " + eliminated_labels.length;
        var remaining = 0;
        for (var clusterId in all_labels) {
            remaining += all_labels[clusterId].length;
        }
        document.getElementById("remainingCounter").innerHTML = "REMAINING LABELS: " + remaining;
    }// End of updateCounters

    // Updates counters at bottom of page (when fixing severity)
    function updateCountersForOneLabeler(numInvestigated) {
        document.getElementById("gtCounter").innerHTML =
            "DESIGNATED GROUND TRUTH: " + (ground_truth_labels.length - toInvestigate.length + numInvestigated);
        document.getElementById("notGtCounter").innerHTML =
            "DESIGNATED NOT GROUND TRUTH: " + 0;
        document.getElementById("remainingCounter").innerHTML =
            "REMAINING LABELS: " + (toInvestigate.length - numInvestigated);

    }

    // Places this commit in ground truth
    function yesGroundTruth(commit) {
        // Locate panorama and label
        var labelIndex = -1, pano = -1;
        for (i = 0; i < panoramaContainers.length; i++) {
            if (panoramaContainers[i].cluster_id === commit.cluster_id && panoramaContainers[i].pano_id === commit.pano_id) {
                labelIndex = panoramaContainers[i].labels.findIndex(lbl => lbl.label_id === commit.label_id);
                pano = i;
                break;
            }
        }
        // Update visuals
        var type = commit.label_type;
        if(type === 'Occlusion' || type === 'NoSidewalk'){type = 'Other';}
        panoramaContainers[pano].labelMarkers[labelIndex].setIcon("assets/javascripts/SVLabel/img/ground_truth/gt_commit_" + type + ".png?size=200");
        panoramaContainers[pano].labelMarkers[labelIndex].setOptions({
            size: statusInfo["Ground_Truth"].size,
            className: "Ground_Truth"
        });
        var marker = mapMarkers.find(mkr => mkr.meta.label_id === commit.label_id);
        // Locate label within structure of storage arrays
        var index;
        // If label was in not ground truth
        if (marker.status === "No_Ground_Truth") {
            index = eliminated_labels.findIndex(i => i.label_id === commit.label_id);
            eliminated_labels.splice(index, 1);
            ground_truth_labels.push(commit);
        }
        // If label was not yet dealt with
        else if (marker.status === null) {
            index = all_labels[commit.cluster_id].findIndex(i => i.label_id === commit.label_id);
            all_labels[commit.cluster_id].splice(index, 1);
            ground_truth_labels.push(commit);
        }
        // Transfer label
        // Update the label counts
        updateCounters();
        // Style marker
        marker.setOptions(statusInfo["Ground_Truth"].markerOptions);
    }// End of yesGroundTruth

    // This commit will not go in ground truth
    function noGroundTruth(commit) {
        // Locate panorama and label
        var labelIndex = -1, pano = -1;
        for (i = 0; i < panoramaContainers.length; i++) {
            if (panoramaContainers[i].cluster_id === commit.cluster_id && panoramaContainers[i].pano_id === commit.pano_id) {
                labelIndex = panoramaContainers[i].labels.findIndex(lbl => lbl.label_id === commit.label_id);
                pano = i;
                break;
            }
        }
        // Update visuals
        var type = commit.label_type;
        if(type === 'Occlusion' || type === 'NoSidewalk'){type = 'Other';}
        panoramaContainers[pano].labelMarkers[labelIndex].setIcon("assets/javascripts/SVLabel/img/ground_truth/gt_exclude_" + type + ".png?size=200");
        panoramaContainers[pano].labelMarkers[labelIndex].setOptions({
            size: statusInfo["No_Ground_Truth"].size,
            className: "No_Ground_Truth"
        });
        var marker = mapMarkers.find(mkr => mkr.meta.label_id === commit.label_id);
        // Locate label within structure of storage arrays
        var index;
        // If label was in ground truth
        if (marker.status === "Ground_Truth") {
            index = ground_truth_labels.findIndex(i => i.label_id === commit.label_id);
            ground_truth_labels.splice(index, 1);
            eliminated_labels.push(commit);
        }
        // If label was not yet dealt with
        else if (marker.status === null) {
            index = all_labels[commit.cluster_id].findIndex(i => i.label_id === commit.label_id);
            all_labels[commit.cluster_id].splice(index, 1);
            eliminated_labels.push(commit);
        }
        // Transfer label
        // Update the label counts
        updateCounters();
        // Style marker
        marker.setOptions(statusInfo["No_Ground_Truth"].markerOptions);
    }// End of noGroundTruth

    // Clear a specific GSV, optionally clearing labels from map as well.
    function clearCanvas(index, clearMap) {
        var panoramaContainer = panoramaContainers[index];
        // Iterate through labels in the panorama
        for (i = 0; i < panoramaContainer.labelMarkers.length; i++) {
            var markerLabel = panoramaContainer.labelMarkers[i];
            var labelId = panoramaContainer.labels[i].label_id;
            // Hide popover
            $('#' + markerLabel.getId()).popover('hide');

            if (clearMap) {
                var closeMarker = mapMarkers.find(mkr => mkr.meta.label_id === labelId);
                closeMarker.setOptions({fillColor: colorMapping[closeMarker.meta.label_type].fillStyle});
                closeMarker.clicked = false;
                //remove view number label from map marker
                var mLabel = mapLabels.find(mkr => mkr.id === labelId);
                if (mLabel != null) {
                    mLabel.setOptions({visible: false});
                }
                // Remove marker from GSV
                markerLabel.setMap(null);
            }
        }
        // Reset all varaibles associated with the GSV
        panoramaContainer.info.innerHTML = "Empty";
        panoramaContainer.view.style.borderStyle = "hidden";
        panoramaContainer.labels = [];
        panoramaContainer.labelMarkers = [];
        // Recalculate next open view
        nextOpenView = calculateNextOpenPanorama();
        // Clear all listeners
        google.maps.event.clearListeners(panoramaContainers[index].gsv_panorama, 'pov_changed');
    }// End of clearCanvas

    // Add all labels in a cluster to the panoramas
    function addClusterToPanos(cluster) {
        // Clear all canvases
        for (var p = 0; p < 4; p++) {
            clearCanvas(p, true);
        }
        // For every label in the cluster
        for (var i = 0; i < cluster.length; i++) {
            // TestWhether the cluster/pano combination is already up
            var toShow = cluster[i];
            var marker = mapMarkers.find(mkr => mkr.meta.label_id === toShow.label_id);
            var panoIndex = -1;
            for (var j = 0; j < panoramaContainers.length; j++) {
                if (panoramaContainers[j].cluster_id === marker.meta.cluster_id && panoramaContainers[j].pano_id === marker.meta.pano_id) {
                    panoIndex = j;
                }
            }
            // If the cluster/pano is already up
            if (panoIndex >= 0) {
                // Add label and show label in that view
                panoramaContainers[panoIndex].labels.push(marker.meta);
                showLabel(marker.meta, panoramaContainers[panoIndex], marker.status);
            } else {
                // Clear, add and show label in next view
                $('#clear' + (nextOpenView + 1)).trigger('click');
                panoramaContainers[nextOpenView].labels.push(marker.meta);
                showLabel(marker.meta, panoramaContainers[nextOpenView], marker.status);
            }
        }
        var counts = document.getElementsByClassName("labelCount");
        // Focus views in between headings of labels
        for (var p = 0; p < 4; p++) {
            var pano = panoramaContainers[p];
            var count = pano.labels.length;
            var headingSum = 0.0;
            var pitchSum = 0.0;
            for (var l = 0; l < count; l++) {
                var hdng = mapXYtoPov(
                    pano.labels[l].sv_canvas_x, pano.labels[l].sv_canvas_y,
                    pano.labels[l].canvas_width, pano.labels[l].canvas_height,
                    pano.labels[l].zoom, pano.labels[l].heading, pano.labels[l].pitch).heading;
                if (hdng < 0) {
                    hdng = 360.0 + hdng;
                }
                var ptch = mapXYtoPov(
                    pano.labels[l].sv_canvas_x, pano.labels[l].sv_canvas_y,
                    pano.labels[l].canvas_width, pano.labels[l].canvas_height,
                    pano.labels[l].zoom, pano.labels[l].heading, pano.labels[l].pitch).pitch;
                headingSum += hdng;
                pitchSum += ptch;
            }
            if (count > 0) {
                pano.gsv_panorama.setPov({heading: headingSum / count, pitch: pitchSum / count});
                counts[p].innerHTML = panoramaContainers[p].labels.length;
                pano.gsv_panorama.setOptions({visible: true});
            } else {
                pano.gsv_panorama.setOptions({visible: false});
            }
        }
        nextOpenView = calculateNextOpenPanorama();
    }// End of addClusterToPanos

    // Next and previous button functionality, direction -1 indicates previous, direction 1 indicates next
    // Next and previous button functionality, direction -1 indicates previous, direction 1 indicates next
    function transitionDisagreement(direction) {
        // Update currentClusterIndex
        if (direction > 0) {
            currentClusterIndex = (currentClusterIndex + direction) % cluster_id_list.length;
        } else {
            currentClusterIndex = (currentClusterIndex - 1);
            if (currentClusterIndex < 0) { currentClusterIndex = cluster_id_list.length - 1; }
        }
        var clusterId = cluster_id_list[currentClusterIndex];
        // If there are still unresolved labels in that cluster, display the cluster
        if (all_labels[clusterId].length > 0) {
            currentLabel = all_labels[clusterId][0];
            currentCoordinates = new google.maps.LatLng(currentLabel.lat, currentLabel.lng);
            refocusView(map);
            var toDisplay = all_labels[clusterId].slice();
            // Include labels in the cluster that have already been dealt with
            for (j = 0; j < ground_truth_labels.length; j++) {
                if (ground_truth_labels[j].cluster_id === parseInt(clusterId)) {
                    toDisplay.unshift(ground_truth_labels[j]);
                }
            }
            for (j = 0; j < eliminated_labels.length; j++) {
                if (eliminated_labels[j].cluster_id === parseInt(clusterId)) {
                    toDisplay.unshift(eliminated_labels[j]);
                }
            }
            addClusterToPanos(toDisplay);
            map.setZoom(21);
        }
        // If there are no unresolved labels yet, alert user
        else if (document.getElementById("remainingCounter").innerHTML === "REMAINING LABELS: " + 0) {
            alert("All Labels Complete: Submission Allowed");
            document.getElementById("hiddenColumn").style.display = "inline-block";
        }
        // Otherwise, go to next cluster
        else {
            transitionDisagreement(direction);
        }
    }// End of transitionDisagreement

    //focus view on current label
    function refocusView(map) {
        map.setZoom(21);
        map.setCenter(currentCoordinates);
    }// End refocusView


    // Converts x and y coordinates to place panomarker in GSV
    function mapXYtoPov(canvas_x, canvas_y, canvas_width, canvas_height, zoom, heading, pitch) {
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
        var fov = PanoMarker.get3dFov(zoom) * PI / 180.0;
        var width = canvas_width;
        var height = canvas_height;
        var h0 = heading * PI / 180.0;
        var p0 = pitch * PI / 180.0;
        var f = 0.5 * width / tan(0.5 * fov);
        var x0 = f * cos(p0) * sin(h0);
        var y0 = f * cos(p0) * cos(h0);
        var z0 = f * sin(p0);
        var du = canvas_x - width / 2;
        var dv = height / 2 - canvas_y;
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
    }// End mapXYtoPov

    // Adds any labels that have severity directly to ground truth, and marks any that have null severity to be updated.
    function filterSingleLabelsHavingSeverity(labels) {
        for (var i = 0; i < labels.length; i++) {
            var label = labels[i];
            ground_truth_labels.push(label);
            // If label has a null severity, mark it so that severity can be added.
            if (!label.severity && ['Occlusion', 'NoSidewalk'].indexOf(label.label_type) < 0) {
                toInvestigate.push(label);
            }
        }
        return labels;
    }

    // Adds any labels where all GT labelers agree on severity and temporariness directly to ground truth.
    function filterClusters(data) {
        data = _.groupBy(data, "cluster_id");
         cluster_id_list = Object.keys(data);
        // Iterate through and filter out clusters that are agreed upon
        for (var clusterId in data) {
            var cluster_data = data[clusterId];
            // If there are 3 labels in the cluster, keep looking
            if (cluster_data.length === 3) {
                // Check if all labelers are different
                if (!(cluster_data[0].turker_id === cluster_data[1].turker_id ||
                      cluster_data[0].turker_id === cluster_data[2].turker_id ||
                      cluster_data[1].turker_id === cluster_data[2].turker_id)) {
                    // Check if label type even has severity/temporariness attributes
                    var noInfoLabel = (cluster_data[0].label_type === cluster_data[1].label_type &&
                                       cluster_data[0].label_type === cluster_data[2].label_type) &&
                                      ['Occlusion','NoSidewalk'].indexOf(cluster_data[0].label_type) >= 0;
                    // Check if severities are all the same
                    var sameSeverity = noInfoLabel ||
                                       (!(cluster_data[0].severity === null &&
                                          cluster_data[1].severity === null &&
                                          cluster_data[2].severity === null) &&
                                         (cluster_data[0].severity === cluster_data[1].severity &&
                                          cluster_data[0].severity === cluster_data[2].severity));
                    // Check if temporariness are all the same
                    var sameTemp = noInfoLabel ||
                                   (cluster_data[0].temporary === cluster_data[1].temporary &&
                                    cluster_data[0].temporary === cluster_data[2].temporary);
                    // Calculate middle label
                    middle = chooseMiddle(cluster_data);
                    if (!(sameSeverity && sameTemp)) {
                        var label = cluster_data[middle];
                        var cluster = cluster_data.slice();
                        toInvestigate.push({data: cluster, label: label, sev: sameSeverity, temp: sameTemp, chosen: middle});
                    }
                    // Add middle label to ground_truth labels, other two to eliminated_labels
                    // Map markers' style and status will update accordingly
                    ground_truth_labels.push(cluster_data[middle]);
                    cluster_data.splice(middle, 1);
                    for (var i = 0; i < cluster_data.length; i) {
                        eliminated_labels.push(cluster_data[i]);
                        cluster_data.splice(i, 1);
                    }
                }
            }
        }
        return data;
    }// End of filterClusters

    // Prompts the user to update the severity of the label at the specified index.
    function fixSeverities(labels, index) {
        var label_data = labels[index];
        // Set coordinates
        currentCoordinates = new google.maps.LatLng(label_data.lat, label_data.lng);

        // Show on panorama
        panoramaContainers[0].gsv_panorama = new google.maps.StreetViewPanorama(document.getElementById("panorama-1"), {
            pano: label_data.pano_id,
            pov: {
                heading: label_data.heading,
                pitch: label_data.pitch
            },
            disableDefaultUI: true,
            clickToGo: false,
            zoomControl: true
        });

        // Display decided upon label
        clearCanvas(0, false);
        showLabel(label_data, panoramaContainers[0], "One Turker");
        panoramaContainers[0].labels.push(label_data);

        // Display information regarding the disagreement and provide option to change severity and temporary
        document.getElementById("panorama-3").innerHTML =
            '<br>' +
            '<table style="width:100%">' +
                '<tr>' +
                    '<th>Labeler</th>' +
                    '<th id="sev_heading" style="text-align:center">Severity</th>' +
                    '<th id="temp_heading" style="text-align:center">Temp</th>' +
                    '<th style="text-align:center">Description</th>' +
                '</tr>' +
                '<tr>' +
                    '<td id="user0">' + label_data.turker_id + '</td>' +
                    '<td style="text-align:center">' + label_data.severity + '</td>' +
                    '<td style="text-align:center">' + label_data.temporary + '</td>' +
                    '<td style="text-align:center">' + label_data.description + '</td>' +
                '</tr>' +
            '</table><br>' +
            'Severity: <select name="severity" id="severity">' +
                '<option value="1">1</option>' +
                '<option value="2">2</option>' +
                '<option value="3">3</option>' +
                '<option value="4">4</option>' +
                '<option value="5">5</option>' +
            '</select><br>' +
            'Temporary: <input type="checkbox" id ="temp"><br>' +
            '<button style="margin-top:4px" id="prelimCommit' + label_data.cluster_id + '">' +
                'Submit Updates to Ground Truth' +
            '</button>';

        // Highlight the disagreement in the table
        document.getElementById("sev_heading").style.backgroundColor = "#ff6d77";

        // Update label found in ground truth
        var toUpdate = ground_truth_labels.find(lbl => lbl.label_id === label_data.label_id);
        var next = index + 1;

        // Button functionality
        $(document).on("click", '#prelimCommit' + toUpdate.cluster_id, function () {

            // Update severity and temporaryness
            toUpdate.severity = parseInt(document.getElementById("severity").value);
            toUpdate.temporary = document.getElementById("temp").checked;
            updateCountersForOneLabeler(next);

            // Move to next missing severity, otherwise we are done!
            if (next < labels.length) {
                fixSeverities(labels, next);
            } else {
                // We are done! Pop up the alert and show the submit to ground truth button.
                alert("All Labels Complete: Submission Allowed");
                document.getElementById("hiddenColumn").style.display = "inline-block";
            }
        });
    }

    // Investigates a low disagreement conflict, submit severity and temporary
    function resolveLowDisagreementConflict(data, index) {
        var label_data = data[index].label;
        var cluster_data = data[index].data;
        // Set coordinates
        currentCoordinates = new google.maps.LatLng(label_data.lat, label_data.lng);
        map.setCenter(currentCoordinates);
        // Show on panorama
        panoramaContainers[0].gsv_panorama = new google.maps.StreetViewPanorama(document.getElementById("panorama-1"), {
            pano: label_data.pano_id,
            pov: {
                heading: label_data.heading,
                pitch: label_data.pitch
            },
            disableDefaultUI: true,
            clickToGo: false,
            zoomControl: true
        });
        // Display decided upon label
        clearCanvas(0, true);
        showLabel(label_data, panoramaContainers[0], "Filter");
        panoramaContainers[0].labels.push(label_data);
        // Display information regarding the disagreement and provide option to change severity and temporary
        document.getElementById("panorama-3").innerHTML =
            '<br><table style="width:100%">' +
                '<tr>' +
                    '<th>Labeler</th>' +
                    '<th id="sev_heading" style="text-align:center">Severity</th>' +
                    '<th id="temp_heading" style="text-align:center">Temp</th>' +
                    '<th style="text-align:center">Description</th>' +
                '</tr>' +
                '<tr>' +
                    '<td id="user0">' + cluster_data[0].turker_id + '</td>' +
                    '<td style="text-align:center">' + cluster_data[0].severity + '</td>' +
                    '<td style="text-align:center">' + cluster_data[0].temporary + '</td>' +
                    '<td style="text-align:center">' + cluster_data[0].description + '</td>' +
                '</tr>' +
                '<tr>' +
                    '<td id="user1">' + cluster_data[1].turker_id + '</td>' +
                    '<td style="text-align:center">' + cluster_data[1].severity + '</td>' +
                    '<td style="text-align:center">' + cluster_data[1].temporary + '</td>' +
                    '<td style="text-align:center">' + cluster_data[1].description + '</td>' +
                '</tr>' +
                '<tr>' +
                    '<td id="user2">' + cluster_data[2].turker_id + '</td>' +
                    '<td style="text-align:center">' + cluster_data[2].severity + '</td>' +
                    '<td style="text-align:center">' + cluster_data[2].temporary + '</td>' +
                    '<td style="text-align:center">' + cluster_data[2].description + '</td>' +
                '</tr>' +
            '</table><br>' +
            'Severity: <select name="severity" id="severity">' +
                '<option value="1">1</option>' +
                '<option value="2">2</option>' +
                '<option value="3">3</option>' +
                '<option value="4">4</option>' +
                '<option value="5">5</option>' +
            '</select><br>' +
            'Temporary: <input type="checkbox" id ="temp"><br>' +
            '<button style="margin-top:4px" id="prelimCommit' + label_data.cluster_id + '">' +
                'Submit Updates to Ground Truth' +
            '</button>';

        // Highlight the disagreement in the table
        if (!data[index].sev) {
            document.getElementById("sev_heading").style.backgroundColor = "#ff6d77";
        }
        if (!data[index].temp) {
            document.getElementById("temp_heading").style.backgroundColor = "#ff6d77";
        }
        // Highlight the middle label being shown
        document.getElementById("user" + data[index].chosen).style.backgroundColor = "#ffe500";

        // Update label found in ground truth
        var toUpdate = ground_truth_labels.find(lbl => lbl.label_id === label_data.label_id);
        var next = index + 1;

        // Button functionality
        $(document).on("click", '#prelimCommit' + toUpdate.cluster_id, function () {
            // Update severity and temporary
            toUpdate.severity = parseInt(document.getElementById("severity").value);
            toUpdate.temporary = document.getElementById("temp").checked;
            updateCounters();

            // Move to next low disagreement conflict
            if (next < data.length) {
                resolveLowDisagreementConflict(data, next);
            } else {
                startThirdRound();
            }
        });
    }// End of resolveLowDisagreementConflict

    // Begin high disagreement round
    function startThirdRound() {
      // Finished with low level conflicts
      cluster_id_list.length = Object.keys(all_labels).length;
      // Intiailize mapbox layers and GSV panoramas
      currentClusterIndex = 0;
      var clusterId = cluster_id_list[currentClusterIndex];
      while (all_labels[clusterId].length <= 0) {
          currentClusterIndex++;
          clusterId = cluster_id_list[currentClusterIndex];
      }
      currentLabel = all_labels[clusterId][0];
      currentCoordinates = new google.maps.LatLng(currentLabel.lat, currentLabel.lng);
      map.setCenter(currentCoordinates);
        if (panoramaContainers[0].gsv_panorama !== null) {
            clearCanvas(0, true);
        }
      document.getElementById("panorama-3").innerHTML = null;
      // Initialize panoramas and show the first high disagreement cluster
      initializePanoramas(currentLabel);
      addClusterToPanos(all_labels[clusterId]);
      document.getElementById("round").innerHTML = "Ground Truth Resolution Tool - High Disagreement Round";
    }// End of startThirdRound

    // Choose the middle of three points
    function chooseMiddle(points) {
        // Calculate midpoint
        var avg_lat = (points[0].lat + points[1].lat + points[2].lat) / 3;
        var avg_lng = (points[0].lng + points[1].lng + points[2].lng) / 3;
        // Choose the label closest to the midpoint
        var min = 1000000000000;
        var mid_label;
        for (i = 0; i < points.length; i++) {
            var distance = Math.sqrt(Math.pow(avg_lat - points[i].lat, 2) + Math.pow(avg_lng - points[i].lng, 2));
            if (distance < min) {
                min = distance;
                mid_label = i;
            }
        }
        return mid_label;
    }// End of chooseMiddle

    // Initial onload
    function initialize() {
        // Create map
        mapOptions = {
            center: new google.maps.LatLng(38.95965576171875, -77.07019805908203),
            mapTypeControl: false,
            mapTypeId: typeof google != "undefined" ? google.maps.MapTypeId.ROADMAP : null,
            maxZoom: 22,
            minZoom: 19,
            overviewMapControl: false,
            panControl: true,
            rotateControl: false,
            scaleControl: false,
            streetViewControl: false,
            zoomControl: true,
            zoom: 21
        };
        var mapCanvas = document.getElementById("groundtruth-map");
        map = typeof google != "undefined" ? new google.maps.Map(mapCanvas, mapOptions) : null;
        // Styling google map.
        mapStyleOptions = [
            {
                featureType: "all",
                stylers: [
                    {visibility: "off"}
                ]
            },
            {
                featureType: "road",
                stylers: [
                    {visibility: "on"}
                ]
            },
            {
                "elementType": "labels",
                "stylers": [
                    {"visibility": "off"}
                ]
            }
        ];
        if (map) map.setOptions({styles: mapStyleOptions});

        // Initialize panorama data
        for (var i = 0; i < 4; i++) {
            panoramaContainers.push({
                number: i + 1,  // Number indicative of panorama
                gsv_panorama: null, // The StreetViewPanorama object for each view
                view: document.getElementsByClassName("gtpano")[i], // Holder for the GSV panorama
                info: document.getElementsByClassName("labelstats")[i], // Div above panorama holding label information
                labels: [], // Metadata of label displayed in each panorama ({} if no label is displayed)
                labelMarkers: [], // The marker for the label in the panorama
                cluster_id: null,
                pano_id: null
            });
        }

        // Map all button functionalities
        document.getElementById("gtnext").onclick = function () {
            transitionDisagreement(1);
        };
        document.getElementById("gtrefocus").onclick = function () {
            refocusView(map);
        };
        document.getElementById("gtprev").onclick = function () {
            transitionDisagreement(-1);
        };
        document.getElementById("clear1").onclick = function () {
            clearCanvas(0, true);
        };
        document.getElementById("clear2").onclick = function () {
            clearCanvas(1, true);
        };
        document.getElementById("clear3").onclick = function () {
            clearCanvas(2, true);
        };
        document.getElementById("clear4").onclick = function () {
            clearCanvas(3, true);
        };
        document.getElementById("gtSubmit").onclick = function () {
            async = true;
            var data = [];
            console.log(ground_truth_labels);
            for (var i = 0; i < ground_truth_labels.length; i++) {
                var toSubmit = ground_truth_labels[i];
                toSubmit.label_type = labelTypeMapping[toSubmit.label_type];
                delete toSubmit.turker_id;
                toSubmit.description = toSubmit.description ? toSubmit.description : "";

                data.push(toSubmit);
            }
            console.log(data);
            $.ajax({
                async: true,
                contentType: 'application/json; charset=utf-8',
                url: "/gtresolution/results",
                type: 'post',
                data: JSON.stringify(data),
                dataType: 'json',
                success: function (result) {
                    console.log(result)
                },
                error: function (result) {
                    console.error(result);
                }
            });
        };

        // When three GT labelers were clustered, and we are resolving disagreements, this button is pressed.
        document.getElementById("submitClusterSessionId").onclick = function () {
            // Query database for the label data
            var clusteringSessionId = document.getElementById("sessionOrConditionId").value;
            // var test_labels = gtTestData;
            $.getJSON("/labelsForGtResolution/" + clusteringSessionId, function (data) {
                all_labels = filterClusters(data[0]);
                console.log(all_labels);
                // all_labels = filterClusters(test_labels);
                updateCounters();
                document.getElementById("round").innerHTML = "Ground Truth Resolution Tool - Low Disagreement Round";
                // Display all labels on map
                initializeAllMapMarkers();
                // Deal with the first low disagreement conflict
                if (toInvestigate.length > 0) {
                    resolveLowDisagreementConflict(toInvestigate, 0);
                } else {
                    startThirdRound();
                }
            });

            // Reduce filler at bottom of page (styling purposes)
            document.getElementById("filler").style.minHeight = "5px";
        };

        // When only one GT labeler was used and we are filling in their missing severity, this button is pressed.
        document.getElementById("submitConditionId").onclick = function () {
            // Query database for the label data
            var conditionId = document.getElementById("sessionOrConditionId").value;
            $.getJSON("/labelsForGTFixSeverity/" + conditionId, function (data) {
                all_labels = filterSingleLabelsHavingSeverity(data[0]);
                updateCountersForOneLabeler(0);
                document.getElementById("round").innerHTML = "Ground Truth Resolution Tool - Low Disagreement Round";

                // Deal with missing severities
                if (toInvestigate.length > 0) {
                    fixSeverities(toInvestigate, 0);
                } else {
                    // We are done! Pop up the alert and show the submit to ground truth button.
                    alert("All Labels Complete: Submission Allowed");
                    document.getElementById("hiddenColumn").style.display = "inline-block";
                }
            });

            // Reduce filler at bottom of page (styling purposes)
            document.getElementById("filler").style.minHeight = "5px";
        };
    }// End of initialize

    initialize();
});
