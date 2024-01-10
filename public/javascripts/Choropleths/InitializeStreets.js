/**
 * Takes a map and a set of streets, and visualizes them as segments on the map.
 * @param map Map on which the streets are rendered.
 * @param params Object that includes properties that can change the process of street rendering.
 * @param params.labelPopup {boolean} whether to include a validation popup on labels on the map.
 * @param params.auditedStreetColor {string} color to use for audited streets on the map.
 * @param params.unauditedStreetColor {string} optional color to use for unaudited streets on the map.
 * @param streetData Data about streets to visualize.
 * @param layerName {string} name to use for the layer to add to the map.
*/
function InitializeStreets(map, params, streetData, layerName) {
    let streetLayer;

    function onEachStreetFeature(feature, layer) {
        let popupContent = i18next.t('labelmap:explore-street-link', { streetId: feature.properties.street_edge_id });
        layer.bindPopup(popupContent);
        layer.on({
            'mouseover': function () { this.setStyle({ weight: 6 }); },
            'mouseout': function() { this.setStyle({ weight: 3 }); }
        });
    }
    // Render street segments.
    map.addSource(layerName, {
        type: 'geojson',
        data: streetData,
        promoteId: 'street_edge_id'
    });
    map.addLayer({
        id: layerName,
        type: 'line',
        source: layerName,
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-opacity': 0.75,
            'line-color': [
                // TODO update this to check for hasUnauditedStreets
                //     color: !hasUnauditedStreets || feature.properties.audited ? params.auditedStreetColor : params.unauditedStreetColor,
                'case',
                ['==', ['get', 'audited'], true],
                params.auditedStreetColor,
                ['==', ['get', 'audited'], false],
                params.unauditedStreetColor ? params.unauditedStreetColor : 'red',
                'black'
            ],
            'line-width': 3
        }
    });

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
