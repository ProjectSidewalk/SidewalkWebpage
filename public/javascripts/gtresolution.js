$(document).ready(function () {

    //current route
    var cluster_session_id;
    //all labels and gt labels
    var all_labels = []; //json input
    var ground_truth_labels = []; //json output
    var eliminated_labels = []; //labels not selected for ground truth

    var map;

    //stores which disagreement is being looked at currently
    var currentCluster;
    var currentLabel;
    var clusterCount;
    // currentCoordinates are formats for the label's lat lng position
    var currentCoordinates;

    //array that stores information about each panorama/view
    var panoramaContainers = [];

    //store map markers
    mapMarkers = [];

    //stores the next open view to display a label on
    var nextOpenView = 0;


    //stores color information for each label type
    var colorMapping = {
        CurbRamp: {
            id: 'CurbRamp',
            fillStyle: '00DE26',  // 'rgba(0, 244, 38, 1)'
            strokeStyle: '#ffffff'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            fillStyle: 'E92771',  // 'rgba(255, 39, 113, 1)'
            strokeStyle: '#ffffff'
        },
        Obstacle: {
            id: 'Obstacle',
            fillStyle: '00A1CB',
            strokeStyle: '#ffffff'
        },
        Other: {
            id: 'Other',
            fillStyle: 'B3B3B3', //'rgba(204, 204, 204, 1)'
            strokeStyle: '#0000ff'

        },
        Occlusion: {
            id: 'Occlusion',
            fillStyle: 'B3B3B3',
            strokeStyle: '#009902'
        },
        NoSidewalk: {
            id: 'NoSidewalk',
            fillStyle: 'B3B3B3',
            strokeStyle: '#ff0000'
        },
        SurfaceProblem: {
            id: 'SurfaceProblem',
            fillStyle: 'F18D05',
            strokeStyle: '#ffffff'
        }
    };

    //stores settings for mapbox markers
    var geojsonMarkerOptions = {
        radius: 5,
        fillColor: "#ff7800",
        color: "#ffffff",
        weight: 1,
        opacity: 0.5,
        fillOpacity: 0.5,
        "stroke-width": 1
    };


    //initialize all labels on the mapbox map
    function initializeAllLayers(data, self, map) {
      var features = []
        for (var clusterId in data) {
          for (j = 0; j < data[clusterId].length; j++) {
            var lbl = data[clusterId][j];
            features.push({position: new google.maps.LatLng(lbl.lat, lbl.lng), type: lbl.label_type, meta: lbl, status: null});
          }
        }
        for (j = 0; j < ground_truth_labels.length; j++) {
          var lbl = ground_truth_labels[j];
          features.push({position: new google.maps.LatLng(lbl.lat, lbl.lng), type: lbl.label_type, meta: lbl, status: "Ground_Truth"});
        }
        for (j = 0; j < eliminated_labels.length; j++) {
          var lbl = eliminated_labels[j];
          features.push({position: new google.maps.LatLng(lbl.lat, lbl.lng), type: lbl.label_type, meta: lbl, status: "No_Ground_Truth"});
        }


            // Create markers.
            features.forEach(function(feature) {
              var color = "#" + colorMapping[feature.meta.label_type].fillStyle;
              var opacity = 0.4;
              var z = 100;
              if(feature.status === "Ground_Truth"){
                color = "#fcf41b";
                opacity = 0.8;
                z = 200;
              }else if(feature.status === "No_Ground_Truth"){
                color = "#000000";
                opacity = 0.6;
                z = 50;
              }
              var marker = new google.maps.Circle({
                  id: "marker" + feature.meta.label_id,
                  meta: feature.meta,
                  status: feature.status,
                  center: new google.maps.LatLng(feature.meta.lat,feature.meta.lng),
                  radius:0.8,
                  clickabe: true,
                  strokeColor:"#000000",
                  strokeOpacity:0.8,
                  strokeWeight:0.5,
                  fillColor: color,
                  fillOpacity: opacity,
                  zIndex: z
                });

                marker.addListener('click', function() {
                  //test whether the label is already being shown in one of the four views
                  var id = marker.meta.label_id;
                  var labelIndex = panoramaContainers.findIndex(panoramaContainer => panoramaContainer.label.label_id === id );
                  // If it's being shown, clear the canvas it's being shown in, o/w display the label and log that it is shown
                  if (labelIndex >= 0) {
                      $('#clear' + (labelIndex + 1)).trigger('click');
                      if(marker.status === null){marker.setOptions({fillColor: "#" + colorMapping[marker.meta.label_type].fillStyle});}
                  } else {
                    /*check if pano is already being shown, if so add label to that panorama
                    var pano = feature.properties.metadata.pano_id;
                    var panoIndex = panoramaContainers.findIndex(panoramaContainer => panoramaContainer.label.pano_id === pano );
                    if (panoIndex >= 0) {
                      showLabel(feature.properties.metadata, panoIndex);
                    }else{*/
                      $('#clear' + (nextOpenView + 1)).trigger('click');
                      panoramaContainers[nextOpenView].label.label_id = id;
                      if(marker.status === null){marker.setOptions({fillColor: '#ff38fb'});}
                      showLabel(marker.meta, nextOpenView, marker.status);
                    }
                });
                marker.addListener('mouseover', function() {
                  //test whether label is present within a view
                  var present = panoramaContainers.some(panoramaContainer => panoramaContainer.label.label_id === marker.meta.label_id);
                  //if so, highlight that view with a border
                  if (present) {
                      var pano = panoramaContainers.find(panoramaContainer => panoramaContainer.label.label_id === marker.meta.label_id );
                      pano.view.style.borderStyle = "solid";
                  }
                  //emphasize label on map
                  if(marker.status === null){marker.setOptions({fillColor: '#ff38fb'});}
                });

                marker.addListener('mouseout', function(){
                  //test whether label is present within a view
                  var present = panoramaContainers.some(panoramaContainer => panoramaContainer.label.label_id === marker.meta.label_id);
                  // if present, hide border highlight, o/w remove emphasis
                  //if not, remove emphasis
                  if (present) {
                      var pano = panoramaContainers.find(panoramaContainer => panoramaContainer.label.label_id === marker.meta.label_id );
                      pano.view.style.borderStyle = "hidden";
                  } else{
                    if(marker.status === null){marker.setOptions({fillColor: "#" + colorMapping[marker.meta.label_type].fillStyle});}
                  }
                });

                marker.setMap(map);
                mapMarkers.push(marker);
            });
    }



    //set the GSV panoramas
    function initializePanoramas(label, panosToUpdate) {
          for (var i = 0; i < panosToUpdate.length; i++) {
              //update all indicated panoramas
              panoramaContainers[i].gsv_panorama = new google.maps.StreetViewPanorama(panosToUpdate[i], {
                  pano: label.pano_id,
                  pov: {
                      heading: label.heading,
                      pitch: label.pitch
                  },
                  disableDefaultUI: true,
                  clickToGo: false
              });
          }
    }


    //choose the earliest of the open views (views not displaying a label)
    //if all full, choose the first view
    function calculateNextOpen() {
        for (var i = 0; i < panoramaContainers.length; i++) {
            if (panoramaContainers[i].label.label_id === undefined) {
                return i;
            }
        }
        return 0;
    }


    //show label in panorama
    function showLabel(label, panoIndex, status) {
        nextOpenView = calculateNextOpen();
            $('#pano' + (panoIndex + 1) + '-holder').children('div.loading').fadeOut('slow', function () {
                $(this).remove();
            });
            panoramaContainers[panoIndex].label = label;
            //update info
            panoramaContainers[panoIndex].info.innerHTML = "<b>Cluster ID:</b> " + label.cluster_id + " | <b>Labeler:</b> " + label.username + " | <b>Severity:</b> " + label.severity;
            //draw label
            renderLabel(label, panoIndex, status);
            //update selected panorama
            var toChange = panoramaContainers[panoIndex].gsv_panorama;
            toChange.setPano(label.pano_id);
            toChange.setPov({heading: label.heading, pitch: label.pitch});
        $('#pano' + (panoIndex + 1) + '-holder').prepend(
            '<div class="loading" style="width:100%; height: 115%; z-index:5;position:absolute;background-color:rgba(255, 255, 255, 0.67)">' +
            '<p style="text-align:center;vertical-align:center;position:relative;top:50%;height:90%"></p>' +
            '</div>').children('div.loading').fadeOut('slow', function () {
                $(this).remove();
            });;
    }

    //draw a label in the view
    function renderLabel(label, panoIndex, status) {
        //choose the next open canvas
        var open = panoramaContainers[panoIndex].gsv_panorama;
        // Create PanoMarkervar
        var labelPosition = mapXYtoPov(label.sv_canvas_x, label.sv_canvas_y, label.canvasWidth, label.canvas_height, label.zoom, label.heading, label.pitch);
        var id = "label-id-" + label.label_id;
        var icon;
        var label_marker = new PanoMarker({
            pano: panoramaContainers[panoIndex].gsv_panorama,
            container: panoramaContainers[panoIndex].view,
            position: {heading: labelPosition.heading, pitch: labelPosition.pitch},
            id: id,
            icon: selectMarker(label, status),
            size: new google.maps.Size(30, 30),
            scaledSize: new google.maps.Size(15, 15)
        });
        panoramaContainers[panoIndex].labelMarker = label_marker;
        // Add listener to marker to show info upon clicking
        if(status != "Filter"){
        google.maps.event.addListener(panoramaContainers[panoIndex].labelMarker, 'click', function () {
            createPopover(panoIndex);
        });

        // Popover follows marker when POV is changed
        google.maps.event.addListener(panoramaContainers[panoIndex].gsv_panorama, 'pov_changed', function () {
            if (panoramaContainers[panoIndex].popoverOn) {
                $("#" + id).popover('show');
            }
        });
      }
        return this;
    }


    // Create popover for marker
    function createPopover(index) {
        var data = panoramaContainers[index].label;
        var markerElement = $("#label-id-" + data.label_id);
        panoramaContainers[index].popoverOn = !panoramaContainers[index].popoverOn;

        if (markerElement.attr('data-toggle') === undefined) {
            markerElement
                .attr('data-toggle', 'popover')
                .attr('data-placement', 'top')
                .attr('data-content',
                    '<p style="text-align:center"><b>Severity:</b>&nbsp;' + data.severity + ', <b>Description:</b>&nbsp;' + data.description
                    + '</p>' +
                    '<input type="button" id="commit' + data.label_id + '" style="margin-top:2" value="Commit to GT"></input>' +
                    '<input type="button" id="noCommit' + data.label_id + '" style="margin-top:2" value="Don\'t Commit to GT"></input>' +
                    '<a href="javascript:;" id="toggle-visible-' + data.label_id + '" style="margin-left:8px"><span class="glyphicon glyphicon-eye-open" style="color:#7CE98B; font-size:14px"></span></a>') // 9eba9e
                .popover({html: true})
                .parent().delegate('a#toggle-visible-' + data.label_id, 'click', function (e) {
                if (panoramaContainers[index].labelMarker.getIcon() === null) {
                    var marker = mapMarkers.find(mkr => mkr.meta.label_id === data.label_id );
                    panoramaContainers[index].labelMarker.setIcon(selectMarker(data,marker.status));
                    markerElement.children('a').children('span').css('color', '#7CE98B');
                } else {
                    panoramaContainers[index].labelMarker.setIcon(null);
                    markerElement.children('a').children('span').css('color', '#F8F4F0');
                }
            });
            $(document).on("click", '.popover #commit' + data.label_id , function(){
                $("#label-id-" + data.label_id).popover('hide');
                yesGroundTruth(panoramaContainers[index].label);
            });
            $(document).on("click", '.popover #noCommit' + data.label_id , function(){
                $("#label-id-" + data.label_id).popover('hide');
                noGroundTruth(panoramaContainers[index].label);
            });
            panoramaContainers[index].popoverOn = true;

            // Toggle visibility of label marker
            markerElement.on('click', 'a#toggle-visible-' + data.label_id, function (e) {
                if (panoramaContainers[index].labelMarker.getIcon() === null) {
                    panoramaContainers[index].labelMarker.setIcon("assets/javascripts/SVLabel/img/cursors/Cursor_" + data.label_type + ".png");
                    this.children('span').css('color', '#7CE98B');
                } else {
                    panoramaContainers[index].labelMarker.setIcon(null);
                    this.children('span').css('color', '#F8F4F0');
                }
            });
        }
    }

    function selectMarker(label, status){
      if(status === "Ground_Truth"){
        return "assets/javascripts/SVLabel/img/ground_truth/gt_commit_" + label.label_type + ".png";
      }else if(status === "No_Ground_Truth"){
        return "assets/javascripts/SVLabel/img/ground_truth/gt_exclude_" + label.label_type + ".png";
      }else{
        return "assets/javascripts/SVLabel/img/cursors/Cursor_" + label.label_type + ".png";
      }
    }

    //this label will go in ground truth
    function yesGroundTruth(commit){
          //update visuals
          var pano = panoramaContainers.findIndex(i => i.label.label_id === commit.label_id);
          panoramaContainers[pano].labelMarker.setIcon("assets/javascripts/SVLabel/img/ground_truth/gt_commit_" + commit.label_type + ".png");
          var marker = mapMarkers.find(mkr => mkr.meta.label_id === commit.label_id );
          //execute commit
          var index;
          if(marker.status === "No_Ground_Truth"){
            index = eliminated_labels.findIndex(i => i.label_id === commit.label_id);
            eliminated_labels.splice(index,1);
            ground_truth_labels.push(commit);
          }else if(marker.status === null){
            index = all_labels[commit.cluster_id].findIndex(i => i.label_id === commit.label_id);
            all_labels[commit.cluster_id].splice(index,1);
            ground_truth_labels.push(commit);
          }
          marker.setOptions({fillColor: "#fcf41b", status: "Ground_Truth", fillOpacity: 0.8, zIndex: 200});
    }

    //this label will not go in ground truth
    function noGroundTruth(commit){
      //update visuals
      var pano = panoramaContainers.findIndex(i => i.label.label_id === commit.label_id);
      panoramaContainers[pano].labelMarker.setIcon("assets/javascripts/SVLabel/img/ground_truth/gt_exclude_" + commit.label_type + ".png");
      var marker = mapMarkers.find(mkr => mkr.meta.label_id === commit.label_id );
      //execute commit
      var index;
      if(marker.status === "Ground_Truth"){
        index = ground_truth_labels.findIndex(i => i.label_id === commit.label_id);
        ground_truth_labels.splice(index,1);
        eliminated_labels.push(commit);
      }else if(marker.status === null){
        index = all_labels[commit.cluster_id].findIndex(i => i.label_id === commit.label_id);
        all_labels[commit.cluster_id].splice(index,1);
        eliminated_labels.push(commit);
      }
      marker.setOptions({fillColor: "#000000", status: "No_Ground_Truth", fillOpacity: 0.6, zIndex: 50});
    }

    //clear a specific canvas
    function clearCanvas(index, layers) {
        var panoramaContainer = panoramaContainers[index];
        if (panoramaContainer.labelMarker !== null) {
            var labelId = panoramaContainer.label.label_id;
            var layer = undefined;
            var labelsOfAType = [];

            for (var labelType in layers) {
                if (layers.hasOwnProperty(labelType)) {
                    if (!Array.isArray(layers[labelType])) { // Go through all labels on map and find the one that matches the one that we're trying to clear from the canvas
                        labelsOfAType = $.map(layers[labelType]._layers, function (value, index) {
                            return [value];
                        });
                        layer = (layer === undefined) ? labelsOfAType.find(function (label) {
                            return label.feature.properties.label_id === labelId
                        }) : layer;
                    }
                }
            }

            if (layer !== undefined) {
                layer.setRadius(5);
            }

            var marker = mapMarkers.find(mkr => mkr.meta.label_id === labelId );
            if(marker.status === null){marker.setOptions({fillColor: "#" + colorMapping[marker.meta.label_type].fillStyle});}

            $('#label-id-' + labelId).popover('hide');
            panoramaContainer.info.innerHTML = "";
            panoramaContainer.view.style.borderStyle = "hidden";
            panoramaContainer.label = {};
            panoramaContainer.popoverOn = false;
            nextOpenView = calculateNextOpen();
            google.maps.event.clearListeners(panoramaContainers[index].gsv_panorama, 'pov_changed');
            panoramaContainers[index].labelMarker.setMap(null);
            panoramaContainers[index].labelMarker = null;
        }
    }


    //next button functionality
    function nextDisagreement(map) {
        currentCluster = (currentCluster + 1) % clusterCount;
        if(currentCluster === 0){currentCluster++;}
        if(all_labels[currentCluster].length>0){
          currentLabel = all_labels[currentCluster][0];
          currentCoordinates = new google.maps.LatLng(currentLabel.lat,currentLabel.lng);
          refocusView(map);
        }else{
          nextDisagreement(map);
        }
    }

    //previous button functionality
    function previousDisagreement(map) {
        currentCluster = (currentCluster - 1);
        if(currentCluster === 0){currentCluster = clusterCount;}
        if(all_labels[currentCluster].length>0){
          currentLabel = all_labels[currentCluster][0];
          currentCoordinates = new google.maps.LatLng(currentLabel.lat,currentLabel.lng);
          refocusView(map);
        }else{
          previousDisagreement(map);
        }
    }

    //focus view on current label
    function refocusView(map) {
        map.setCenter(currentCoordinates);
    }


    /**
     * Given the current POV, zoom and the original canvas dimensions and coordinates for the label,
     * this method calculates the POV on the
     * given viewport for the desired POV. All credit for the math this method goes
     * to user3146587 on StackOverflow: http://goo.gl/0GGKi6
     *
     * @param {number} canvas_x: the x-coordinate of the label on the original panorama
     * @param {number} canvas_y: the y-coordinate of the label on the original panorama
     * @param {number} canvas_width: the width of the original panorama image
     * @param {number} canvas_height: the height of the original panorama image
     * @param {number} zoom: The current zoom level.
     * @param {number} heading: heading of the viewport center
     * @param {number} pitch: pitch of the viewport center.
     * @return {Object} heading and pitch of the point in our panorama
     */
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
    }


    function initialize() {
      mapOptions = {
          center: new google.maps.LatLng(38.95965576171875,-77.07019805908203),
          mapTypeControl:false,
          mapTypeId: typeof google != "undefined" ? google.maps.MapTypeId.ROADMAP : null,
          maxZoom : 20,
          minZoom : 20,
          overviewMapControl:false,
          panControl:true,
          rotateControl:false,
          scaleControl:false,
          streetViewControl:false,
          zoomControl:false,
          zoom: 20
      };
      var mapCanvas = document.getElementById("groundtruth-map");
      map = typeof google != "undefined" ? new google.maps.Map(mapCanvas, mapOptions) : null;
      // Styling google map.
      mapStyleOptions = [
          {
              featureType: "all",
              stylers: [
                  { visibility: "off" }
              ]
          },
          {
              featureType: "road",
              stylers: [
                  { visibility: "on" }
              ]
          },
          {
              "elementType": "labels",
              "stylers": [
                  { "visibility": "off" }
              ]
          }
      ];
      if (map) map.setOptions({styles: mapStyleOptions});

        // Initialize panorama data
        for (var i = 0; i < 4; i++) {
            panoramaContainers.push({
                gsv_panorama: null, // the StreetViewPanorama object for each view
                view: document.getElementsByClassName("gtpano")[i], // holder for the GSV panorama
                info: document.getElementsByClassName("labelstats")[i], // div above panorama holding label information
                label: {}, // metadata of label displayed in each panorama ({} if no label is displayed)
                popoverOn: false, //
                labelMarker: null // the marker for the label in the panorama
            });
        }



        //map all button functionalities
        document.getElementById("gtnext").onclick = function () {
            nextDisagreement(map);
        };
        document.getElementById("gtrefocus").onclick = function () {
            refocusView(map);
        };
        document.getElementById("gtprev").onclick = function () {
            previousDisagreement(map);
        };
        document.getElementById("clear1").onclick = function () {
            clearCanvas(0, self.allLayers);
        };
        document.getElementById("clear2").onclick = function () {
            clearCanvas(1, self.allLayers);
        };
        document.getElementById("clear3").onclick = function () {
            clearCanvas(2, self.allLayers);
        };
        document.getElementById("clear4").onclick = function () {
            clearCanvas(3, self.allLayers);
        };
        document.getElementById("submitClusterSessionId").onclick = function () {
            cluster_session_id = document.getElementById("clusterSessionId").value;
            var test_labels = gtTestData; //eventually, query will run here
            all_labels = _.groupBy(test_labels, "cluster_id");;
            clusterCount = Object.keys(all_labels).length;
            //intiailize mapbox layers and GSV panoramas
            currentCluster = 1;
            if(all_labels[currentCluster].length > 0){currentLabel = all_labels[currentCluster][0];}
            else{currentLabel = ground_truth_labels[0];}
            currentCoordinates = new google.maps.LatLng(currentLabel.lat, currentLabel.lng);
            map.setCenter(currentCoordinates);
            var panoramas = panoramaContainers.map(panoramaContainer => panoramaContainer.view );
            initializePanoramas(currentLabel, panoramas);
            initializeAllLayers(all_labels, self, map);
        };

        //reduce filler at bottom of page (styling purposes)
        document.getElementById("filler").style.minHeight = "40px";
    }


    function filterClusters(data){
      data = _.groupBy(data, "cluster_id");
      var toInvestigate = [];
      //iterate through and filter out clusters that are agreed upon
      for (var clusterId in data) {
        var cluster_data = data[clusterId];
        //if there are 3 labels in the cluster, keep looking
        if(cluster_data.length === 3){
          //check if all labelers are different
          if(!((cluster_data[0].username === cluster_data[1].username) || (cluster_data[0].username === cluster_data[2].username) || (cluster_data[1].username === cluster_data[2].username))){
            //check if severities are all the same
            var sameSeverity = (cluster_data[0].severity === cluster_data[1].severity && cluster_data[0].severity === cluster_data[2].severity);
            var sameTemp = (cluster_data[0].temporary === cluster_data[1].temporary && cluster_data[0].temporary === cluster_data[2].temporary);
            if(sameSeverity && sameTemp){
              //calculate middle label
              middle = 0;
              //add middle label to ground_truth labels, other two to eliminated_labels
              //map markers' style and status will update accordingly
              ground_truth_labels.push(cluster_data[middle]);
              cluster_data.splice(middle,1);
              for(var i = 0; i < cluster_data.length; i){
                eliminated_labels.push(cluster_data[i]);
                cluster_data.splice(i,1);
              }
            }else{
              //calculate middle label
              middle = 0;
              //add middle label to be investigated, other two to eliminated_labels
              toInvestigate.push(cluster_data[middle]);
              cluster_data.splice(middle,1);
              for(var i = 0; i < cluster_data.length; i){
                eliminated_labels.push(cluster_data[i]);
                cluster_data.splice(i,1);
              }
            }
          }
        }
      }
      //initialize first panorama
        panoramaContainers[0].gsv_panorama = new google.maps.StreetViewPanorama(document.getElementsByClassName("gtpano")[0], {
            pano: toInvestigate[i].pano_id,
            pov: {
                heading: toInvestigate[i].heading,
                pitch: toInvestigate[i].pitch
            },
            disableDefaultUI: true,
            clickToGo: false
        });
      //deal with labels to be investigated
      for(var i = 0; i < toInvestigate.length; i++){
        showLabel(toInvestigate[i],0,"Filter");

      }
      return data;
    }

    //test data
    var gtTestData = [
    {"label_id":73253,"username":"Ryan","cluster_id":11,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":9873,"sv_image_y":-612,"sv_canvas_x":421,"sv_canvas_y":121,"heading":257.4910583496094,"pitch":-35.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.07019805908203,"description":null,"severity":1,"temporary":false},
    {"label_id":73287,"username":"Mikey","cluster_id":11,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":9868,"sv_image_y":-572,"sv_canvas_x":399,"sv_canvas_y":212,"heading":260.75,"pitch":-20.75,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.07020568847656,"description":null,"severity":1,"temporary":false},
    {"label_id":73270,"username":"Steven","cluster_id":11,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":9898,"sv_image_y":-571,"sv_canvas_x":255,"sv_canvas_y":228,"heading":284.5625,"pitch":-18.875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.0702133178711,"description":null,"severity":1,"temporary":false},
    {"label_id":73251,"username":"Ryan","cluster_id":12,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":4282,"sv_image_y":-884,"sv_canvas_x":482,"sv_canvas_y":103,"heading":105.47321319580078,"pitch":-35.0,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95963668823242,"lng":-77.07002258300781,"description":null,"severity":1,"temporary":false},
    {"label_id":73250,"username":"Mikey","cluster_id":12,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":3502,"sv_image_y":-805,"sv_canvas_x":544,"sv_canvas_y":119,"heading":79.84821319580078,"pitch":-32.61606979370117,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.07000732421875,"description":null,"severity":1,"temporary":false},
    {"label_id":73290,"username":"Steven","cluster_id":12,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":3487,"sv_image_y":-802,"sv_canvas_x":269,"sv_canvas_y":211,"heading":109.625,"pitch":-27.125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.07000732421875,"description":null,"severity":1,"temporary":false},
    {"label_id":73271,"username":"Ryan","cluster_id":12,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":3540,"sv_image_y":-819,"sv_canvas_x":451,"sv_canvas_y":214,"heading":80.375,"pitch":-27.3125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959651947021484,"lng":-77.07000732421875,"description":null,"severity":1,"temporary":false},
    {"label_id":73289,"username":"Mikey","cluster_id":12,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":4270,"sv_image_y":-853,"sv_canvas_x":395,"sv_canvas_y":216,"heading":109.625,"pitch":-27.125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959632873535156,"lng":-77.07002258300781,"description":null,"severity":1,"temporary":false},
    {"label_id":73264,"username":"Steven","cluster_id":12,"pano_id":"DzLYGtZS81sv0TFPrXYEJw","label_type":"CurbRamp","sv_image_x":901,"sv_image_y":-766,"sv_canvas_x":529,"sv_canvas_y":221,"heading":357.6875,"pitch":-26.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959617614746094,"lng":-77.07002258300781,"description":null,"severity":1,"temporary":false},
    {"label_id":73244,"username":"Ryan","cluster_id":10,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":4527,"sv_image_y":-454,"sv_canvas_x":434,"sv_canvas_y":143,"heading":116.14286041259766,"pitch":-20.109375,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959007263183594,"lng":-77.0699462890625,"description":null,"severity":1,"temporary":false},
    {"label_id":73279,"username":"Mikey","cluster_id":10,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":4514,"sv_image_y":-448,"sv_canvas_x":454,"sv_canvas_y":160,"heading":107.75,"pitch":-25.375,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959007263183594,"lng":-77.0699462890625,"description":null,"severity":1,"temporary":false},
    {"label_id":73261,"username":"Steven","cluster_id":10,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":4496,"sv_image_y":-450,"sv_canvas_x":179,"sv_canvas_y":112,"heading":147.6875,"pitch":-33.3125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95901107788086,"lng":-77.0699462890625,"description":null,"severity":1,"temporary":false},
    {"label_id":73265,"username":"Ryan","cluster_id":2,"pano_id":"DzLYGtZS81sv0TFPrXYEJw","label_type":"CurbRamp","sv_image_x":11721,"sv_image_y":-556,"sv_canvas_x":185,"sv_canvas_y":181,"heading":343.8125,"pitch":-26.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95962905883789,"lng":-77.07014465332031,"description":null,"severity":1,"temporary":false},
    {"label_id":73252,"username":"Mikey","cluster_id":2,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":8782,"sv_image_y":-956,"sv_canvas_x":242,"sv_canvas_y":191,"heading":257.4910583496094,"pitch":-35.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959632873535156,"lng":-77.07014465332031,"description":null,"severity":1,"temporary":false},
    {"label_id":73288,"username":"Steven","cluster_id":2,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":8699,"sv_image_y":-912,"sv_canvas_x":207,"sv_canvas_y":284,"heading":260.75,"pitch":-20.75,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95962905883789,"lng":-77.07014465332031,"description":null,"severity":1,"temporary":false},
    {"label_id":73243,"username":"Ryan","cluster_id":13,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":3078,"sv_image_y":-524,"sv_canvas_x":453,"sv_canvas_y":169,"heading":79.78348541259766,"pitch":-17.910715103149414,"zoom":3,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95907974243164,"lng":-77.06995391845703,"description":null,"severity":1,"temporary":false},
    {"label_id":73260,"username":"Mikey","cluster_id":13,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":3088,"sv_image_y":-572,"sv_canvas_x":555,"sv_canvas_y":167,"heading":54.6875,"pitch":-29.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95907974243164,"lng":-77.06996154785156,"description":null,"severity":1,"temporary":false},
    {"label_id":73278,"username":"Steven","cluster_id":13,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":3073,"sv_image_y":-519,"sv_canvas_x":370,"sv_canvas_y":183,"heading":81.875,"pitch":-23.875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95907974243164,"lng":-77.0699462890625,"description":null,"severity":1,"temporary":false},
    {"label_id":73267,"username":"Steven","cluster_id":5,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":11371,"sv_image_y":-402,"sv_canvas_x":89,"sv_canvas_y":160,"heading":344.0,"pitch":-26.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95974349975586,"lng":-77.07022094726562,"description":null,"severity":1,"temporary":false},
    {"label_id":73266,"username":"Mikey","cluster_id":5,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":11813,"sv_image_y":-429,"sv_canvas_x":191,"sv_canvas_y":155,"heading":344.0,"pitch":-26.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959754943847656,"lng":-77.0701904296875,"description":null,"severity":1,"temporary":false},
    {"label_id":73285,"username":"Ryan","cluster_id":5,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":11747,"sv_image_y":-422,"sv_canvas_x":355,"sv_canvas_y":179,"heading":318.875,"pitch":-21.6875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959754943847656,"lng":-77.07019805908203,"description":null,"severity":1,"temporary":false},
    {"label_id":73286,"username":"Steven","cluster_id":5,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":11313,"sv_image_y":-412,"sv_canvas_x":280,"sv_canvas_y":179,"heading":318.875,"pitch":-21.6875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959739685058594,"lng":-77.07022857666016,"description":null,"severity":1,"temporary":false},
    {"label_id":73291,"username":"Ryan","cluster_id":8,"pano_id":"2ERk_Lrj9z9q740PESLAQQ","label_type":"SurfaceProblem","sv_image_x":5797,"sv_image_y":-903,"sv_canvas_x":450,"sv_canvas_y":197,"heading":141.125,"pitch":-32.9375,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95964050292969,"lng":-77.06929779052734,"description":null,"severity":2,"temporary":false},
    {"label_id":73272,"username":"Mikey","cluster_id":8,"pano_id":"2ERk_Lrj9z9q740PESLAQQ","label_type":"SurfaceProblem","sv_image_x":5813,"sv_image_y":-902,"sv_canvas_x":417,"sv_canvas_y":181,"heading":147.875,"pitch":-34.625,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95964050292969,"lng":-77.06929779052734,"description":null,"severity":3,"temporary":false},
    {"label_id":73255,"username":"Steven","cluster_id":8,"pano_id":"2ERk_Lrj9z9q740PESLAQQ","label_type":"SurfaceProblem","sv_image_x":5760,"sv_image_y":-896,"sv_canvas_x":552,"sv_canvas_y":166,"heading":139.92857360839844,"pitch":-31.625,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95964050292969,"lng":-77.06929779052734,"description":null,"severity":4,"temporary":false},
    {"label_id":73292,"username":"Ryan","cluster_id":6,"pano_id":"6eKYbults526suETEEj54Q","label_type":"SurfaceProblem","sv_image_x":6656,"sv_image_y":-858,"sv_canvas_x":613,"sv_canvas_y":213,"heading":141.125,"pitch":-33.125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95963668823242,"lng":-77.06857299804688,"description":null,"severity":3,"temporary":false},
    {"label_id":73274,"username":"Steven","cluster_id":6,"pano_id":"6eKYbults526suETEEj54Q","label_type":"SurfaceProblem","sv_image_x":6669,"sv_image_y":-849,"sv_canvas_x":526,"sv_canvas_y":211,"heading":153.5,"pitch":-30.5,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959632873535156,"lng":-77.06857299804688,"description":null,"severity":3,"temporary":false},
    {"label_id":73262,"username":"Ryan","cluster_id":4,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":7043,"sv_image_y":-610,"sv_canvas_x":678,"sv_canvas_y":170,"heading":147.6875,"pitch":-33.3125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.958980560302734,"lng":-77.0700912475586,"description":null,"severity":1,"temporary":false},
    {"label_id":73245,"username":"Ryan","cluster_id":4,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":7077,"sv_image_y":-602,"sv_canvas_x":445,"sv_canvas_y":118,"heading":184.17857360839844,"pitch":-26.180803298950195,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.958984375,"lng":-77.07009887695312,"description":null,"severity":1,"temporary":false},
    {"label_id":73280,"username":"Steven","cluster_id":4,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":7038,"sv_image_y":-584,"sv_canvas_x":314,"sv_canvas_y":122,"heading":197.9375,"pitch":-34.5625,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95897674560547,"lng":-77.07009887695312,"description":null,"severity":1,"temporary":false},
    {"label_id":73281,"username":"Ryan","cluster_id":1,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":11018,"sv_image_y":-1192,"sv_canvas_x":651,"sv_canvas_y":291,"heading":250.25,"pitch":-35.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95909118652344,"lng":-77.07012176513672,"description":null,"severity":1,"temporary":false},
    {"label_id":73259,"username":"Mikey","cluster_id":1,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":10977,"sv_image_y":-1197,"sv_canvas_x":121,"sv_canvas_y":271,"heading":337.625,"pitch":-35.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95908737182617,"lng":-77.07011413574219,"description":null,"severity":1,"temporary":false},
    {"label_id":73246,"username":"Steven","cluster_id":1,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":11020,"sv_image_y":-1191,"sv_canvas_x":495,"sv_canvas_y":213,"heading":285.0714416503906,"pitch":-35.0,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95909118652344,"lng":-77.07012176513672,"description":null,"severity":1,"temporary":false},
    {"label_id":73276,"username":"Ryan","cluster_id":3,"pano_id":"SDYdT4bmhG8e4g1SwBxehg","label_type":"CurbRamp","sv_image_x":4523,"sv_image_y":-596,"sv_canvas_x":542,"sv_canvas_y":209,"heading":94.8125,"pitch":-23.9375,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.06803894042969,"description":null,"severity":1,"temporary":false},
    {"label_id":73257,"username":"Mikey","cluster_id":3,"pano_id":"SDYdT4bmhG8e4g1SwBxehg","label_type":"CurbRamp","sv_image_x":4472,"sv_image_y":-598,"sv_canvas_x":585,"sv_canvas_y":143,"heading":88.74107360839844,"pitch":-34.8125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959659576416016,"lng":-77.06804656982422,"description":null,"severity":1,"temporary":false},
    {"label_id":73294,"username":"Steven","cluster_id":3,"pano_id":"SDYdT4bmhG8e4g1SwBxehg","label_type":"CurbRamp","sv_image_x":4500,"sv_image_y":-621,"sv_canvas_x":510,"sv_canvas_y":171,"heading":98.5625,"pitch":-29.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.06804656982422,"description":null,"severity":1,"temporary":false},
    {"label_id":73249,"username":"Ryan","cluster_id":9,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":1235,"sv_image_y":-637,"sv_canvas_x":582,"sv_canvas_y":203,"heading":15.205357551574707,"pitch":-21.8125,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.9597282409668,"lng":-77.07003021240234,"description":null,"severity":1,"temporary":false},
    {"label_id":73284,"username":"Mikey","cluster_id":9,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":485,"sv_image_y":-631,"sv_canvas_x":477,"sv_canvas_y":189,"heading":354.5,"pitch":-26.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959739685058594,"lng":-77.070068359375,"description":null,"severity":1,"temporary":false},
    {"label_id":73268,"username":"Steven","cluster_id":9,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":461,"sv_image_y":-627,"sv_canvas_x":543,"sv_canvas_y":196,"heading":344.0,"pitch":-26.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959739685058594,"lng":-77.070068359375,"description":null,"severity":1,"temporary":false},
    {"label_id":73283,"username":"Ryan","cluster_id":9,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":1169,"sv_image_y":-681,"sv_canvas_x":613,"sv_canvas_y":219,"heading":354.5,"pitch":-26.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95972442626953,"lng":-77.07003784179688,"description":null,"severity":1,"temporary":false},
    {"label_id":73248,"username":"Mikey","cluster_id":9,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":489,"sv_image_y":-619,"sv_canvas_x":454,"sv_canvas_y":201,"heading":5.205357074737549,"pitch":-20.383928298950195,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95974349975586,"lng":-77.07006072998047,"description":null,"severity":1,"temporary":false},
    {"label_id":73269,"username":"Steven","cluster_id":9,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":1160,"sv_image_y":-681,"sv_canvas_x":707,"sv_canvas_y":240,"heading":344.0,"pitch":-26.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95972442626953,"lng":-77.07003784179688,"description":null,"severity":1,"temporary":false},
    {"label_id":73293,"username":"Ryan","cluster_id":7,"pano_id":"YNmEhIe_uUD-XFdPFxoRVg","label_type":"CurbRamp","sv_image_x":1870,"sv_image_y":-972,"sv_canvas_x":35,"sv_canvas_y":287,"heading":98.5625,"pitch":-29.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95973205566406,"lng":-77.06816864013672,"description":null,"severity":1,"temporary":false},
    {"label_id":73275,"username":"Mikey","cluster_id":7,"pano_id":"YNmEhIe_uUD-XFdPFxoRVg","label_type":"CurbRamp","sv_image_x":1802,"sv_image_y":-944,"sv_canvas_x":85,"sv_canvas_y":295,"heading":90.3125,"pitch":-24.5,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95973205566406,"lng":-77.06816864013672,"description":null,"severity":3,"temporary":false},
    {"label_id":73256,"username":"Steven","cluster_id":7,"pano_id":"SDYdT4bmhG8e4g1SwBxehg","label_type":"CurbRamp","sv_image_x":12670,"sv_image_y":-1263,"sv_canvas_x":287,"sv_canvas_y":246,"heading":356.1160583496094,"pitch":-34.8125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959739685058594,"lng":-77.06815338134766,"description":null,"severity":1,"temporary":false}
    ];




    initialize();
});
