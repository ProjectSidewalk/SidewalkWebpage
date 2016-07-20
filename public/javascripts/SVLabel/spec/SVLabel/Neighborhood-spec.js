describe("Test for the Neighborhood module.", function () {
    // Jasmine-ajax. http://jasmine.github.io/2.0/ajax.html
    var svl = svl || {};
    svl.neighborhoodContainer = new NeighborhoodContainer();
    svl.neighborhoodFactory = new NeighborhoodFactory();
    // all this to make a leaflet layer
    var map = L.map('map').setView([38.907, -76.931], 17);
    L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token={accessToken}', {
        attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, <a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="http://mapbox.com">Mapbox</a>',
        maxZoom: 18,
        id: 'dzadoroz.0le4fa15',
        accessToken: 'pk.eyJ1IjoiZHphZG9yb3oiLCJhIjoiY2lxbGUwcDAxMDAxbWZwbmhkdXJhdW52NCJ9.0yepqDp3o0FdJ0t2CLcQlw'
    }).addTo(map);
    var polygon = {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "geometry": {
            "type": "Polygon", "coordinates": [
                [[-75, 36], [-75, 40], [-80, 40], [-80, 36],[-75, 36]]
            ]}}]};
    var polygonLayer = L.geoJson(polygon).addTo(map);
    var params = { regiondId: 100 , regionLayer: polygonLayer , regionName: "nowhere"};
    var neighborhood = svl.neighborhoodFactory.create(params.regionId, params.regionLayer, params.regionName);
    svl.neighborhoodContainer.add(neighborhood);
    svl.neighborhoodContainer.setCurrentNeighborhood(neighborhood);

    it("Test getGeoJSON()", function() {
    	expect(neighborhood.getGeoJSON()).toBeDefined();
    	expect(neighborhood.getGeoJSON().type).toBe("Feature");
    });

});