$(document).ready(function () {

  //http://plnkr.co/edit/MeQDKjHA34PcPa53Zr9o?p=preview

  //disagreements currently only has to be a Json of label_id's,
  //but eventually making disagreements a Json that stores additional label information (lat,lng,heading, pitch,user_id) will speed everything up
  var disagreements = sampleLabels;
  //stores which disagreement is being looked at currently
  var currentDisagreement = 0;
  // currentCoordinates are formats for the label's lat lng position
  var currentCoordinates;

  //array that stores information about each panorama/view
  var panoramaContainers = [];

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
    for (i = 0; i < data.features.length; i++) {
      //push label type to list of layers
      var labelType = data.features[i].properties.label_type;
      self.allLayers[labelType].push(data.features[i]);
    }

    Object.keys(self.allLayers).forEach(function (key) {
      for (var i = 0; i < self.allLayers[key].length; i++) {
        //create later and add to map
        self.allLayers[key] = createLayer({"type": "FeatureCollection", "features": self.allLayers[key]},false);
        map.addLayer(self.allLayers[key]);
      }
    });
  }
  //create a layer for the mapbox
  function createLayer(data) {
    return L.geoJson(data, {
      pointToLayer: function (feature, latlng) {
        //style the marker
        var style = $.extend(true, {}, geojsonMarkerOptions);
        style.fillColor = "#" + colorMapping[feature.properties.label_type].fillStyle;
        style.color = colorMapping[feature.properties.label_type].strokeStyle;
        return L.circleMarker(latlng, style);
      },
      onEachFeature: onEachLabelFeature
    });
  }

  //set the GSV panoramas
  function initializePanoramas(labelId, panosToUpdate){
    $.getJSON("/gtresolution/labelData/" + labelId, function (data) {
      for(var i = 0; i < panosToUpdate.length; i++){
        //update all indicated panoramas
        panoramaContainers[i].gsv_panorama = new google.maps.StreetViewPanorama(panosToUpdate[i],{
          pano: data.gsv_panorama_id,
          pov: {
            heading: data.heading,
            pitch: data.pitch
          },
          disableDefaultUI: true,
          clickToGo: false
        });
      }
    });
  }



  //choose the earliest of the open views (views not displaying a label)
  //if all full, choose the first view
  function calculateNextOpen(){
    for(var i = 0; i<panoramaContainers.length; i++){
      if(panoramaContainers[i].label.label_id === undefined){return i;}
    }
    return 0;
  }



  //activity of marker
  function onEachLabelFeature(feature, layer) {
    layer.on('click', function () {
      //test whether the label is already being shown in one of the four views
      var id = feature.properties.label_id;
      var panoIndex = panoramaContainers.findIndex( panoramaContainer => panoramaContainer.label.label_id === id );
      if(panoIndex >= 0){ // If it's being shown, clear the canvas it's being shown in
        $('#clear' + (panoIndex + 1)).trigger('click');
      } else { //if not, display the label and log that it is being shown
        $('#clear' + (nextOpenView + 1)).trigger('click');
        panoramaContainers[nextOpenView].label.label_id = id;
        layer.setRadius(15);
        showLabel(id, nextOpenView);
      }
    });
    layer.on({
      'mouseover': function () {
        //test whether label is present within a view
        var present = panoramaContainers.some( panoramaContainer => panoramaContainer.label.label_id === feature.properties.label_id);
        if(present){ //if so, highlight that view with a border
          var pano = panoramaContainers.find( panoramaContainer => panoramaContainer.label.label_id === feature.properties.label_id );
          pano.view.style.borderStyle = "solid";
        }
        //emphasize label on map
        layer.setRadius(10);
      },
      'mouseout': function () {
        //test whether label is present within a view
        var present = panoramaContainers.some( panoramaContainer => panoramaContainer.label.label_id === feature.properties.label_id);
        if(!present){
          //if not, remove emphasis
          layer.setRadius(5);
        }else{ //if so, hide border highlight
          var pano = panoramaContainers.find( panoramaContainer => panoramaContainer.label.label_id === feature.properties.label_id );
          pano.view.style.borderStyle = "hidden";
        }
      }
    });
  }



  //show label in panorama
  function showLabel(labelId, panoIndex){
    nextOpenView = calculateNextOpen();  
    $.getJSON("/gtresolution/labelData/" + labelId, function (data) {
      panoramaContainers[panoIndex].label = data;
      //update info
      panoramaContainers[panoIndex].info.innerHTML = "<b>Label ID:</b> " + data.label_id + ", <b>Label Type:</b> " + data.label_type_key + ", <b>Severity:</b> "+data.severity;
      //draw label
      renderLabel(data, panoIndex);
      //update selected panorama
      var toChange = panoramaContainers[panoIndex].gsv_panorama;
      toChange.setPano(data.gsv_panorama_id);
      toChange.setPov({heading: data.heading, pitch: data.pitch});
    });
  }

  //draw a label in the view
  function renderLabel (label, panoIndex) {
    //choose the next open canvas
    var open = panoramaContainers[panoIndex].gsv_panorama;

    // Create PanoMarker
    var labelPosition = mapXYtoPov(label.canvas_x, label.canvas_y, label.canvas_width, label.canvas_height, label.zoom, label.heading, label.pitch);
    var size = new google.maps.Size(30, 30);
    var id = "label-id-"+label.label_id;
    var label_marker = new PanoMarker({
      pano: panoramaContainers[panoIndex].gsv_panorama,
      container: panoramaContainers[panoIndex].view,
      position: {heading: labelPosition.heading, pitch: labelPosition.pitch},
      id: id,
      icon: "assets/javascripts/SVLabel/img/cursors/Cursor_"+label.label_type_key+".png",
      size: size
    });
    panoramaContainers[panoIndex].labelMarker = label_marker;

    // Add listener to marker to show info upon clicking
    google.maps.event.addListener(panoramaContainers[panoIndex].labelMarker, 'click', function() {
      createPopover(panoIndex);
    });
    
    // Popover follows marker when POV is changed
    google.maps.event.addListener(panoramaContainers[panoIndex].gsv_panorama, 'pov_changed', function(){
      if(panoramaContainers[panoIndex].popoverOn){
        $("#"+id).popover('show');
      }
    });
    return this;
  }

  // Create popover for marker
  function createPopover(index){
    var data = panoramaContainers[index].label;  
    var markerElement = $("#label-id-"+panoramaContainers[index].label.label_id);
    panoramaContainers[index].popoverOn = !panoramaContainers[index].popoverOn;

    if(markerElement.attr('data-toggle') === undefined){
      markerElement
        .attr('data-toggle', 'popover')
        .attr('data-placement', 'top')
        .attr('data-content', 
          '<p style="text-align:center"><b>Labeler:</b>&nbsp;'+data.username+', <b>Label ID:</b>&nbsp;'+data.label_id+
          '<br><b>Severity:</b>&nbsp;'+data.severity+'</p>'+
          '<input type="button" style="margin-top:2" value="Commit to Ground Truth"></input>'+
          '<a href="javascript:;" id="toggle-visible-'+data.label_id+'" style="margin-left:8px"><span class="glyphicon glyphicon-eye-open" style="color:#7CE98B; font-size:14px"></span></a>') // 9eba9e
        .popover({html:true})
        .parent().delegate('a#toggle-visible-'+data.label_id, 'click', function(e){
          if(panoramaContainers[index].labelMarker.getIcon() === null){
            panoramaContainers[index].labelMarker.setIcon("assets/javascripts/SVLabel/img/cursors/Cursor_"+data.label_type_key+".png");
            markerElement.children('a').children('span').css('color', '#7CE98B');
          }else{
            panoramaContainers[index].labelMarker.setIcon(null);
            markerElement.children('a').children('span').css('color', '#F8F4F0');
          }
        });
      panoramaContainers[index].popoverOn = true;

      // Toggle visibility of label marker
      markerElement.on('click','a#toggle-visible-'+data.label_id, function(e){
        if(panoramaContainers[index].labelMarker.getIcon() === null){
          panoramaContainers[index].labelMarker.setIcon("assets/javascripts/SVLabel/img/cursors/Cursor_"+data.label_type_key+".png");
          this.children('span').css('color', '#7CE98B');
        }else{
          panoramaContainers[index].labelMarker.setIcon(null);
          this.children('span').css('color', '#F8F4F0');
        }
      });

      
    }
  }

  //clear a specific canvas
  function clearCanvas(index, layers){
    var panoramaContainer = panoramaContainers[index];
    if(panoramaContainer.labelMarker !== null){
      var labelId = panoramaContainer.label.label_id;
      var layer = undefined;
      var labelsOfAType = [];

      for (var labelType in layers) {
        if (layers.hasOwnProperty(labelType)) {
          if(!Array.isArray(layers[labelType])){ // Go through all labels on map and find the one that matches the one that we're trying to clear from the canvas
            labelsOfAType = $.map(layers[labelType]._layers, function(value, index){return [value];});
            layer = (layer === undefined) ? labelsOfAType.find(function(label){return label.feature.properties.label_id === labelId}) : layer;
          }
        }
      }
      
      if(layer !== undefined){
        layer.setRadius(5);
      }
      
      $('#label-id-'+labelId).popover('hide');
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
  function nextDisagreement(map){
    currentDisagreement = (currentDisagreement + 1) % disagreements.features.length;
    $.getJSON("/gtresolution/labelData/" + disagreements.features[currentDisagreement].properties.label_id, function (data) {
      //shift mapbox to focus on next label
      currentCoordinates = [data.panorama_lat, data.panorama_lng];
      refocusView(map);
    });
  }

  //previous button functionality
  function previousDisagreement(map){
    currentDisagreement = (currentDisagreement - 1 + disagreements.features.length) % disagreements.features.length;
    $.getJSON("/gtresolution/labelData/" + disagreements.features[currentDisagreement].properties.label_id, function (data) {
      //shift mapbox to focus on previous label
      currentCoordinates = [data.panorama_lat, data.panorama_lng];
      refocusView(map);
    });
  }

  //focus view on current label
  function refocusView(map){
    map.setView(currentCoordinates,12);
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
  function mapXYtoPov(canvas_x, canvas_y, canvas_width, canvas_height, zoom, heading, pitch){
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



  function initialize(){
    //variables for the mapbox
    var self = {};
    self.markerLayer = null;
    self.curbRampLayers = [];
    self.missingCurbRampLayers = [];
    self.obstacleLayers = [];
    self.surfaceProblemLayers = [];
    self.cantSeeSidewalkLayers = [];
    self.noSidewalkLayers = [];
    self.otherLayers = [];
    self.allLayers = {
      "CurbRamp": self.curbRampLayers, "NoCurbRamp": self.missingCurbRampLayers, "Obstacle": self.obstacleLayers,
      "SurfaceProblem": self.surfaceProblemLayers, "Occlusion": self.cantSeeSidewalkLayers,
      "NoSidewalk": self.noSidewalkLayers, "Other": self.otherLayers
    };
    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';
    // Construct a bounding box for the map that the user cannot move out of
    // https://www.mapbox.com/mapbox.js/example/v1.0.0/maxbounds/
    var southWest = L.latLng(38.761, -77.262);
    var northEast = L.latLng(39.060, -76.830);
    var bounds = L.latLngBounds(southWest, northEast);
    // var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
    var tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA";
    var mapboxTiles = L.tileLayer(tileUrl, {
      attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
    });
    var map = L.mapbox.map('groundtruth-map', "kotarohara.8e0c6890", {
      // set that bounding box as maxBounds to restrict moving the map
      // see full maxBounds documentation:
      // http://leafletjs.com/reference.html#map-maxbounds
      maxBounds: bounds,
      maxZoom: 20,
      minZoom: 19
    })
    .fitBounds(bounds)

    // Initialize panorama data
    for(var i = 0; i < 4; i++){
      panoramaContainers.push({
        gsv_panorama: null, // the StreetViewPanorama object for each view
        view: document.getElementsByClassName("gtpano")[i], // holder for the GSV panorama
        info: document.getElementsByClassName("labelstats")[i], // div above panorama holding label information
        label: {}, // metadata of label displayed in each panorama ({} if no label is displayed)
        popoverOn: false, // 
        labelMarker: null // the marker for the label in the panorama
      });
    }


    //update panoramas and initialize all labels on mapbox
    $.getJSON("/gtresolution/labelData/" + disagreements.features[0].properties.label_id, function (data) {
      currentCoordinates = [data.panorama_lat, data.panorama_lng];
      map.setView(currentCoordinates, 12);
      var panoramas = panoramaContainers.map(panoramaContainer => panoramaContainer.view);
      initializePanoramas(disagreements.features[currentDisagreement].properties.label_id, panoramas);
      initializeAllLayers(disagreements, self, map);
    });



    //map all button functionalities
    document.getElementById("gtnext").onclick = function(){nextDisagreement(map); };
    document.getElementById("gtrefocus").onclick = function(){ refocusView(map); };
    document.getElementById("gtprev").onclick = function(){ previousDisagreement(map); };
    document.getElementById("clear1").onclick = function(){ clearCanvas(0, self.allLayers); };
    document.getElementById("clear2").onclick = function(){ clearCanvas(1, self.allLayers); };
    document.getElementById("clear3").onclick = function(){ clearCanvas(2, self.allLayers); };
    document.getElementById("clear4").onclick = function(){ clearCanvas(3, self.allLayers); };

    //reduce filler at bottom of page (styling purposes)
    document.getElementById("filler").style.minHeight = "40px";
  }

  

  initialize();
});