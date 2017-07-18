$(document).ready(function () {

    var labelSet1 = sampleLabels.sampleSet1;
    var labelSet2 = sampleLabels.sampleSet2;

    var disagreementCoordinates = [[labelSet1.features[0].geometry.coordinates[1],labelSet1.features[0].geometry.coordinates[0]],[labelSet2.features[0].geometry.coordinates[1],labelSet2.features[0].geometry.coordinates[0]]];
    var currentDisagreement = 0;
    var panoramas = document.getElementsByClassName("gtpano");

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
              self.allLayers[key] = createLayer({"type": "FeatureCollection", "features": self.allLayers[key]});
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
            self.adminGSVLabelView.showLabel(feature.properties.label_id);
        });
        layer.on({
            'mouseover': function () {
                layer.setRadius(15);
            },
            'mouseout': function () {
                layer.setRadius(5);
            }
        })
    }

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


	function initializePanoramas(coordinates){
		var first = {lat: labelSet1.features[0].geometry.coordinates[1], lng: labelSet1.features[0].geometry.coordinates[0]};
    for(var i = 0; i < panoramas.length; i++){
      var panorama1 = new google.maps.StreetViewPanorama(
  		    panoramas[i], {
  			    position: first,
  		    	pov: {
  		        	heading: 34,
  		        	pitch: 10
  		        },
  		        disableDefaultUI: true,
  		        clickToGo: false
  		    });
    }
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
      minZoom: 18
  })
      .fitBounds(bounds)
      .setView(disagreementCoordinates[0], 12);


	initializePanoramas();
  initializeAllLayers(labelSet1);
  initializeAllLayers(labelSet2);
  alert("hey");
});
