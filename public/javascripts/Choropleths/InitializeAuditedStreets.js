/**
 * Queries the streets that the user audited and visualizes them as segments on the map.
 * @param map Map on which the audited streets are rendered.
 * @param params Object that includes properties that can change the process of street rendering.
 * @param params.labelPopup {boolean} whether to include a validation popup on labels on the map.
 * @param params.streetColor {string} color to use for streets on the map.
 * @param streetData Data about streets that have been audited.
*/
function InitializeAuditedStreets(map, params, streetData) {
    let auditedStreetLayer;
    let distanceAudited = 0,  // Distance audited in km.
    streetLinestringStyle = {
        color: 'black',
        weight: 3,
        opacity: 0.75
    };

    function onEachStreetFeature(feature, layer) {
        if (feature.properties && feature.properties.type) {
            layer.bindPopup(feature.properties.type);
        }
        layer.on({
            'add': function () {
                layer.bringToBack()
            }
        })
    }
    // Render audited street segments.
    auditedStreetLayer = L.geoJson(streetData, {
        pointToLayer: L.mapbox.marker.style,
        style: function (feature) {
            let style = $.extend(true, {}, streetLinestringStyle);
            style.color = params.streetColor;
            style['stroke-width'] = 3;
            style.opacity = 0.75;
            style.weight = 3;
            return style;
        },
        onEachFeature: onEachStreetFeature
    })
        .addTo(map);
    if (params.useTotalAuditedDistance) {
        // Calculate total distance audited in kilometers/miles depending on the measurement system used in the user's country.
        for (let i = streetData.features.length - 1; i >= 0; i--) {
            distanceAudited += turf.length(streetData.features[i], {units: i18next.t('common:unit-distance')});
        }
        document.getElementById(params.progressElement).innerHTML = distanceAudited.toPrecision(2) + ' ' + i18next.t('common:unit-distance-abbreviation');
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
    }
    return auditedStreetLayer;
}
