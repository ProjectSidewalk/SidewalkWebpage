/**
 * Adds polling locations to the map and returns a promise.
 *
 * @param map Map on which the streets are rendered.
 * @param {Object} map The Mapbox map object.
 * @param {Object} pollingLocationData - GeoJSON object containing polling locations to draw on the map.
 * @returns {Promise} Promise that resolves when the polling locations have been added to the map.
 */
function AddPollingLocationsToMap(map, pollingLocationData) {
    let layerName = `polling-locations`;

    // Add an image to use as a custom marker
    map.loadImage(
        '/assets/data/noun-place-vote-in-box-6339677.png',
        (error, image) => {
            if (error) throw error;
            map.addImage('custom-marker', image);

            map.addSource(layerName, {
                type: 'geojson',
                data: pollingLocationData,
                promoteId: 'label_id'
            });

            // Add a symbol layer
            map.addLayer({
                'id': layerName,
                'type': 'symbol',
                'source': layerName,
                'layout': {
                    'icon-image': 'custom-marker',
                    visibility: 'none' // Hide by default since this is just a pilot.
                }
            });
        }
    );

    // Return promise that is resolved once the polling location layer has been added to the map.
    // TODO, would like for this to be getLayer instead of getSource, but it's not working. Punting for pilot.
    return new Promise((resolve, reject) => {
        if (map.getSource(layerName)) {
            resolve();
        } else {
            map.on('sourcedataloading', function(e) {
                if (map.getSource(layerName)) {
                    resolve();
                }
            });
        }
    });
}
