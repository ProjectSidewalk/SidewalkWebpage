/**
* This function queries the streets that the user audited and visualize them as segments on the map.
*/
function InitializeAuditedStreets(map, self, url, params) {
    var distanceAudited = 0,  // Distance audited in km
    streetLinestringStyle = {
        color: "black",
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

    $.getJSON(url, function (data) {
        // Render audited street segments
        self.auditedStreetLayer = L.geoJson(data, {
            pointToLayer: L.mapbox.marker.style,
            style: function (feature) {
                var style = $.extend(true, {}, streetLinestringStyle);
                style.color = params.choroplethType === 'labelMap' ? "#000" : "rgba(128, 128, 128, 1.0)";
                style["stroke-width"] = 3;
                style.opacity = 0.75;
                style.weight = 3;
                return style;
            },
            onEachFeature: onEachStreetFeature
        })
            .addTo(map);
        if (params.choroplethType === 'userDash' || params.choroplethType === 'adminUser') {
            // Calculate total distance audited in kilometers/miles depending on the measurement system used in the user's country.
            for (var i = data.features.length - 1; i >= 0; i--) {
                distanceAudited += turf.length(data.features[i], {units: i18next.t('common:unit-distance')});
            }
            document.getElementById(params.progressElement).innerHTML = distanceAudited.toPrecision(2) + " " + i18next.t("common:unit-abbreviation-distance-user-dashboard");
            // Get total reward if a turker
            if (params.userRole === 'Turker') {
                $.ajax({
                    async: true,
                    url: '/rewardEarned',
                    type: 'get',
                    success: function(rewardData) {
                        document.getElementById("td-total-reward-earned").innerHTML = "$" + rewardData.reward_earned.toFixed(2);
                    },
                    error: function (xhr, ajaxOptions, thrownError) {
                        console.log(thrownError);
                    }
                })
            }
        }
    });
}