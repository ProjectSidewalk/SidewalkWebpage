/**
 * The Mapbox map inside the mission-complete modal. It shows the streets the user worked on, split into three tiers
 * (the just-finished mission, the user's earlier missions, and everyone's community progress), plus the labels the user
 * placed during the mission. The view is framed to the streets from the mission that just finished.
 */
class ModalMissionCompleteMap {
    #mapPromise;
    #map = null;
    #labelLayerNames = [];

    // The three street tiers, drawn bottom-to-top. Colors come from CSS so the map matches the legend.
    static #STREET_TIERS = [
        { id: 'mc-street-community', colorVar: '--mc-line-community', width: 3 },
        { id: 'mc-street-previous', colorVar: '--mc-line-previous', width: 4 },
        { id: 'mc-street-this-mission', colorVar: '--mc-line-this-mission', width: 5 },
    ];

    /**
     * @param {string} mapContainerId HTML id of the element that holds the map.
     * @param {string} mapboxApiKey Mapbox API key.
     */
    constructor(mapContainerId, mapboxApiKey) {
        this.#mapPromise = this.#createMap(mapContainerId, mapboxApiKey);
    }

    /**
     * Creates the Mapbox map centered on the city and resolves once it has loaded.
     * @param {string} containerId HTML id of the map container.
     * @param {string} mapboxApiKey Mapbox API key.
     * @returns {Promise} Resolves with the loaded Mapbox map.
     */
    #createMap(containerId, mapboxApiKey) {
        return fetch('/cityMapParams', { headers: { Accept: 'application/json' } })
            .then((response) => response.json())
            .then((data) => {
                mapboxgl.accessToken = mapboxApiKey;
                const map = new mapboxgl.Map({
                    container: containerId,
                    style: 'mapbox://styles/mapbox/light-v11?optimize=true',
                    center: [data.city_center.lng, data.city_center.lat],
                    zoom: data.default_zoom,
                    minZoom: 10,
                    maxZoom: 19,
                    maxBounds: [
                        [data.southwest_boundary.lng, data.southwest_boundary.lat],
                        [data.northeast_boundary.lng, data.northeast_boundary.lat],
                    ],
                });
                map.addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }));
                map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');
                this.#map = map;
                return new Promise((resolve) => {
                    if (map.loaded()) resolve(map);
                    else map.on('load', () => resolve(map));
                });
            });
    }

    /**
     * Draws the street tiers and mission labels, then frames the just-finished mission's streets.
     * @param {object} streetTiers GeoJSON FeatureCollections keyed by tier: { thisMission, previous, community }.
     * @param {object} labelData GeoJSON FeatureCollection of labels placed during the mission.
     */
    async update(streetTiers, labelData) {
        const map = await this.#mapPromise;
        this.#clearLayers(map);

        const tierData = {
            'mc-street-community': streetTiers.community,
            'mc-street-previous': streetTiers.previous,
            'mc-street-this-mission': streetTiers.thisMission,
        };
        for (const tier of ModalMissionCompleteMap.#STREET_TIERS) {
            const color = getComputedStyle(document.documentElement).getPropertyValue(tier.colorVar).trim();
            map.addSource(tier.id, { type: 'geojson', data: tierData[tier.id] });
            map.addLayer({
                id: tier.id,
                type: 'line',
                source: tier.id,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': color, 'line-width': tier.width, 'line-opacity': 1 },
            });
        }

        // Reuse PSMap's label rendering so the dots match the label map. Mark labels as unvalidated so the default
        // filter shows them, and skip the high-quality filter (no param) since these are the user's own fresh labels.
        const mapData = await AddLabelsToMap(map, labelData, {});
        this.#labelLayerNames = Object.values(mapData.layerNames);

        this.#frameMission(map, streetTiers);
    }

    /** Resizes the map to its container, needed because the map is created while the modal is hidden. */
    resize() {
        this.#mapPromise.then((map) => map.resize());
    }

    /** Removes the street and label layers/sources from a previous mission so they can be re-added. */
    #clearLayers(map) {
        const layerIds = ModalMissionCompleteMap.#STREET_TIERS.map((tier) => tier.id).concat(this.#labelLayerNames);
        for (const layerId of layerIds) {
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            if (map.getSource(layerId)) map.removeSource(layerId);
        }
        this.#labelLayerNames = [];
    }

    /**
     * Fits the map to the streets from the just-finished mission, leaving room for the overlay cards. Falls back to all
     * worked streets if the mission tier is somehow empty.
     */
    #frameMission(map, streetTiers) {
        const target = streetTiers.thisMission.features.length
            ? streetTiers.thisMission
            : {
                    type: 'FeatureCollection',
                    features: [...streetTiers.previous.features, ...streetTiers.community.features],
                };
        if (!target.features.length) return;

        const scale = util.uiScale();
        map.fitBounds(turf.bbox(target), {
            padding: { top: 60 * scale, bottom: 30 * scale, left: 210 * scale, right: 210 * scale },
            animate: false,
        });
    }
}
