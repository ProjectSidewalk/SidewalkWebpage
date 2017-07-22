$(document).ready(function () {

    //http://plnkr.co/edit/MeQDKjHA34PcPa53Zr9o?p=preview

    //disagreements currently only has to be a Json of label_id's,
    //but eventually making disagreements a Json that stores additional label information (lat,lng,heading, pitch,user_id) will speed everything up
    var disagreements = sampleLabels;
    //stores which disagreement is being looked at currently
    var currentDisagreement = 0;
    //currentPano and currentCoordinates are formats for the label's lat lng position
    var currentPano, currentCoordinates;

    //list of the four GSV panoramas
    var panoramas = document.getElementsByClassName("gtpano");
    //list of the four canvases
    var canvases = document.getElementsByClassName("label-canvas");
    //list of the four divs storing label information
    var infos = document.getElementsByClassName("labelstats");
    //array that stores which label is being displayed on what canvas/info pairing
    var selectedLabels = [{view: canvases[0], info: infos[0], label: null}, {view: canvases[1], info: infos[1], label: null}, {view: canvases[2], info: infos[2], label: null}, {view: canvases[3], info: infos[3], label: null}];
    //stores the next open view to display a label on
    var nextOpenView = 0;

    //stores color information for each label type
    var colorMapping = {
        Walk : {
            id : 'Walk',
            fillStyle : 'rgba(0, 0, 0, 1)',
            strokeStyle: '#ffffff'
        },
        CurbRamp: {
            id: 'CurbRamp',
            fillStyle: 'rgba(0, 222, 38, 1)',  // 'rgba(0, 244, 38, 1)'
            strokeStyle: '#ffffff'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            fillStyle: 'rgba(233, 39, 113, 1)',  // 'rgba(255, 39, 113, 1)'
            strokeStyle: '#ffffff'
        },
        Obstacle: {
            id: 'Obstacle',
            fillStyle: 'rgba(0, 161, 203, 1)',
            strokeStyle: '#ffffff'
        },
        Other: {
            id: 'Other',
            fillStyle: 'rgba(179, 179, 179, 1)', //'rgba(204, 204, 204, 1)'
            strokeStyle: '#0000ff'

        },
        Occlusion: {
            id: 'Occlusion',
            fillStyle: 'rgba(179, 179, 179, 1)',
            strokeStyle: '#009902'
        },
        NoSidewalk: {
            id: 'NoSidewalk',
            fillStyle: 'rgba(179, 179, 179, 1)',
            strokeStyle: '#ff0000'
        },
        SurfaceProblem: {
            id: 'SurfaceProblem',
            fillStyle: 'rgba(241, 141, 5, 1)',
            strokeStyle: '#ffffff'
        },
        Void: {
            id: 'Void',
            fillStyle: 'rgba(255, 255, 255, 1)',
            strokeStyle: '#ffffff'
        },
        Unclear: {
            id: 'Unclear',
            fillStyle: 'rgba(128, 128, 128, 0.5)',
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
  function initializeAllLayers(data) {
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
      })
    }

    //create a layer for the mapbox
    function createLayer(data) {
        return L.geoJson(data, {
            pointToLayer: function (feature, latlng) {
              //style the marker
                var style = $.extend(true, {}, geojsonMarkerOptions);
                style.fillColor = colorMapping[feature.properties.label_type].fillStyle;
                style.color = colorMapping[feature.properties.label_type].strokeStyle;
                return L.circleMarker(latlng, style);
            },
            onEachFeature: onEachLabelFeature
        })
    }

    //activity of marker
    function onEachLabelFeature(feature, layer) {
        layer.on('click', function () {
          //test whether the label is already being shown in one of the four views
          var id = feature.properties.label_id;
          var present = selectedLabels.some( selectedLabel => selectedLabel['label'] === id );
          if(present){
            //if yes, then remove the label and clear the view
            layer.setRadius(5);
            //find out which view it is being shown in
            var pan = selectedLabels.find( selectedLabel => selectedLabel['label'] === id );
            var drawing = pan.view;
            //clear info, border, logged id
            pan.info.innerHTML = "";
            pan.view.style.borderStyle = "hidden";
            pan.label = null;
            //recalulate next open view
            nextOpenView= calculateNextOpen();
            //clear canvas
            var ctx = drawing.getContext("2d");
            ctx.clearRect(0,0,drawing.width,drawing.height);
          }else{
            //if not, display the label and log that it is being shown
            selectedLabels[nextOpenView].label = id;
            layer.setRadius(15);
            showLabel(id);
          }
        });
        layer.on({
            'mouseover': function () {
              //test whether label is present within a view
              var present = selectedLabels.some( selectedLabel => selectedLabel['label'] === feature.properties.label_id);
                if(present){
                //if so, highlight that view with a border
                var pan = selectedLabels.find( selectedLabel => selectedLabel['label'] === feature.properties.label_id );
                pan.view.style.borderStyle = "solid";
              }
                //emphasize marker
                layer.setRadius(10);
            },
            'mouseout': function () {
              //test whether label is present within a view
              var present = selectedLabels.some( selectedLabel => selectedLabel['label'] === feature.properties.label_id);
                if(!present){
                  //if not, remove emphasis
                  layer.setRadius(5);
                }else{
                  //if so, hide border highlight
                  var pan = selectedLabels.find( selectedLabel => selectedLabel['label'] === feature.properties.label_id );
                  pan.view.style.borderStyle = "hidden";
                }
            }
        })
    }

    //draw a label in the view
    function renderLabel (label) {

      //choose the next open canvas
      var drawing = canvases[nextOpenView];
      var ctx = drawing.getContext("2d");
      //clear any existing labels
      ctx.clearRect(0,0,drawing.width,drawing.height);

        //calculate position
        var x = (label.canvas_x / label.canvas_width) * drawing.width;
        var y = (label.canvas_y / label.canvas_height) * drawing.height;
        //choose colors
        var fillColor = (label.label_type_key in colorMapping) ? colorMapping[label.label_type_key].fillStyle : "rgb(128, 128, 128)";

        //draw circle
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,1)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, 2 * Math.PI);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.restore();

        //recalculate next open view
        nextOpenView= calculateNextOpen();
        return this;
    }

    //choose the earliest of the open views (views not displaying a label)
    //if all full, choose the first view
    function calculateNextOpen(){
      for(var i = 0; i<selectedLabels.length; i++){
        if(selectedLabels[i].label === null){return i}
      }
      return 0;
    }

  //set the GSV panoramas
	function initializePanoramas(labelId, panosToUpdate){
    $.getJSON("/gtresolution/labelData/" + labelId, function (data) {
      //set position
      currentPano = {lat: data.panorama_lat, lng: data.panorama_lng};
    for(var i = 0; i < panosToUpdate.length; i++){
      //update all indicated panoramas
      var panorama1 = new google.maps.StreetViewPanorama(panosToUpdate[i],{
        position: currentPano,
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

  //next button functionality
  function nextDisagreement(){
    currentDisagreement++;
    $.getJSON("/gtresolution/labelData/" + disagreements.features[currentDisagreement].properties.label_id, function (data) {
      //shift mapbox to focus on next label
      currentCoordinates = [data.panorama_lat, data.panorama_lng];
      refocusView();
    });
  }

  //previous button functionality
  function previousDisagreement(){
    currentDisagreement--;
    $.getJSON("/gtresolution/labelData/" + disagreements.features[currentDisagreement].properties.label_id, function (data) {
      //shift mapbox to focus on previous label
      currentCoordinates = [data.panorama_lat, data.panorama_lng];
      refocusView();
  });
  }

  //focus view on current label
  function refocusView(){
    map.setView(currentCoordinates,12);
  }

  //show label in view
  function showLabel(labelId){
    $.getJSON("/gtresolution/labelData/" + labelId, function (data) {
      //update info
      infos[nextOpenView].innerHTML = "Label ID: <b>" + data.label_id + "</b>, Label Type: " + data.label_type_key;
      //draw label
      renderLabel(data);
    });
      //update selected panorama
      var selectPano = [panoramas[nextOpenView]];
      initializePanoramas(labelId,selectPano);
  }

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

    //update panoramas and initialize all labels on mapbox
  $.getJSON("/gtresolution/labelData/" + disagreements.features[0].properties.label_id, function (data) {
        currentPano = {lat: data.panorama_lat, lng: data.panorama_lng};
        currentCoordinates = [data.panorama_lat, data.panorama_lng];
      map.setView(currentCoordinates, 12);
	initializePanoramas(disagreements.features[currentDisagreement].properties.label_id, panoramas);
  initializeAllLayers(disagreements);
});


//clear a specific canvas
function clearCanvas(canvasNum){
  var pan = selectedLabels[canvasNum];
  var drawing = pan.view;
  pan.info.innerHTML = "";
  pan.view.style.borderStyle = "hidden";
  pan.label = null;
  nextOpenView= calculateNextOpen();
  var ctx = drawing.getContext("2d");
  ctx.clearRect(0,0,drawing.width,drawing.height);
}

  //map all button functionalities
  document.getElementById("gtnext").onclick = nextDisagreement;
  document.getElementById("gtrefocus").onclick = refocusView;
  document.getElementById("gtprev").onclick = previousDisagreement;
  document.getElementById("clear1").onclick = function(){ clearCanvas(0); }
  document.getElementById("clear2").onclick = function(){ clearCanvas(1); }
  document.getElementById("clear3").onclick = function(){ clearCanvas(2); }
  document.getElementById("clear4").onclick = function(){ clearCanvas(3); }

  //reduce filler at bottom of page (styling purposes)
  document.getElementById("filler").style.minHeight = "40px";

});
