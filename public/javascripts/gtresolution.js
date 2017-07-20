$(document).ready(function () {

    var disagreements = sampleLabels;
    var currentDisagreement = 0;
    var currentPano, currentCoordinates;


    var panoramas = document.getElementsByClassName("gtpano");
    var canvases = document.getElementsByClassName("label-canvas");
    var infos = document.getElementsByClassName("labelstats");
    var selectedLabels = [{view: canvases[0], info: infos[0], label: null}, {view: canvases[1], info: infos[1], label: null}, {view: canvases[2], info: infos[2], label: null}, {view: canvases[3], info: infos[3], label: null}];
    var nextOpenView = 0;

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

      var geojsonMarkerOptions = {
            radius: 5,
            fillColor: "#ff7800",
            color: "#ffffff",
            weight: 1,
            opacity: 0.5,
            fillOpacity: 0.5,
            "stroke-width": 1
        };

  function initializeAllLayers(data) {
      for (i = 0; i < data.features.length; i++) {
          var labelType = data.features[i].properties.label_type;
          if(labelType == "Occlusion" || labelType == "NoSidewalk"){
              //console.log(data.features[i]);
          }
          self.allLayers[labelType].push(data.features[i]);
      }



      Object.keys(self.allLayers).forEach(function (key) {
          for (var i = 0; i < self.allLayers[key].length; i++) {
              self.allLayers[key] = createLayer({"type": "FeatureCollection", "features": self.allLayers[key]},false);
              map.addLayer(self.allLayers[key]);
          }
      })
    }

    function createLayer(data) {
        return L.geoJson(data, {
            pointToLayer: function (feature, latlng) {
                var style = $.extend(true, {}, geojsonMarkerOptions);
                style.fillColor = colorMapping[feature.properties.label_type].fillStyle;
                style.color = colorMapping[feature.properties.label_type].strokeStyle;
                return L.circleMarker(latlng, style);
            },
            onEachFeature: onEachLabelFeature
        })
    }


    function onEachLabelFeature(feature, layer) {
        layer.on('click', function () {
          var id = feature.properties.label_id;
          var present = selectedLabels.some( selectedLabel => selectedLabel['label'] === id );
          if(!present){
            selectedLabels[nextOpenView].label = id;
            layer.setRadius(15);
            showLabel(id);}
          else{
            var pan = selectedLabels.find( selectedLabel => selectedLabel['label'] === id );
            var drawing = pan.view;
            pan.info.innerHTML = "";
            pan.view.style.borderStyle = "hidden";
            pan.label = null;
            nextOpenView= calculateNextOpen();
            layer.setRadius(5);
            var ctx = drawing.getContext("2d");
            ctx.clearRect(0,0,drawing.width,drawing.height);
          }
        });
        layer.on({
            'mouseover': function () {
              var present = selectedLabels.some( selectedLabel => selectedLabel['label'] === feature.properties.label_id);
                if(present){
                var pan = selectedLabels.find( selectedLabel => selectedLabel['label'] === feature.properties.label_id );
                pan.view.style.borderStyle = "solid";
              }
                layer.setRadius(10);
            },
            'mouseout': function () {
              var present = selectedLabels.some( selectedLabel => selectedLabel['label'] === feature.properties.label_id);
                if(!present){
                  layer.setRadius(5);
                }else{
                  var pan = selectedLabels.find( selectedLabel => selectedLabel['label'] === feature.properties.label_id );
                  pan.view.style.borderStyle = "hidden";
                }
            }
        })
    }



    function renderLabel (label) {

      var drawing = canvases[nextOpenView];
      var ctx = drawing.getContext("2d");
      ctx.clearRect(0,0,drawing.width,drawing.height);

        var x = (label.canvas_x / label.canvas_width) * drawing.width;
        var y = (label.canvas_y / label.canvas_height) * drawing.height;

        var fillColor = (label.label_type_key in colorMapping) ? colorMapping[label.label_type_key].fillStyle : "rgb(128, 128, 128)";


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


        nextOpenView= calculateNextOpen();
        return this;
    }

    function calculateNextOpen(){
      for(var i = 0; i<selectedLabels.length; i++){
        if(selectedLabels[i].label === null){return i}
      }
      return 0;
    }


	function initializePanoramas(labelId, panosToUpdate){
    $.getJSON("/adminapi/label/" + labelId, function (data) {
      currentPano = {lat: data.panorama_lat, lng: data.panorama_lng};
    for(var i = 0; i < panosToUpdate.length; i++){
      var panorama1 = new google.maps.StreetViewPanorama(
  		    panosToUpdate[i], {
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

  function nextDisagreement(){
    currentDisagreement++;
    $.getJSON("/adminapi/label/" + disagreements.features[currentDisagreement].properties.label_id, function (data) {
      currentCoordinates = [data.panorama_lat, data.panorama_lng];
    refocusView();
    });
  }

  function previousDisagreement(){
    currentDisagreement--;
    $.getJSON("/adminapi/label/" + disagreements.features[currentDisagreement].properties.label_id, function (data) {
      currentCoordinates = [data.panorama_lat, data.panorama_lng];
    refocusView();
  });
  }

  function refocusView(){
    map.setView(currentCoordinates,12);
  }

  function showLabel(labelId){
    $.getJSON("/adminapi/label/" + labelId, function (data) {
      infos[nextOpenView].innerHTML = "Label ID: <b>" + data.label_id + "</b>, Label Type: " + data.label_type_key;
      renderLabel(data);
    });
      var selectPano = [panoramas[nextOpenView]];
      initializePanoramas(labelId,selectPano);
  }

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

  // Construct a bounding box for these maps that the user cannot move out of
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

  $.getJSON("/adminapi/label/" + disagreements.features[currentDisagreement].properties.label_id, function (data) {
        currentPano = {lat: data.panorama_lat, lng: data.panorama_lng};
        currentCoordinates = [data.panorama_lat, data.panorama_lng];
      map.setView(currentCoordinates, 12);
	initializePanoramas(disagreements.features[currentDisagreement].properties.label_id, panoramas);
  initializeAllLayers(disagreements);

});

  document.getElementById("gtnext").onclick = nextDisagreement;
  document.getElementById("gtrefocus").onclick = refocusView;
  document.getElementById("gtprev").onclick = previousDisagreement;
  document.getElementById("filler").style.minHeight = "40px";


});
