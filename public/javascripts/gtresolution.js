$(document).ready(function () {
  var self = {};
  self.markerLayer = null;
  self.curbRampLayers = [];
  self.missingCurbRampLayers = [];
  self.obstacleLayers = [];
  self.surfaceProblemLayers = [];
  self.cantSeeSidewalkLayers = [];
  self.noSidewalkLayers = [];
  self.otherLayers = [];
  self.mapLoaded = false;
  self.graphsLoaded = false;

  for (i = 0; i < 5; i++) {
      self.curbRampLayers[i] = [];
      self.missingCurbRampLayers[i] = [];
      self.obstacleLayers[i] = [];
      self.surfaceProblemLayers[i] = [];
      self.cantSeeSidewalkLayers[i] = [];
      self.noSidewalkLayers[i] = [];
      self.otherLayers[i] = [];
  }

  self.allLayers = {
      "CurbRamp": self.curbRampLayers, "NoCurbRamp": self.missingCurbRampLayers, "Obstacle": self.obstacleLayers,
      "SurfaceProblem": self.surfaceProblemLayers, "Occlusion": self.cantSeeSidewalkLayers,
      "NoSidewalk": self.noSidewalkLayers, "Other": self.otherLayers
  };

  self.auditedStreetLayer = null;

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
      minZoom: 16
  })
      .fitBounds(bounds)
      .setView([38.8977, -77.0365], 12);


});
