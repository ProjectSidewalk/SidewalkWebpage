function SidewalkAPI () {
    var colorMapping = util.misc.getLabelColors();

    function getColor(d) {
        return d > 0.75 ? '#4dac26' :
            d > 0.5 ? '#b8e186' :
                d > 0.25 ? '#f1b6da' :
                    '#d01c8b';
    }

    // Get city-specific parameters for the maps.
    $.getJSON('/cityAPIDemoParams', function(data) {
        mapboxgl.accessToken = data.mapbox_api_key;
        var maxBounds = [[data.southwest_boundary.lng, data.southwest_boundary.lat], [data.northeast_boundary.lng, data.northeast_boundary.lat]];

        // Create the maps.
        var mapAccessAttributes = new mapboxgl.Map({
            container: 'api-access-attribute-map',
            style: 'mapbox://styles/mapbox/streets-v12?optimize=true',
            center: [data.attribute.center_lng, data.attribute.center_lat],
            zoom: data.attribute.zoom,
            maxZoom: 19,
            minZoom: 8.5,
            maxBounds: maxBounds
        }).addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }))
            .addControl(new mapboxgl.NavigationControl(), 'top-left');
        var mapAccessScoreStreets = new mapboxgl.Map({
            container: 'api-access-score-streets-map',
            style: 'mapbox://styles/mapbox/streets-v12?optimize=true',
            center: [data.street.center_lng, data.street.center_lat],
            zoom: data.street.zoom,
            maxZoom: 19,
            minZoom: 8.5,
            maxBounds: maxBounds
        }).addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }))
            .addControl(new mapboxgl.NavigationControl(), 'top-left');
        var mapAccessScoreNeighborhoods = new mapboxgl.Map({
            container: 'api-access-score-neighborhoods-map',
            style: 'mapbox://styles/mapbox/streets-v12?optimize=true',
            center: [data.region.center_lng, data.region.center_lat],
            zoom: data.region.zoom,
            maxZoom: 19,
            minZoom: 8.5,
            maxBounds: maxBounds
        }).addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }))
            .addControl(new mapboxgl.NavigationControl(), 'top-left');

        // Assign URLs to download buttons to get citywide data.
        $('#city-attributes-csv').attr({ 'href': '/v2/access/attributes?filetype=csv' });
        $('#city-attributes-shapefile').attr({ 'href': '/v2/access/attributes?filetype=shapefile' });
        $('#city-attributes-geojson').attr({ 'href': '/v2/access/attributes?filetype=geojson' });

        $('#city-attributes-label-csv').attr({ 'href': '/v2/access/attributesWithLabels?filetype=csv' });
        $('#city-attributes-label-shapefile').attr({ 'href': '/v2/access/attributesWithLabels?filetype=shapefile' });
        $('#city-attributes-label-geojson').attr({ 'href': '/v2/access/attributesWithLabels?filetype=geojson' });

        $('#city-streets-csv').attr({ 'href': '/v2/access/score/streets?filetype=csv' });
        $('#city-streets-shapefile').attr({ 'href': '/v2/access/score/streets?filetype=shapefile' });
        $('#city-streets-geojson').attr({ 'href': '/v2/access/score/streets?filetype=geojson' });

        $('#city-neighborhood-csv').attr({ 'href': '/v2/access/score/neighborhoods?filetype=csv' });
        $('#city-neighborhood-shapefile').attr({ 'href': '/v2/access/score/neighborhoods?filetype=shapefile' });
        $('#city-neighborhood-geojson').attr({ 'href': '/v2/access/score/neighborhoods?filetype=geojson' });

        $('#city-raw-label-csv').attr({ 'href': '/v2/rawLabels?filetype=csv' });
        $('#city-raw-label-shapefile').attr({ 'href': '/v2/rawLabels?filetype=shapefile' });
        $('#city-raw-label-geojson').attr({ 'href': '/v2/rawLabels?filetype=geojson' });

        // Use parameters to fill in example URLs.
        var attributesURL = `/v2/access/attributes?lat1=${data.attribute.lat1}&lng1=${data.attribute.lng1}&lat2=${data.attribute.lat2}&lng2=${data.attribute.lng2}`;
        var attributesURLCSV = `/v2/access/attributes?lat1=${data.attribute.lat1}&lng1=${data.attribute.lng1}&lat2=${data.attribute.lat2}&lng2=${data.attribute.lng2}&filetype=csv`;
        var attributesURLSeverity = `/v2/access/attributes?lat1=${data.attribute.lat1}&lng1=${data.attribute.lng1}&lat2=${data.attribute.lat2}&lng2=${data.attribute.lng2}&severity=3`;
        var attributeWithLabelsURL = `/v2/access/attributesWithLabels?lat1=${data.attribute.lat1}&lng1=${data.attribute.lng1}&lat2=${data.attribute.lat2}&lng2=${data.attribute.lng2}`;

        var streetsURL = `/v2/access/score/streets?lat1=${data.street.lat1}&lng1=${data.street.lng1}&lat2=${data.street.lat2}&lng2=${data.street.lng2}`;
        var streetsURLCSV = `/v2/access/score/streets?lat1=${data.street.lat1}&lng1=${data.street.lng1}&lat2=${data.street.lat2}&lng2=${data.street.lng2}&filetype=csv`;
        var streetsURLShapeFile = `/v2/access/score/streets?lat1=${data.street.lat1}&lng1=${data.street.lng1}&lat2=${data.street.lat2}&lng2=${data.street.lng2}&filetype=shapefile`;

        var regionsURL = `/v2/access/score/neighborhoods?lat1=${data.region.lat1}&lng1=${data.region.lng1}&lat2=${data.region.lat2}&lng2=${data.region.lng2}`;
        var regionsURLCSV = `/v2/access/score/neighborhoods?lat1=${data.region.lat1}&lng1=${data.region.lng1}&lat2=${data.region.lat2}&lng2=${data.region.lng2}&filetype=csv`;
        var regionsURLShapeFile = `/v2/access/score/neighborhoods?lat1=${data.region.lat1}&lng1=${data.region.lng1}&lat2=${data.region.lat2}&lng2=${data.region.lng2}&filetype=shapefile`;

        var rawLabelsURL = `/v2/rawLabels?lat1=${data.attribute.lat1}&lng1=${data.attribute.lng1}&lat2=${data.attribute.lat2}&lng2=${data.attribute.lng2}`;
        var rawLabelsURLCSV = `/v2/rawLabels?lat1=${data.attribute.lat1}&lng1=${data.attribute.lng1}&lat2=${data.attribute.lat2}&lng2=${data.attribute.lng2}&filetype=csv`;
        var rawLabelsURLShapeFile = `/v2/rawLabels?lat1=${data.attribute.lat1}&lng1=${data.attribute.lng1}&lat2=${data.attribute.lat2}&lng2=${data.attribute.lng2}&filetype=shapefile`;


        // Fill in example URLs in HTML.
        var inline = '&inline=true';
        $('#attributes-link').attr('href', attributesURL + inline);
        $('#attributes-code').html(attributesURL);
        $('#attributes-link-CSV').attr('href', attributesURLCSV);
        $('#attributes-code-CSV').html(attributesURLCSV);
        $('#attributes-link-severity').attr('href', attributesURLSeverity + inline);
        $('#attributes-code-severity').html(attributesURLSeverity);
        $('#attributes-with-labels-link').attr('href', attributeWithLabelsURL + inline);
        $('#attributes-with-labels-code').html(attributeWithLabelsURL);
        $('#streets-link').attr('href', streetsURL);
        $('#streets-code').html(streetsURL);
        $('#streets-link-CSV').attr('href', streetsURLCSV);
        $('#streets-code-CSV').html(streetsURLCSV);
        $('#streets-link-shapefile').attr('href', streetsURLShapeFile);
        $('#streets-code-shapefile').html(streetsURLShapeFile);
        $('#regions-link').attr('href', regionsURL);
        $('#regions-code').html(regionsURL);
        $('#regions-link-CSV').attr('href', regionsURLCSV);
        $('#regions-code-CSV').html(regionsURLCSV);
        $('#regions-link-shapefile').attr('href', regionsURLShapeFile);
        $('#regions-code-shapefile').html(regionsURLShapeFile);
        $('#raw-labels-link').attr('href', rawLabelsURL + inline);
        $('#raw-labels-code').html(rawLabelsURL);
        $('#raw-labels-link-CSV').attr('href', rawLabelsURLCSV);
        $('#raw-labels-code-CSV').html(rawLabelsURLCSV);
        $('#raw-labels-link-shapefile').attr('href', rawLabelsURLShapeFile);
        $('#raw-labels-code-shapefile').html(rawLabelsURLShapeFile);

        // Get data for map for Access Attribute.
        $.getJSON(attributesURL, function (data) {
            // Add the fill color to the data directly for simplicity.
            data.features.forEach(function (feature) {
                feature.properties.circleColor = colorMapping[feature.properties.label_type].fillStyle;
            });
            mapAccessAttributes.addSource('attributes', {
                type: 'geojson',
                data: data
            });
            mapAccessAttributes.addLayer({
                id: 'attributes',
                type: 'circle',
                source: 'attributes',
                paint: {
                    'circle-radius': 5,
                    'circle-opacity': 0.75,
                    'circle-stroke-opacity': 1,
                    'circle-stroke-width': 1,
                    'circle-color': ['get', 'circleColor'],
                    'circle-stroke-color': '#fff'
                }
            });
        });

        // Get data for map for Access Score: Streets.
        $.getJSON(streetsURL, function (data) {
            // Add the line color to the data directly for simplicity.
            data.features.forEach(function (feature) {
                feature.properties.lineColor = feature.properties.audit_count ? getColor(feature.properties.score) : 'gray';
            });
            mapAccessScoreStreets.addSource('streets', {
                type: 'geojson',
                data: data
            });
            mapAccessScoreStreets.addLayer({
                id: 'streets',
                type: 'line',
                source: 'streets',
                paint: {
                    // Line width scales based on zoom level.
                    'line-width': [
                        'interpolate', ['linear'], ['zoom'],
                        12, 2,
                        15, 5
                    ],
                    'line-opacity': 0.7,
                    'line-color': ['get', 'lineColor']
                }
            });
        });

        // Get data for map for Access Score: Neighborhoods.
        $.getJSON(regionsURL, function (data) {
            // Add the fill color to the data directly for simplicity.
            data.features.forEach(function (feature) {
                feature.properties.fillColor = getColor(feature.properties.score);
            });
            mapAccessScoreNeighborhoods.addSource('neighborhoods', {
                type: 'geojson',
                data: data
            });
            mapAccessScoreNeighborhoods.addLayer({
                id: 'neighborhoods',
                type: 'fill',
                source: 'neighborhoods',
                paint: {
                    'fill-opacity': 0.7,
                    'fill-color': ['get', 'fillColor'],
                    'fill-outline-color': '#fff'
                }
            });
        });
    });
}
