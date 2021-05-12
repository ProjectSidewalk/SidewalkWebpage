

/**
 * Central function that handles the creation of the location selection map.
 * @param $ Allows the use of jQuery.
 * @param mapParamData Data used to initialize the choropleth properties.
 */
function LocationMap($, mapParamData) {
    mapboxgl.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    
    var map = new mapboxgl.Map({
        container: "map", // container id
        style: 'mapbox://styles/mapbox/streets-v11', // style URL
        zoomControl: true,
        scrollWheelZoom: true,
        zoom: mapParamData.default_zoom,
        center: { lng: parseFloat(mapParamData.city_center.lng), lat: parseFloat(mapParamData.city_center.lat)}
    });

    return map;
}