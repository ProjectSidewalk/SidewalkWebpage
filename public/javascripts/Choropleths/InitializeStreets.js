/**
 * Takes a map and a set of streets, and visualizes them as segments on the map.
 * @param map Map on which the streets are rendered.
 * @param params Object that includes properties that can change the process of street rendering.
 * @param params.labelPopup {boolean} whether to include a validation popup on labels on the map.
 * @param params.auditedStreetColor {string} color to use for audited streets on the map.
 * @param params.unauditedStreetColor {string} optional color to use for unaudited streets on the map.
 * @param streetData Data about streets to visualize.
*/
function InitializeStreets(map, params, streetData) {
    let streetLayer;
    let hasUnauditedStreets = params.unauditedStreetColor != null;

    function onEachStreetFeature(feature, layer) {
        let popupContent = `<a href="/audit/street/${feature.properties.street_edge_id}">Click here</a> to explore this street!`;
        layer.bindPopup(popupContent);
        layer.on({
            'mouseover': function () { this.setStyle({ weight: 6 }); },
            'mouseout': function() { this.setStyle({ weight: 3 }); }
        });
    }
    // Render street segments.
    streetLayer = L.geoJson(streetData, {
        pointToLayer: L.mapbox.marker.style,
        style: function (feature) {
            let style = {
                color: !hasUnauditedStreets || feature.properties.audited ? params.auditedStreetColor : params.unauditedStreetColor,
                opacity: 0.75,
                'stroke-width': 3,
                weight: 3
            };
            return style;
        },
        onEachFeature: onEachStreetFeature
    })
        .addTo(map);

    // Get total reward if a turker.
    if (params.userRole === 'Turker') {
        $.ajax({
            async: true,
            url: '/rewardEarned',
            type: 'get',
            success: function(rewardData) {
                document.getElementById('td-total-reward-earned').innerHTML = '$' + rewardData.reward_earned.toFixed(2);
            },
            error: function (xhr, ajaxOptions, thrownError) {
                console.log(thrownError);
            }
        })
    }
    return streetLayer;
}
