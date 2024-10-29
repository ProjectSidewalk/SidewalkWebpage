/**
 * Adds streets to the map and returns a promise.
 *
 * @param map Map on which the streets are rendered.
 * @param {Object} map The Mapbox map object.
 * @param {Object} streetData - GeoJSON object containing streets to draw on the map.
 * @param {Object} params - Properties that can change the process of choropleth creation.
 * @param {string} params.mapName - Name of the HTML ID of the map.
 * @param {boolean} [params.logClicks=true] - Whether clicks should be logged when it takes you to the explore page.
 * @param {boolean} [params.differentiateUnauditedStreets=false] - Whether to color unaudited streets differently.
 * @param {boolean} [params.interactiveStreets=false] - Whether to include hover/click interactions on the streets.
 * @returns {Promise} Promise that resolves when the streets have been added to the map.
*/
function AddStreetsToMap(map, streetData, params) {
    const STREET_LAYER_NAME = 'streets';
    const AUDITED_STREET_COLOR = 'black';
    const UNAUDITED_STREET_COLOR = 'grey';

    // Render street segments.
    map.addSource(STREET_LAYER_NAME, {
        type: 'geojson',
        data: streetData,
        promoteId: 'street_edge_id'
    });
    map.addLayer({
        id: STREET_LAYER_NAME,
        type: 'line',
        source: STREET_LAYER_NAME,
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-opacity': 0.75,
            'line-color': [ // Grey if unaudited, black if audited. All black if the map doesn't differentiate.
                'case', ['all', params.differentiateUnauditedStreets, ['==', ['get', 'audited'], false]],
                UNAUDITED_STREET_COLOR,
                AUDITED_STREET_COLOR
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
        map.on('click', STREET_LAYER_NAME, (event) => {
            let popupContent = i18next.t('common:explore-street-link', { streetId: event.features[0].properties.street_edge_id });
            streetPopup.setLngLat(event.lngLat).setHTML(popupContent).addTo(map);
        });

        // Add hover functionality to the streets.
        let hoveredStreet = null;
        map.on('mousemove', STREET_LAYER_NAME, (event) => {
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
        map.on('mouseleave', STREET_LAYER_NAME, (event) => {
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

    // Return promise that is resolved once all the layers have been added to the map.
    return new Promise((resolve, reject) => {
        if (map.getLayer(STREET_LAYER_NAME)) {
            resolve();
        } else {
            map.on('sourcedataloading', function(e) {
                if (map.getLayer(STREET_LAYER_NAME)) {
                    resolve();
                }
            });
        }
    });
}
