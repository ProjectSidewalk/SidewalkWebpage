$(document).ready(function () {

  $(function () {
    $('[data-toggle="popover"]').popover()
  })

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
    mapLabels = [];

    //stores the next open view to display a label on
    var nextOpenView = 0;

    var toInvestigate = [];
    var maxZIndex = 200;

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
        for (j = 0; j < toInvestigate.length; j++) {
          var lbl = toInvestigate[j].label;
          features.push({position: new google.maps.LatLng(lbl.lat, lbl.lng), type: lbl.label_type, meta: lbl, status: "Filter"});
        }


            // Create markers.
            features.forEach(function(feature) {
              var z = 100;
              color = "#000000";
              opacity = 0.8;
              weight = 0.5;
              fillOpacity = 0.5;
              if(feature.status === "Ground_Truth"){
                color = "#ada511";
                opacity = 1;
                weight = 4;
                fillOpacity = 0.8;
                z = 200;
              }else if(feature.status === "No_Ground_Truth"){
                color = "#757470";
                opacity = 0.5;
                weight = 4;
                fillOpacity = 0.2;
                z = 50;
              }
              var marker = new google.maps.Circle({
                  id: "marker" + feature.meta.label_id,
                  meta: feature.meta,
                  status: feature.status,
                  center: new google.maps.LatLng(feature.meta.lat,feature.meta.lng),
                  radius:0.8,
                  clickabe: true,
                  strokeColor: color,
                  strokeOpacity: opacity,
                  strokeWeight: weight,
                  fillColor: "#" + colorMapping[feature.meta.label_type].fillStyle,
                  fillOpacity: fillOpacity,
                  zIndex: z,
                  label: null
                });
                var labeling = new google.maps.Marker({
                  map: map,
                  id: feature.meta.label_id,
                  position: new google.maps.LatLng(feature.meta.lat, feature.meta.lng),
                  draggable: false,
                  label: {
                    text: "",
                    fontWeight: 'bold',
                    fontSize: '12px'},
                  icon: {
                    url: "",
                    labelOrigin: new google.maps.Point(3,5),
                    size: new google.maps.Size(5, 5)
                  },
                  opacity: 1,
                  crossOnDrag: false,
                  visible: true,
                  zIndex: z,
                  visible: false
                });
                marker.bindTo('center', labeling, 'position');
                marker.addListener('click', function() {
                  //test whether the label is already being shown in one of the four views
                  var id = marker.meta.label_id;
                  var labelIndex = -1;
                  for(i = 0; i < panoramaContainers.length; i++){
                    if(panoramaContainers[i].cluster_id === marker.meta.cluster_id && panoramaContainers[i].pano_id === marker.meta.cluster_id){
                      labelIndex = panoramaContainers[i].findIndex(lbl => lbl.label_id === id );
                    }
                  }
                  // If it's being shown, clear the canvas it's being shown in, o/w display the label and log that it is shown
                  if (labelIndex >= 0) {
                      $('#clear' + (labelIndex + 1)).trigger('click');
                      if(marker.status === null){marker.setOptions({fillColor: "#" + colorMapping[marker.meta.label_type].fillStyle});}
                      var mLabel = mapLabels.find(lbl => lbl.id === marker.meta.label_id );
                      mLabel.setOptions({visible: false});
                  } else {
                      $('#clear' + (nextOpenView + 1)).trigger('click');
                      panoramaContainers[nextOpenView].label.label_id = id;
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
                  marker.setOptions({fillColor: '#ff38fb'});
                });

                marker.addListener('mouseout', function(){
                  //test whether label is present within a view
                  var present = panoramaContainers.some(panoramaContainer => panoramaContainer.label.label_id === marker.meta.label_id);
                  // if present, hide border highlight, o/w remove emphasis
                  //if not, remove emphasis
                  if (present) {
                      var pano = panoramaContainers.find(panoramaContainer => panoramaContainer.label.label_id === marker.meta.label_id );
                      pano.view.style.borderStyle = "hidden";
                  }
                    marker.setOptions({fillColor: "#" + colorMapping[marker.meta.label_type].fillStyle});
                });

                marker.setMap(map);
                mapMarkers.push(marker);
                mapLabels.push(labeling);
            });
    }



    //set the GSV panoramas
    function initializePanoramas(label, panosToUpdate) {
          for (var i = 0; i < panosToUpdate.length; i++) {
              //update all indicated panoramas
              panoramaContainers[i].gsv_panorama = new google.maps.StreetViewPanorama(panosToUpdate[i], {
                  pano: label.pano_id,
                  zoom: label.zoom,
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
            if (panoramaContainers[i].labels.length === 0) {
                return i;
            }
        }
        return 0;
    }

    var initializedToggleButtons = [];

    //show label in panorama
    function showLabel(label, panoIndex, status) {
            $('#pano' + (panoIndex + 1) + '-holder').children('div.loading').fadeOut('slow', function () {
                $(this).remove();
            });
            panoramaContainers[panoIndex].cluster_id = label.cluster_id;
            panoramaContainers[panoIndex].pano_id = label.pano_id;
            //update info
            if(panoramaContainers[panoIndex].info.innerHTML === "Empty"){
              if(status != "Filter"){
                panoramaContainers[panoIndex].info.innerHTML = "<b>Cluster ID: </b> " + label.cluster_id + " | <b>Labels Shown: </b> " + panoramaContainers[panoIndex].labels.length + ' | <b>Toggle Visible: </b><a href="javascript:;" id="toggle-visible-' + label.pano_id + label.cluster_id + '"><span class="glyphicon glyphicon-eye-open" style="color:#000000; font-size:14px"></span></a>';
              }
              else{panoramaContainers[panoIndex].info.innerHTML = "<b>Cluster ID: </b>" + label.cluster_id + ' | <b>Toggle Visible: </b><a href="javascript:;" id="toggle-visible-' + label.pano_id + label.cluster_id + '"><span class="glyphicon glyphicon-eye-open" style="color:#000000; font-size:14px"></span></a>';}

            $('#toggle-visible-' + label.pano_id  +  label.cluster_id).off("click");
            //Toggle visibility of label marker
            $(document).on("click", '#toggle-visible-' + label.pano_id  +  label.cluster_id, function(){
                if (panoramaContainers[panoIndex].labelMarkers[0].getIcon() === null) {
                  for(var i = 0; i < panoramaContainers[panoIndex].labelMarkers.length; i++){
                    var marker = mapMarkers.find(mkr => mkr.meta.label_id === panoramaContainers[panoIndex].labels[i].label_id );
                    if(marker !=  null){panoramaContainers[panoIndex].labelMarkers[i].setIcon(selectMarker(panoramaContainers[panoIndex].labels[i],marker.status));}
                    else{panoramaContainers[panoIndex].labelMarkers[i].setIcon(selectMarker(panoramaContainers[panoIndex].labels[i],null));}
                  }
                } else {
                  for(var i = 0; i < panoramaContainers[panoIndex].labelMarkers.length; i++){
                    panoramaContainers[panoIndex].labelMarkers[i].setIcon(null);
                  }
                }
          });
          }

            //add marker label
            nextOpenView = calculateNextOpen();
            //draw label
            var pov = renderLabel(label, panoIndex, status);
            var markerLabel = mapLabels.find(mkr => mkr.id === label.label_id );
              markerLabel.setOptions({visible: true, label: {
                text: "V"+(panoIndex+1),
                fontWeight: 'bold',
                fontSize: '12px'}});
            //update selected panorama
            var toChange = panoramaContainers[panoIndex].gsv_panorama;
            toChange.setPano(label.pano_id);
            toChange.setPov(pov);
            toChange.setZoom(10);
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
        var icon, size;
        if(status === null){
          size = new google.maps.Size(30, 30);
        }else{
          size = new google.maps.Size(36, 36);
        }
        var label_marker = new PanoMarker({
            pano: panoramaContainers[panoIndex].gsv_panorama,
            container: panoramaContainers[panoIndex].view,
            position: {heading: labelPosition.heading, pitch: labelPosition.pitch},
            icon: selectMarker(label, status),
            id: id,
            size: size,
            optimized: false
        });
        panoramaContainers[panoIndex].labelMarkers.push(label_marker);
        var markerIndex = panoramaContainers[panoIndex].labelMarkers.length - 1;

        // Add listener to marker to show info upon clicking
        google.maps.event.addListener(panoramaContainers[panoIndex].labelMarkers[markerIndex], 'click', function () {
            maxZIndex++;
            panoramaContainers[panoIndex].labelMarkers[markerIndex].setOptions({zIndex: maxZIndex});
            for(var i = 0; i<panoramaContainers[panoIndex].labelMarkers.length; i++){
              if(i != markerIndex){$('#' + panoramaContainers[panoIndex].labelMarkers[i].getId()).popover('hide');}
            }
            createPopover(panoIndex, label,status);
        });

        // Popover follows marker when POV is changed
        google.maps.event.addListener(panoramaContainers[panoIndex].gsv_panorama, 'pov_changed', function () {
                createPopover(panoIndex, label,status);
                $("#" + id).popover('hide');
         });

         for(var i = 0; i < panoramaContainers[panoIndex].labelMarkers.length; i++){
           if(i != markerIndex){
           google.maps.event.addListener(panoramaContainers[panoIndex].labelMarkers[i], 'click', function () {
                   createPopover(panoIndex, label,status);
                   $("#" + id).popover('hide');
            });
          }
         }

        return {heading: labelPosition.heading, pitch: labelPosition.pitch};
    }


    // Create popover for marker
    function createPopover(index, data, status) {
      if(status === "Filter"){return;}
        var labelIndex = panoramaContainers[index].labels.findIndex(lbl => lbl.label_id === data.label_id );
        var markerElement = $("#label-id-" + data.label_id);

            markerElement
                .attr('data-toggle', 'popover')
                .attr('data-placement', 'top')
                .attr('data-content',
                    '<p style="text-align:center"><b>Cluster:</b>&nbsp;' + data.cluster_id + ' <b>Labeler:</b>&nbsp;' + data.turker_id + '<br><b>Severity:</b>&nbsp;' + data.severity + ', <b>Temporary:</b>&nbsp;' + data.temporary + '<br><b>Description:</b>&nbsp;' + data.description
                    + '</p>' +
                    'Ground Truth: <input type="button" id="commit' + data.label_id + '" style="margin-top:1" value="Yes"></input>' +
                    '<input type="button" id="noCommit' + data.label_id + '" style="margin-top:1" value="No"></input>') // 9eba9e
                    .popover({html: true});


            $(document).on("click", '.popover #commit' + data.label_id , function(){
                $("#label-id-" + data.label_id).popover('hide');
                yesGroundTruth(panoramaContainers[index].labels[labelIndex]);
            });
            $(document).on("click", '.popover #noCommit' + data.label_id , function(){
                $("#label-id-" + data.label_id).popover('hide');
                noGroundTruth(panoramaContainers[index].labels[labelIndex]);
            });

        }


    function selectMarker(label, status){
      if(status === "Ground_Truth" || status === "Filter"){
        return "assets/javascripts/SVLabel/img/ground_truth/gt_commit_" + label.label_type + ".png";
      }else if(status === "No_Ground_Truth"){
        return "assets/javascripts/SVLabel/img/ground_truth/gt_exclude_" + label.label_type + ".png";
      }else{
        return "assets/javascripts/SVLabel/img/cursors/Cursor_" + label.label_type + ".png";
      }
    }

    function updateCounters(){
      document.getElementById("gtCounter").innerHTML = "DESIGNATED GROUND TRUTH: " + ground_truth_labels.length;
      document.getElementById("notGtCounter").innerHTML = "DESIGNATED NOT GROUND TRUTH: " + eliminated_labels.length;
      var remaining = 0;
      for(var clusterId in all_labels){
        remaining += all_labels[clusterId].length;
      }
      document.getElementById("remainingCounter").innerHTML = "REMAINING LABELS: " + remaining;
    }

    //this label will go in ground truth
    function yesGroundTruth(commit){
          //update visuals
          var labelIndex = -1, pano = -1;
          for(i = 0; i < panoramaContainers.length; i++){
            if(panoramaContainers[i].cluster_id === commit.cluster_id && panoramaContainers[i].pano_id === commit.pano_id){
              labelIndex = panoramaContainers[i].labels.findIndex(lbl => lbl.label_id === commit.label_id );
              pano = i;
              break;
            }
          }
          panoramaContainers[pano].labelMarkers[labelIndex].setIcon("assets/javascripts/SVLabel/img/ground_truth/gt_commit_" + commit.label_type + ".png");
          panoramaContainers[pano].labelMarkers[labelIndex].setOptions({size: new google.maps.Size(36,36)});
          for(j = 0; j < panoramaContainers[pano].labelMarkers.length; j++){
            if(j != labelIndex){maxZIndex++; panoramaContainers[pano].labelMarkers[j].setOptions({zIndex: maxZIndex});}
          }
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
          updateCounters();
          marker.setOptions({strokeColor:"#ada511",strokeOpacity:1, fillOpacity: 0.8, strokeWeight:4, status: "Ground_Truth", zIndex: 200});
    }

    //this label will not go in ground truth
    function noGroundTruth(commit){
      //update visuals
      var labelIndex = -1, pano = -1;
      for(i = 0; i < panoramaContainers.length; i++){
        if(panoramaContainers[i].cluster_id === commit.cluster_id && panoramaContainers[i].pano_id === commit.pano_id){
          labelIndex = panoramaContainers[i].labels.findIndex(lbl => lbl.label_id === commit.label_id );
          pano = i;
          break;
        }
      }
      if(pano >= 0){
        panoramaContainers[pano].labelMarkers[labelIndex].setIcon("assets/javascripts/SVLabel/img/ground_truth/gt_exclude_" + commit.label_type + ".png");
        panoramaContainers[pano].labelMarkers[labelIndex].setOptions({size: new google.maps.Size(36,36), zIndex: 10});}
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
      updateCounters();
      marker.setOptions({strokeColor:"#757470", strokeOpacity:0.5, strokeWeight:4, status: "No_Ground_Truth", zIndex: 50, fillOpacity:0.2, size: new google.maps.Size(36,36)});
    }

    //clear a specific canvas
    function clearCanvas(index) {
        var panoramaContainer = panoramaContainers[index];
        for(i = 0; i < panoramaContainer.labelMarkers.length; i++) {
            var markerLabel = panoramaContainer.labelMarkers[i];
            $('#' + markerLabel.getId()).popover('hide');

            var labelId = panoramaContainer.labels[i].label_id;

            var marker = mapMarkers.find(mkr => mkr.meta.label_id === labelId );
            if(marker != null && marker.status === null){marker.setOptions({fillColor: "#" + colorMapping[marker.meta.label_type].fillStyle});}
            var mLabel = mapLabels.find(mkr => mkr.id === labelId );
            if(mLabel != null){mLabel.setOptions({visible: false});}

            markerLabel.setMap(null);

        }

        panoramaContainer.info.innerHTML = "Empty";
        panoramaContainer.view.style.borderStyle = "hidden";
        panoramaContainer.labels = [];
        nextOpenView = calculateNextOpen();
        google.maps.event.clearListeners(panoramaContainers[index].gsv_panorama, 'pov_changed');
        panoramaContainer.labelMarkers = [];
    }


    //add all labels in cluster to panoramas
    function addClusterToPanos(cluster){
      for(var p = 0; p < 4; p++){
        clearCanvas(p);
      }
      for(var i = 0; i < cluster.length; i++){
        var toShow = cluster[i];
        //test whether the label is already being shown in one of the four views
        var id = toShow.label_id;
        var marker = mapMarkers.find(mkr => mkr.meta.label_id === id );
        var panoIndex = -1;
        for(var j = 0; j < panoramaContainers.length; j++){
          if(panoramaContainers[j].cluster_id === marker.meta.cluster_id && panoramaContainers[j].pano_id === marker.meta.pano_id){
            panoIndex = j;
          }
        }
        // If it's being shown, clear the canvas it's being shown in, o/w display the label and log that it is shown
        if (panoIndex >= 0) {
            panoramaContainers[panoIndex].labels.push(marker.meta);
            showLabel(marker.meta, panoIndex, marker.status);
            if(marker.status === null){marker.setOptions({fillColor: "#" + colorMapping[marker.meta.label_type].fillStyle});}
            var mLabel = mapLabels.find(lbl => lbl.id === marker.meta.label_id );
        } else {
            $('#clear' + (nextOpenView + 1)).trigger('click');
            panoramaContainers[nextOpenView].labels.push(marker.meta);
            showLabel(marker.meta, nextOpenView, marker.status);
          }
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
        addClusterToPanos(all_labels[currentCluster]);
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
        addClusterToPanos(all_labels[currentCluster]);
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
          maxZoom : 21,
          minZoom : 21,
          overviewMapControl:false,
          panControl:true,
          rotateControl:false,
          scaleControl:false,
          streetViewControl:false,
          zoomControl:false,
          zoom: 21
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
                labels: [], // metadata of label displayed in each panorama ({} if no label is displayed)
                labelMarkers: [], // the marker for the label in the panorama
                cluster_id: null,
                pano_id: null
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
            clearCanvas(0);
        };
        document.getElementById("clear2").onclick = function () {
            clearCanvas(1);
        };
        document.getElementById("clear3").onclick = function () {
            clearCanvas(2);
        };
        document.getElementById("clear4").onclick = function () {
            clearCanvas(3);
        };
        document.getElementById("submitClusterSessionId").onclick = function () {
            cluster_session_id = document.getElementById("clusterSessionId").value;
            var test_labels = gtTestData; //eventually, query will run here
            all_labels = filterClusters(test_labels);
            updateCounters();
            document.getElementById("round").innerHTML = "Ground Truth Resolution Tool - Low Disagreement Round";
            initializeAllLayers(all_labels, self, map);
            dealWithConflict(toInvestigate, 0);
        };

        //reduce filler at bottom of page (styling purposes)
        document.getElementById("filler").style.minHeight = "5px";
    }


    function filterClusters(data){
      data = _.groupBy(data, "cluster_id");
      //iterate through and filter out clusters that are agreed upon
      for (var clusterId in data) {
        var cluster_data = data[clusterId];
        //if there are 3 labels in the cluster, keep looking
        if(cluster_data.length === 3){
          //check if all labelers are different
          if(!((cluster_data[0].turker_id === cluster_data[1].turker_id) || (cluster_data[0].turker_id === cluster_data[2].turker_id) || (cluster_data[1].turker_id === cluster_data[2].turker_id))){
            //check if severities are all the same
            var sameSeverity = (cluster_data[0].severity === cluster_data[1].severity && cluster_data[0].severity === cluster_data[2].severity);
            var sameTemp = (cluster_data[0].temporary === cluster_data[1].temporary && cluster_data[0].temporary === cluster_data[2].temporary);
            if(sameSeverity && sameTemp){
              //calculate middle label
              middle = chooseMiddle(cluster_data);
              //add middle label to ground_truth labels, other two to eliminated_labels
              //map markers' style and status will update accordingly
              ground_truth_labels.push(cluster_data[middle]);
              cluster_data.splice(middle,1);
              for(var i = 0; i < cluster_data.length; i){
                eliminated_labels.push(cluster_data[i]);
                cluster_data.splice(i,1);
              }
            }else{
              middle = chooseMiddle(cluster_data);
              var label = cluster_data[middle];
              var cluster = cluster_data.slice();
              toInvestigate.push({data: cluster, label: label, sev: sameSeverity, temp: sameTemp});
              ground_truth_labels.push(cluster_data[middle]);
              cluster_data.splice(middle,1);
              for(var i = 0; i < cluster_data.length; i){
                eliminated_labels.push(cluster_data[i]);
                cluster_data.splice(i,1);
              }
            }
          }
        }
      }
      return data;
    }

    function dealWithConflict(data, index){
          var label_data = data[index].label;
          var cluster_data = data[index].data;
            //set coordinates
            currentCoordinates = new google.maps.LatLng(label_data.lat, label_data.lng);
            map.setCenter(currentCoordinates);
            //show on panorama
                panoramaContainers[0].gsv_panorama = new google.maps.StreetViewPanorama(document.getElementById("panorama-1"), {
                    pano: label_data.pano_id,
                    pov: {
                        heading: label_data.heading,
                        pitch: label_data.pitch
                    },
                    disableDefaultUI: true,
                    clickToGo: false
                });

                  clearCanvas(0);
            showLabel(label_data,0,"Filter");
            panoramaContainers[0].labels.push(label_data);
            document.getElementById("panorama-3").innerHTML = '<br><table style="width:100%"><tr><th>Labeler</th><th id="sev_heading" style="text-align:center">Severity</th><th id="temp_heading" style="text-align:center">Temp</th><th style="text-align:center">Description</th></tr>' +
            '<tr><td>' + cluster_data[0].turker_id + '</td><td style="text-align:center">' + cluster_data[0].severity + '</td><td style="text-align:center">' + cluster_data[0].temporary + '</td>'+ '</td><td style="text-align:center">' + cluster_data[0].description +
            '<tr><td>' + cluster_data[1].turker_id + '</td><td style="text-align:center">' + cluster_data[1].severity + '</td><td style="text-align:center">' + cluster_data[1].temporary + '</td>'+ '</td><td style="text-align:center">' + cluster_data[1].description +
            '<tr><td>' + cluster_data[2].turker_id + '</td><td style="text-align:center">' + cluster_data[2].severity + '</td><td style="text-align:center">' + cluster_data[2].temporary + '</td>'+ '</td><td style="text-align:center">' + cluster_data[2].description + '</table><br>' +
            'Severity: <select name="severity" id="severity"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select><br>' +
            'Temporary: <input type="checkbox" id ="temp"><br>' +
            '<button style="margin-top:4px" id="prelimCommit' + label_data.cluster_id + '">Submit Updates to Ground Truth</button>';
            //update label found in ground truth
            var toUpdate = ground_truth_labels.find(lbl => lbl.label_id === cluster_data[middle].label_id);
            var next = index + 1;

            if(!data[index].sev){
              document.getElementById("sev_heading").style.backgroundColor = "#ff6d77";
            }
            if(!data[index].temp){
              document.getElementById("temp_heading").style.backgroundColor = "#ff6d77";
            }

            $(document).on("click", '#prelimCommit' + toUpdate.cluster_id , function(){
                //update severity and temporary
                toUpdate.severity = document.getElementById("severity").value;
                toUpdate.temporary = document.getElementById("temp").checked;
                updateCounters();
                //move to next one
                if(next < data.length){
                  dealWithConflict(data,next);
                } else{
                  //finished with preliminary commits
                  clusterCount = Object.keys(all_labels).length;
                  //intiailize mapbox layers and GSV panoramas
                  currentCluster = 1;
                  while(all_labels[currentCluster].length <= 0){currentCluster++;}
                  currentLabel = all_labels[currentCluster][0];
                  currentCoordinates = new google.maps.LatLng(currentLabel.lat, currentLabel.lng);
                  map.setCenter(currentCoordinates);
                  var panoramas = panoramaContainers.map(panoramaContainer => panoramaContainer.view );
                  clearCanvas(0, self.allLayers);
                  initializePanoramas(currentLabel, panoramas);
                  addClusterToPanos(all_labels[currentCluster]);
                  document.getElementById("round").innerHTML = "Ground Truth Resolution Tool - High Disagreement Round";
              }
            });
    }


    function chooseMiddle(points){
      var avg_lat = (points[0].lat + points[1].lat + points[2].lat) / 3;
      var avg_lng = (points[0].lng + points[1].lng + points[2].lng) / 3;
      var min = 1000000000000;
      var mid_label;
      for(i = 0; i < points.length; i++){
        var distance = Math.sqrt( Math.pow(avg_lat-points[i].lat,2) + Math.pow(avg_lng-points[i].lng,2) );
        if(distance < min){
          min = distance;
          mid_label = i;
        }
      }
      return mid_label;
    }

    //test data
    var gtTestData = [
    {"label_id":73253,"turker_id":"Ryan","cluster_id":11,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":9873,"sv_image_y":-612,"sv_canvas_x":421,"sv_canvas_y":121,"heading":257.4910583496094,"pitch":-35.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.07019805908203,"description":null,"severity":1,"temporary":false},
    {"label_id":73287,"turker_id":"Mikey","cluster_id":11,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":9868,"sv_image_y":-572,"sv_canvas_x":399,"sv_canvas_y":212,"heading":260.75,"pitch":-20.75,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.07020568847656,"description":null,"severity":1,"temporary":false},
    {"label_id":73270,"turker_id":"Steven","cluster_id":11,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":9898,"sv_image_y":-571,"sv_canvas_x":255,"sv_canvas_y":228,"heading":284.5625,"pitch":-18.875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.0702133178711,"description":null,"severity":1,"temporary":false},
    {"label_id":73251,"turker_id":"Ryan","cluster_id":12,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":4282,"sv_image_y":-884,"sv_canvas_x":482,"sv_canvas_y":103,"heading":105.47321319580078,"pitch":-35.0,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95963668823242,"lng":-77.07002258300781,"description":null,"severity":1,"temporary":false},
    {"label_id":73250,"turker_id":"Mikey","cluster_id":12,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":3502,"sv_image_y":-805,"sv_canvas_x":544,"sv_canvas_y":119,"heading":79.84821319580078,"pitch":-32.61606979370117,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.07000732421875,"description":null,"severity":1,"temporary":false},
    {"label_id":73290,"turker_id":"Steven","cluster_id":12,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":3487,"sv_image_y":-802,"sv_canvas_x":269,"sv_canvas_y":211,"heading":109.625,"pitch":-27.125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.07000732421875,"description":null,"severity":1,"temporary":false},
    {"label_id":73271,"turker_id":"Ryan","cluster_id":12,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":3540,"sv_image_y":-819,"sv_canvas_x":451,"sv_canvas_y":214,"heading":80.375,"pitch":-27.3125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959651947021484,"lng":-77.07000732421875,"description":null,"severity":1,"temporary":false},
    {"label_id":73289,"turker_id":"Mikey","cluster_id":12,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":4270,"sv_image_y":-853,"sv_canvas_x":395,"sv_canvas_y":216,"heading":109.625,"pitch":-27.125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959632873535156,"lng":-77.07002258300781,"description":null,"severity":1,"temporary":false},
    {"label_id":73264,"turker_id":"Steven","cluster_id":12,"pano_id":"DzLYGtZS81sv0TFPrXYEJw","label_type":"CurbRamp","sv_image_x":901,"sv_image_y":-766,"sv_canvas_x":529,"sv_canvas_y":221,"heading":357.6875,"pitch":-26.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959617614746094,"lng":-77.07002258300781,"description":null,"severity":1,"temporary":false},
    {"label_id":73244,"turker_id":"Ryan","cluster_id":10,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":4527,"sv_image_y":-454,"sv_canvas_x":434,"sv_canvas_y":143,"heading":116.14286041259766,"pitch":-20.109375,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959007263183594,"lng":-77.0699462890625,"description":null,"severity":1,"temporary":false},
    {"label_id":73279,"turker_id":"Mikey","cluster_id":10,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":4514,"sv_image_y":-448,"sv_canvas_x":454,"sv_canvas_y":160,"heading":107.75,"pitch":-25.375,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959007263183594,"lng":-77.0699462890625,"description":null,"severity":1,"temporary":false},
    {"label_id":73261,"turker_id":"Steven","cluster_id":10,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":4496,"sv_image_y":-450,"sv_canvas_x":179,"sv_canvas_y":112,"heading":147.6875,"pitch":-33.3125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95901107788086,"lng":-77.0699462890625,"description":null,"severity":1,"temporary":false},
    {"label_id":73265,"turker_id":"Ryan","cluster_id":2,"pano_id":"DzLYGtZS81sv0TFPrXYEJw","label_type":"CurbRamp","sv_image_x":11721,"sv_image_y":-556,"sv_canvas_x":185,"sv_canvas_y":181,"heading":343.8125,"pitch":-26.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95962905883789,"lng":-77.07014465332031,"description":null,"severity":1,"temporary":false},
    {"label_id":73252,"turker_id":"Mikey","cluster_id":2,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":8782,"sv_image_y":-956,"sv_canvas_x":242,"sv_canvas_y":191,"heading":257.4910583496094,"pitch":-35.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959632873535156,"lng":-77.07014465332031,"description":null,"severity":1,"temporary":false},
    {"label_id":73288,"turker_id":"Steven","cluster_id":2,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":8699,"sv_image_y":-912,"sv_canvas_x":207,"sv_canvas_y":284,"heading":260.75,"pitch":-20.75,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95962905883789,"lng":-77.07014465332031,"description":null,"severity":1,"temporary":false},
    {"label_id":73243,"turker_id":"Ryan","cluster_id":13,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":3078,"sv_image_y":-524,"sv_canvas_x":453,"sv_canvas_y":169,"heading":79.78348541259766,"pitch":-17.910715103149414,"zoom":3,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95907974243164,"lng":-77.06995391845703,"description":null,"severity":1,"temporary":false},
    {"label_id":73260,"turker_id":"Mikey","cluster_id":13,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":3088,"sv_image_y":-572,"sv_canvas_x":555,"sv_canvas_y":167,"heading":54.6875,"pitch":-29.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95907974243164,"lng":-77.06996154785156,"description":null,"severity":1,"temporary":false},
    {"label_id":73278,"turker_id":"Steven","cluster_id":13,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":3073,"sv_image_y":-519,"sv_canvas_x":370,"sv_canvas_y":183,"heading":81.875,"pitch":-23.875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95907974243164,"lng":-77.0699462890625,"description":null,"severity":1,"temporary":false},
    {"label_id":73267,"turker_id":"Steven","cluster_id":5,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":11371,"sv_image_y":-402,"sv_canvas_x":89,"sv_canvas_y":160,"heading":344.0,"pitch":-26.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95974349975586,"lng":-77.07022094726562,"description":null,"severity":1,"temporary":false},
    {"label_id":73266,"turker_id":"Mikey","cluster_id":5,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":11813,"sv_image_y":-429,"sv_canvas_x":191,"sv_canvas_y":155,"heading":344.0,"pitch":-26.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959754943847656,"lng":-77.0701904296875,"description":null,"severity":1,"temporary":false},
    {"label_id":73285,"turker_id":"Ryan","cluster_id":5,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":11747,"sv_image_y":-422,"sv_canvas_x":355,"sv_canvas_y":179,"heading":318.875,"pitch":-21.6875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959754943847656,"lng":-77.07019805908203,"description":null,"severity":1,"temporary":false},
    {"label_id":73286,"turker_id":"Steven","cluster_id":5,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":11313,"sv_image_y":-412,"sv_canvas_x":280,"sv_canvas_y":179,"heading":318.875,"pitch":-21.6875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959739685058594,"lng":-77.07022857666016,"description":null,"severity":1,"temporary":false},
    {"label_id":73291,"turker_id":"Ryan","cluster_id":8,"pano_id":"2ERk_Lrj9z9q740PESLAQQ","label_type":"SurfaceProblem","sv_image_x":5797,"sv_image_y":-903,"sv_canvas_x":450,"sv_canvas_y":197,"heading":141.125,"pitch":-32.9375,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95964050292969,"lng":-77.06929779052734,"description":null,"severity":2,"temporary":false},
    {"label_id":73272,"turker_id":"Mikey","cluster_id":8,"pano_id":"2ERk_Lrj9z9q740PESLAQQ","label_type":"SurfaceProblem","sv_image_x":5813,"sv_image_y":-902,"sv_canvas_x":417,"sv_canvas_y":181,"heading":147.875,"pitch":-34.625,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95964050292969,"lng":-77.06929779052734,"description":null,"severity":3,"temporary":false},
    {"label_id":73255,"turker_id":"Steven","cluster_id":8,"pano_id":"2ERk_Lrj9z9q740PESLAQQ","label_type":"SurfaceProblem","sv_image_x":5760,"sv_image_y":-896,"sv_canvas_x":552,"sv_canvas_y":166,"heading":139.92857360839844,"pitch":-31.625,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95964050292969,"lng":-77.06929779052734,"description":null,"severity":4,"temporary":false},
    {"label_id":73292,"turker_id":"Ryan","cluster_id":6,"pano_id":"6eKYbults526suETEEj54Q","label_type":"SurfaceProblem","sv_image_x":6656,"sv_image_y":-858,"sv_canvas_x":613,"sv_canvas_y":213,"heading":141.125,"pitch":-33.125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95963668823242,"lng":-77.06857299804688,"description":null,"severity":3,"temporary":false},
    {"label_id":73274,"turker_id":"Steven","cluster_id":6,"pano_id":"6eKYbults526suETEEj54Q","label_type":"SurfaceProblem","sv_image_x":6669,"sv_image_y":-849,"sv_canvas_x":526,"sv_canvas_y":211,"heading":153.5,"pitch":-30.5,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959632873535156,"lng":-77.06857299804688,"description":null,"severity":3,"temporary":false},
    {"label_id":73262,"turker_id":"Ryan","cluster_id":4,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":7043,"sv_image_y":-610,"sv_canvas_x":678,"sv_canvas_y":170,"heading":147.6875,"pitch":-33.3125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.958980560302734,"lng":-77.0700912475586,"description":null,"severity":1,"temporary":false},
    {"label_id":73245,"turker_id":"Ryan","cluster_id":4,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":7077,"sv_image_y":-602,"sv_canvas_x":445,"sv_canvas_y":118,"heading":184.17857360839844,"pitch":-26.180803298950195,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.958984375,"lng":-77.07009887695312,"description":null,"severity":1,"temporary":false},
    {"label_id":73280,"turker_id":"Steven","cluster_id":4,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":7038,"sv_image_y":-584,"sv_canvas_x":314,"sv_canvas_y":122,"heading":197.9375,"pitch":-34.5625,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95897674560547,"lng":-77.07009887695312,"description":null,"severity":1,"temporary":false},
    {"label_id":73281,"turker_id":"Ryan","cluster_id":1,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":11018,"sv_image_y":-1192,"sv_canvas_x":651,"sv_canvas_y":291,"heading":250.25,"pitch":-35.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95909118652344,"lng":-77.07012176513672,"description":null,"severity":1,"temporary":false},
    {"label_id":73259,"turker_id":"Mikey","cluster_id":1,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":10977,"sv_image_y":-1197,"sv_canvas_x":121,"sv_canvas_y":271,"heading":337.625,"pitch":-35.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95908737182617,"lng":-77.07011413574219,"description":null,"severity":1,"temporary":false},
    {"label_id":73246,"turker_id":"Steven","cluster_id":1,"pano_id":"430ykj3atJBO-QWkuR5BZQ","label_type":"CurbRamp","sv_image_x":11020,"sv_image_y":-1191,"sv_canvas_x":495,"sv_canvas_y":213,"heading":285.0714416503906,"pitch":-35.0,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95909118652344,"lng":-77.07012176513672,"description":null,"severity":1,"temporary":false},
    {"label_id":73276,"turker_id":"Ryan","cluster_id":3,"pano_id":"SDYdT4bmhG8e4g1SwBxehg","label_type":"CurbRamp","sv_image_x":4523,"sv_image_y":-596,"sv_canvas_x":542,"sv_canvas_y":209,"heading":94.8125,"pitch":-23.9375,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.06803894042969,"description":null,"severity":1,"temporary":false},
    {"label_id":73257,"turker_id":"Mikey","cluster_id":3,"pano_id":"SDYdT4bmhG8e4g1SwBxehg","label_type":"CurbRamp","sv_image_x":4472,"sv_image_y":-598,"sv_canvas_x":585,"sv_canvas_y":143,"heading":88.74107360839844,"pitch":-34.8125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959659576416016,"lng":-77.06804656982422,"description":null,"severity":1,"temporary":false},
    {"label_id":73294,"turker_id":"Steven","cluster_id":3,"pano_id":"SDYdT4bmhG8e4g1SwBxehg","label_type":"CurbRamp","sv_image_x":4500,"sv_image_y":-621,"sv_canvas_x":510,"sv_canvas_y":171,"heading":98.5625,"pitch":-29.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95965576171875,"lng":-77.06804656982422,"description":null,"severity":1,"temporary":false},
    {"label_id":73249,"turker_id":"Ryan","cluster_id":9,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":1235,"sv_image_y":-637,"sv_canvas_x":582,"sv_canvas_y":203,"heading":15.205357551574707,"pitch":-21.8125,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.9597282409668,"lng":-77.07003021240234,"description":null,"severity":1,"temporary":false},
    {"label_id":73284,"turker_id":"Mikey","cluster_id":9,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":485,"sv_image_y":-631,"sv_canvas_x":477,"sv_canvas_y":189,"heading":354.5,"pitch":-26.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959739685058594,"lng":-77.070068359375,"description":null,"severity":1,"temporary":false},
    {"label_id":73268,"turker_id":"Steven","cluster_id":9,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":461,"sv_image_y":-627,"sv_canvas_x":543,"sv_canvas_y":196,"heading":344.0,"pitch":-26.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959739685058594,"lng":-77.070068359375,"description":null,"severity":1,"temporary":false},
    {"label_id":73283,"turker_id":"Ryan","cluster_id":9,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":1169,"sv_image_y":-681,"sv_canvas_x":613,"sv_canvas_y":219,"heading":354.5,"pitch":-26.0,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95972442626953,"lng":-77.07003784179688,"description":null,"severity":1,"temporary":false},
    {"label_id":73248,"turker_id":"Mikey","cluster_id":9,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":489,"sv_image_y":-619,"sv_canvas_x":454,"sv_canvas_y":201,"heading":5.205357074737549,"pitch":-20.383928298950195,"zoom":2,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95974349975586,"lng":-77.07006072998047,"description":null,"severity":1,"temporary":false},
    {"label_id":73269,"turker_id":"Steven","cluster_id":9,"pano_id":"SMyugdyfFAGEa7A3XqGH-g","label_type":"CurbRamp","sv_image_x":1160,"sv_image_y":-681,"sv_canvas_x":707,"sv_canvas_y":240,"heading":344.0,"pitch":-26.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95972442626953,"lng":-77.07003784179688,"description":null,"severity":1,"temporary":false},
    {"label_id":73293,"turker_id":"Ryan","cluster_id":7,"pano_id":"YNmEhIe_uUD-XFdPFxoRVg","label_type":"CurbRamp","sv_image_x":1870,"sv_image_y":-972,"sv_canvas_x":35,"sv_canvas_y":287,"heading":98.5625,"pitch":-29.1875,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95973205566406,"lng":-77.06816864013672,"description":null,"severity":1,"temporary":false},
    {"label_id":73275,"turker_id":"Mikey","cluster_id":7,"pano_id":"YNmEhIe_uUD-XFdPFxoRVg","label_type":"CurbRamp","sv_image_x":1802,"sv_image_y":-944,"sv_canvas_x":85,"sv_canvas_y":295,"heading":90.3125,"pitch":-24.5,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.95973205566406,"lng":-77.06816864013672,"description":null,"severity":3,"temporary":false},
    {"label_id":73256,"turker_id":"Steven","cluster_id":7,"pano_id":"SDYdT4bmhG8e4g1SwBxehg","label_type":"CurbRamp","sv_image_x":12670,"sv_image_y":-1263,"sv_canvas_x":287,"sv_canvas_y":246,"heading":356.1160583496094,"pitch":-34.8125,"zoom":1,"canvas_height":480,"canvasWidth":720,"alpha_x":4.599999904632568,"alpha_y":-4.650000095367432,"lat":38.959739685058594,"lng":-77.06815338134766,"description":null,"severity":1,"temporary":false}
    ];




    initialize();
});
