/**
 * Project Sidewalk Statistics Aggregator
 *
 * This module fetches aggregated statistics from the Project Sidewalk API (/v3/api/aggregateStats) to populate the API
 * documentation landing page with real-time data.
 */

/**
 * Configuration object for the statistics aggregator.
 */
const CONFIG = {
    AGGREGATE_STATS_ENDPOINT: '/v3/api/aggregateStats',
    REQUEST_TIMEOUT: 10000, // 10 seconds
    RETRY_ATTEMPTS: 2,
    RETRY_DELAY: 1000 // 1 second
};

/**
 * Aggregated statistics data structure from the API.
 * @typedef {object} AggregatedStats
 * @property {string} status - API response status
 * @property {number} kmExplored - Total kilometers of streets assessed
 * @property {number} kmExploredNoOverlap - Total kilometers without overlap
 * @property {number} totalLabels - Total number of labels contributed
 * @property {number} totalValidations - Total number of validations
 * @property {number} numCities - Total number of deployed cities
 * @property {number} numCountries - Total number of countries
 * @property {number} numLanguages - Total number of supported languages
 * @property {object} byLabelType - Label statistics by type
 */

/**
 * Fetches data from a URL with timeout and retry logic.
 *
 * @param {string} url - The URL to fetch data from
 * @param {number} [timeout=CONFIG.REQUEST_TIMEOUT] - Request timeout in milliseconds
 * @param {number} [retries=CONFIG.RETRY_ATTEMPTS] - Number of retry attempts
 * @returns {Promise<Object>} The parsed JSON response
 * @throws {Error} When the request fails after all retries
 *
 * @example
 * const data = await fetchWithRetry('/v3/api/aggregateStats');
 */
async function fetchWithRetry(url, timeout = CONFIG.REQUEST_TIMEOUT, retries = CONFIG.RETRY_ATTEMPTS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        clearTimeout(timeoutId);

        if (retries > 0 && error.name !== 'AbortError') {
            console.warn(`Request failed, retrying... (${retries} attempts left)`, error.message);
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
            return fetchWithRetry(url, timeout, retries - 1);
        }

        throw error;
    }
}

/**
 * Fetches aggregated statistics from the Project Sidewalk API.
 *
 * @returns {Promise<AggregatedStats>} The aggregated statistics object
 * @throws {Error} When the API request fails or returns invalid data
 *
 * @example
 * const stats = await fetchAggregateStats();
 * console.log(`Total cities: ${stats.numCities}`);
 */
async function fetchAggregateStats() {
    try {
        const response = await fetchWithRetry(CONFIG.AGGREGATE_STATS_ENDPOINT);

        if (response.status !== 'OK') {
            throw new Error('Invalid response status from aggregate stats API');
        }

        // Validate that we have the expected fields
        const requiredFields = ['kmExplored', 'totalLabels', 'totalValidations', 'numCities', 'numCountries', 'numLanguages'];
        const missingFields = requiredFields.filter(field => typeof response[field] !== 'number');

        if (missingFields.length > 0) {
            throw new Error(`Missing or invalid fields in API response: ${missingFields.join(', ')}`);
        }

        return response;
    } catch (error) {
        console.error('Failed to fetch aggregate statistics:', error);
        throw new Error(`Unable to fetch aggregate statistics: ${error.message}`);
    }
}

/**
 * Formats numbers with appropriate units and thousands separators.
 *
 * @param {number} value - The number to format
 * @param {string} [unit=''] - Optional unit to append
 * @returns {string} Formatted number string
 *
 * @example
 * formatNumber(1234567) // "1,234,567"
 * formatNumber(1234.5, 'km') // "1,235 km"
 */
function formatNumber(value, unit = '') {
    const roundedValue = Math.round(value);
    const formattedValue = i18next.t('common:format-number', { val: roundedValue });
    return unit ? `${formattedValue} ${unit}` : formattedValue;
}

/**
 * Formats distance in both kilometers and miles.
 *
 * @param {number} kilometers - Distance in kilometers
 * @returns {string} Formatted distance string with both km and miles
 *
 * @example
 * formatDistance(1000) // "1,000 km (621 mi)"
 */
function formatDistance(kilometers) {
    const miles = util.math.kmsToMiles(kilometers);
    return `${formatNumber(kilometers, 'km')} (${formatNumber(miles, 'mi')})`;
}

/**
 * Updates the paragraph with aggregated statistics.
 *
 * @param {AggregatedStats} stats - The aggregated statistics object
 *
 * @example
 * updateStatsDisplay(aggregatedStats);
 */
function updateStatsDisplay(stats) {
    // Update main stats paragraph (API landing page).
    const mainTargetParagraph = document.getElementById('project-sidewalk-aggregate-stats');
    if (mainTargetParagraph) {
        mainTargetParagraph.innerHTML = `
            Join our movement that spans the globe. Working with local community groups and governmental partners,
            we have deployed Project Sidewalk in <strong>${stats.numCities} cities</strong> across
            <strong>${stats.numCountries} countries</strong> and <strong>${stats.numLanguages} natively translated
            languages</strong>, including Spanish, German, and Chinese. Together, our users have assessed
            over <strong>${formatDistance(stats.kmExplored)}</strong> of city streets,
            contributing <strong>${formatNumber(stats.totalLabels)} labels</strong> and
            <strong>${formatNumber(stats.totalValidations)} validations</strong>. This is more than just data;
            it's the foundation for more inclusive and accessible cities.
        `;
    }

    // Update cities page intro paragraph.
    const citiesTargetParagraph = document.getElementById('cities-deployment-stats');
    if (citiesTargetParagraph) {
        citiesTargetParagraph.innerHTML = `
            Project Sidewalk is deployed in <strong>${stats.numCities} cities</strong> across
            <strong>${stats.numCountries} countries</strong>. The Cities API lists all Project Sidewalk deployment
            sites, including the city's name, ID, and URL as well as geographic information such as the city center
            point <code>lat, lng</code> and bounding box.
        `;
    }
}

/**
 * Displays a loading state in target paragraphs.
 */
function showLoadingState() {
    const mainTargetParagraph = document.getElementById('project-sidewalk-aggregate-stats');
    if (mainTargetParagraph) {
        mainTargetParagraph.innerHTML = `<em>Loading Project Sidewalk statistics...</em>`;
    }

    const citiesTargetParagraph = document.getElementById('cities-deployment-stats');
    if (citiesTargetParagraph) {
        citiesTargetParagraph.innerHTML = `
            Project Sidewalk is deployed in multiple cities across several countries. The Cities API lists all Project
            Sidewalk deployment sites, including the city's name, ID, and URL as well as geographic information such as
            the city center point <code>lat, lng</code> and bounding box.
        `;
    }
}

/**
 * Displays an error state in target paragraphs with fallback content.
 *
 * @param {Error} error - The error object
 */
function showErrorState(error) {
    const mainTargetParagraph = document.getElementById('project-sidewalk-aggregate-stats');
    if (mainTargetParagraph) {
        mainTargetParagraph.innerHTML = `
            Working with local community groups and governmental partners, we have deployed Project Sidewalk in multiple
            cities across several countries and natively translated languages, including Spanish, German, and Chinese.
            Together, our users have assessed thousands of kilometers of city streets.
            <br><small><em>Note: Unable to load real-time statistics. ${error.message}</em></small>
        `;
    }

    const citiesTargetParagraph = document.getElementById('cities-deployment-stats');
    if (citiesTargetParagraph) {
        citiesTargetParagraph.innerHTML = `
            Project Sidewalk is deployed in multiple cities across several countries. The Cities API lists all Project
            Sidewalk deployment sites, including the city's name, ID, and URL as well as geographic information such as
            the city center point <code>lat, lng</code> and bounding box.
            <br><small><em>Note: Unable to load real-time statistics. ${error.message}</em></small>
        `;
    }
}

/**
 * Main function to load and display Project Sidewalk statistics aggregated statistics from the API.
 * @returns {Promise<void>}
 */
async function loadProjectSidewalkStats() {
    try {
        showLoadingState();
        const aggregatedStats = await fetchAggregateStats();
        updateStatsDisplay(aggregatedStats);
    } catch (error) {
        console.error('Failed to load Project Sidewalk statistics:', error);
        showErrorState(error);
    }
}

// Auto-initialize when translations are ready.
window.appManager.ready(function () {
    loadProjectSidewalkStats();
});
