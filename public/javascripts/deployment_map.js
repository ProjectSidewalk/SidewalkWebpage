/**
 * Project Sidewalk Deployment Map
 *
 * Creates an interactive MapBox map showing all Project Sidewalk deployment sites
 * as clickable circles. Each circle opens a popup with a link to explore that city.
 *
 * Dependencies:
 * - MapBox GL JS library
 * - deployment-map.css for styling
 *
 * Usage:
 * - Include this script after MapBox GL JS is loaded
 * - Ensure there's a div with id 'deployment-map' in your HTML
 * - Set your MapBox access token in the MAPBOX_ACCESS_TOKEN variable
 */

// API endpoint for cities data
const CITIES_API_URL = '/v3/api/cities';

// Map configuration
const MAP_CONFIG = {
    container: 'deployment-map',
    style: 'mapbox://styles/mapbox/light-v11',
    center: [-98.5, 39.8], // Center of USA
    zoom: 4,
    maxZoom: 18,
    minZoom: 2
};

// Circle styling configuration
const CIRCLE_CONFIG = {
    fillColor: '#78B9AB', // Project Sidewalk green
    fillOpacity: 0.7,
    strokeColor: '#548177',
    strokeWidth: 2,
    radius: 8,
    hoverFillColor: '#FBD78B', // Project Sidewalk yellow
    hoverStrokeColor: '#b8a06b'
};

let map;
let cities = [];

/**
 * Initialize the deployment map with the provided MapBox API key
 * Sets up the MapBox map and loads city data
 *
 * @param {string} mapboxApiKey - The MapBox access token
 * @throws {Error} If mapboxApiKey is not provided or is empty
 */
function initializeDeploymentMap(mapboxApiKey) {
    // Validate API key
    if (!mapboxApiKey || mapboxApiKey.trim() === '') {
        console.error('MapBox API key is required to initialize the deployment map');
        return;
    }

    mapboxgl.accessToken = mapboxApiKey;

    // Create the map
    map = new mapboxgl.Map(MAP_CONFIG);

    // Load cities data when map is ready
    map.on('load', function () {
        loadCitiesData();
    });
}

/**
 * Fetch cities data from the API
 * Handles API response and processes city data
 */
async function loadCitiesData() {
    try {
        const response = await fetch(CITIES_API_URL);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.status === 'OK' && data.cities) {
            cities = data.cities;
            addCitiesToMap();
        } else {
            console.error('Invalid API response format');
        }
    } catch (error) {
        console.error('Error loading cities data:', error);
        // TODO: Add user-friendly error message to the map
    }
}

/**
 * Add city markers to the map
 * Creates GeoJSON source and adds circle layers for each city
 */
function addCitiesToMap() {
    // Create GeoJSON data from cities
    const geojsonData = {
        type: 'FeatureCollection',
        features: cities.map(city => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [city.centerLng, city.centerLat]
            },
            properties: {
                cityId: city.cityId,
                cityNameShort: city.cityNameShort,
                cityNameFormatted: city.cityNameFormatted,
                url: city.url,
                visibility: city.visibility
            }
        }))
    };

    // Add source to map
    map.addSource('cities', {
        type: 'geojson',
        data: geojsonData,
        promoteId: 'cityId'  // Use cityId as the feature identifier for state management
    });

    // Add circle layer
    map.addLayer({
        id: 'cities-circles',
        type: 'circle',
        source: 'cities',
        paint: {
            'circle-radius': CIRCLE_CONFIG.radius,
            'circle-color': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                CIRCLE_CONFIG.hoverFillColor,
                CIRCLE_CONFIG.fillColor
            ],
            'circle-opacity': CIRCLE_CONFIG.fillOpacity,
            'circle-stroke-width': CIRCLE_CONFIG.strokeWidth,
            'circle-stroke-color': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                CIRCLE_CONFIG.hoverStrokeColor,
                CIRCLE_CONFIG.strokeColor
            ]
        }
    });

    // Add hover effects
    addHoverEffects();

    // Add click handlers
    addClickHandlers();

    // Fit map to show all cities
    fitMapToCities();
}

/**
 * Add hover effects to city circles
 * Changes circle appearance on mouse enter/leave
 */
/**
 * Add hover effects to city circles
 * Changes circle appearance on mouse enter/leave
 */
function addHoverEffects() {
    let hoveredCityId = null; // To keep track of the currently hovered city

    // Change cursor on hover and update feature state
    map.on('mouseenter', 'cities-circles', function (e) {
        map.getCanvas().style.cursor = 'pointer';

        if (e.features.length > 0) {
            if (hoveredCityId !== null) {
                // Reset the previously hovered feature's state
                map.setFeatureState(
                    {source: 'cities', id: hoveredCityId},
                    {hover: false}
                );
            }
            hoveredCityId = e.features[0].id;
            // Set the hover state for the current feature to true
            map.setFeatureState(
                {source: 'cities', id: hoveredCityId},
                {hover: true}
            );
        }
    });

    // Reset cursor and styling when leaving
    map.on('mouseleave', 'cities-circles', function () {
        map.getCanvas().style.cursor = '';

        if (hoveredCityId !== null) {
            // Reset the hover state for the previously hovered feature to false
            map.setFeatureState(
                {source: 'cities', id: hoveredCityId},
                {hover: false}
            );
        }
        hoveredCityId = null; // Clear the hovered city ID
    });
}

/**
 * Add click handlers for city circles
 * Opens popup with explore link when circle is clicked
 */
function addClickHandlers() {
    map.on('click', 'cities-circles', function (e) {
        const feature = e.features[0];
        const properties = feature.properties;
        const coordinates = feature.geometry.coordinates.slice();

        // Ensure popup appears over the feature clicked
        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }

        // Create popup content
        const popupContent = createPopupContent(properties);

        // Create and show popup
        new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: true,
            className: 'deployment-popup'
        })
            .setLngLat(coordinates)
            .setHTML(popupContent)
            .addTo(map);
    });
}

/**
 * Create HTML content for the popup
 *
 * @param {Object} properties - City properties from GeoJSON feature
 * @returns {string} HTML content for the popup
 */
function createPopupContent(properties) {
    const exploreUrl = `${properties.url}/explore`;

    return `
    <div class="popup-content">
      <h3 class="popup-title">${properties.cityNameFormatted}</h3>
      <a href="${exploreUrl}"
         class="popup-link"
         target="_blank"
         rel="noopener noreferrer">
        Explore ${properties.cityNameShort}
      </a>
    </div>
  `;
}

/**
 * Fit the map view to show all cities
 * Calculates bounds and adjusts map viewport
 */
function fitMapToCities() {
    if (cities.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();

    // Extend bounds to include all cities
    cities.forEach(city => {
        bounds.extend([city.centerLng, city.centerLat]);
    });

    // Fit map to bounds with padding
    map.fitBounds(bounds, {
        padding: 50,
        maxZoom: 10
    });
}

/**
 * Handle window resize events
 * Ensures map resizes properly with the browser window
 */
function handleResize() {
    if (map) {
        map.resize();
    }
}

// Initialize map when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeMap);

// Handle window resize
window.addEventListener('resize', handleResize);
