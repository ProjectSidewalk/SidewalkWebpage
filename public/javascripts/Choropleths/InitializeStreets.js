/**
 * Takes a map and a set of streets, and visualizes them as segments on the map.
 * @param map Map on which the streets are rendered.
 * @param params Object that includes properties that can change the process of street rendering.
 * @param params.labelPopup {boolean} whether to include a validation popup on labels on the map.
 * @param params.differentiateUnauditedStreets {boolean} whether to color unaudited streets differently.
 * @param params.interactiveStreets {boolean} whether to include hover/click interactions on the streets.
 * @param params.mapName {string} name of the HTML ID for the map.
 * @param params.logClicks {boolean} whether to log clicks on the link to explore a street.
 * @param streetData Data about streets to visualize.
*/
function InitializeStreets(map, params, streetData) {

    // Render street segments.
    let layerName = 'streets';
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
            'line-color': [ // Grey if unaudited, black if audited. All black if the map doesn't differentiate.
                'case', ['all', params.differentiateUnauditedStreets, ['==', ['get', 'audited'], false]],
                'grey',
                'black'
            ],
            'line-width': [ // Twice the thickness if hovered. Increase thickness as we zoom in.
                'interpolate', ['linear'], ['zoom'],
                12, ['case', ['boolean', ['feature-state', 'hover'], false], 3, 1.5 ],
                15, ['case', ['boolean', ['feature-state', 'hover'], false], 8, 4 ]
            ]
        }
    });

    if (params.interactiveStreets) {
        // Add click functionality to the streets.
        const streetPopup = new mapboxgl.Popup({ focusAfterOpen: false });
        map.on('click', layerName, (event) => {
            let popupContent = i18next.t('common:explore-street-link', { streetId: event.features[0].properties.street_edge_id });
            streetPopup.setLngLat(event.lngLat).setHTML(popupContent).addTo(map);
        });

        // Add hover functionality to the streets.
        let hoveredStreet = null;
        map.on('mousemove', layerName, (event) => {
            let currStreet = event.features[0];
            if (hoveredStreet && hoveredStreet.properties.street_edge_id !== currStreet.properties.street_edge_id) {
                map.setFeatureState({ source: hoveredStreet.layer.id, id: hoveredStreet.properties.street_edge_id }, { hover: false });
                map.setFeatureState({ source: currStreet.layer.id, id: currStreet.properties.street_edge_id }, { hover: true });
                hoveredStreet = currStreet;
            } else if (!hoveredStreet) {
                map.setFeatureState({ source: currStreet.layer.id, id: currStreet.properties.street_edge_id }, { hover: true });
                hoveredStreet = currStreet;
                document.querySelector('.mapboxgl-canvas').style.cursor = 'pointer';
            }
        });
        map.on('mouseleave', layerName, (event) => {
            map.setFeatureState({ source: hoveredStreet.layer.id, id: hoveredStreet.properties.street_edge_id }, { hover: false });
            hoveredStreet = null;
            document.querySelector('.mapboxgl-canvas').style.cursor = '';
        });

        // Log clicks on the link to explore a street.
        if (params.logClicks) {
            // Log to the webpage_activity table when a street is selected from the map and 'Click here' is clicked.
            // Logs are of the form 'Click_module=<mapName>_streetId=<streetId>_audited=<boolean>_target=explore'.
            $(`#${params.mapName}`).on('click', '.street-selection-trigger', function () {
                let streetId = parseInt($(this).attr('streetId'));
                let street = streetData.features.find(s => streetId === s.properties.street_edge_id);
                let activity = `Click_module=${params.mapName}_streetId=${streetId}_audited=${street.properties.audited}_target=explore`;
                map.logWebpageActivity(activity);
            });
        }
    }

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
