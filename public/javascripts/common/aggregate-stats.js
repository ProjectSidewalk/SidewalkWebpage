/**
 * Project Sidewalk Statistics Aggregator
 *
 * This module fetches and aggregates statistics from multiple Project Sidewalk deployments
 * to populate the API documentation landing page with real-time data.
 *
 */

/**
 * Configuration object for the statistics aggregator
 */
const CONFIG = {
  CITIES_ENDPOINT: '/v3/api/cities',
  STATS_ENDPOINT: '/v3/api/overallStats',
  REQUEST_TIMEOUT: 10000, // 10 seconds
  MAX_CONCURRENT_REQUESTS: 5,
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY: 1000 // 1 second
};

/**
 * Aggregated statistics data structure
 * @typedef {Object} AggregatedStats
 * @property {number} totalCities - Total number of deployed cities
 * @property {number} totalCountries - Total number of countries
 * @property {number} totalLanguages - Total number of supported languages
 * @property {number} totalKmExplored - Total kilometers of streets assessed
 * @property {number} totalLabels - Total number of labels contributed
 * @property {number} totalValidations - Total number of validations
 */

/**
 * City data structure from the cities API
 * @typedef {Object} CityData
 * @property {string} cityId - Unique city identifier
 * @property {string} countryId - Country identifier
 * @property {string} cityNameShort - Short city name
 * @property {string} cityNameFormatted - Formatted city name
 * @property {string} url - City-specific deployment URL
 * @property {string} visibility - City visibility status
 */

/**
 * Statistics data structure from the overallStats API
 * @typedef {Object} StatsData
 * @property {number} kmExplored - Kilometers explored in this city
 * @property {number} totalLabels - Total labels in this city
 * @property {number} nValidations - Number of validations in this city
 */

/**
 * Fetches data from a URL with timeout and retry logic
 *
 * @param {string} url - The URL to fetch data from
 * @param {number} [timeout=CONFIG.REQUEST_TIMEOUT] - Request timeout in milliseconds
 * @param {number} [retries=CONFIG.RETRY_ATTEMPTS] - Number of retry attempts
 * @returns {Promise<Object>} The parsed JSON response
 * @throws {Error} When the request fails after all retries
 *
 * @example
 * const data = await fetchWithRetry('https://example.com/api/data');
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
 * Fetches the list of all Project Sidewalk cities
 *
 * @param {boolean} [includePrivate=false] - Whether to include private cities (defaults true)
 * @returns {Promise<CityData[]>} Array of city data objects
 * @throws {Error} When the cities API request fails
 *
 * @example
 * const cities = await fetchCities();
 * console.log(`Found ${cities.length} cities`);
 */
async function fetchCities(includePrivate = true) {
  try {
    const response = await fetchWithRetry(CONFIG.CITIES_ENDPOINT);

    if (response.status !== 'OK' || !Array.isArray(response.cities)) {
      throw new Error('Invalid response format from cities API');
    }

    // Consider filtering only public cities for statistics
    let cities = response.cities;
    if (!includePrivate) {
      cities = cities.filter(city => city.visibility === 'public');
    }
    return cities;
  } catch (error) {
    console.error('Failed to fetch cities:', error);
    throw new Error(`Unable to fetch cities data: ${error.message}`);
  }
}

/**
 * Fetches statistics for a specific city
 *
 * @param {CityData} city - The city data object
 * @returns {Promise<StatsData|null>} The statistics data or null if failed
 *
 * @example
 * const stats = await fetchCityStats(cityData);
 * if (stats) {
 *   console.log(`City has ${stats.totalLabels} labels`);
 * }
 */
async function fetchCityStats(city) {
  try {
    const statsUrl = `${city.url}${CONFIG.STATS_ENDPOINT}`;
    const stats = await fetchWithRetry(statsUrl);

    return {
      cityId: city.cityId,
      countryId: city.countryId,
      kmExplored: stats.kmExplored || 0,
      totalLabels: stats.totalLabels || 0,
      nValidations: stats.nValidations || 0
    };
  } catch (error) {
    console.warn(`Failed to fetch stats for ${city.cityNameFormatted}:`, error.message);
    return null;
  }
}

/**
 * Processes cities in batches to avoid overwhelming the servers
 *
 * @param {CityData[]} cities - Array of city data objects
 * @param {number} [batchSize=CONFIG.MAX_CONCURRENT_REQUESTS] - Number of concurrent requests
 * @returns {Promise<StatsData[]>} Array of statistics data (excluding failed requests)
 *
 * @example
 * const allStats = await fetchAllCityStats(cities);
 */
async function fetchAllCityStats(cities, batchSize = CONFIG.MAX_CONCURRENT_REQUESTS) {
  const results = [];

  for (let i = 0; i < cities.length; i += batchSize) {
    const batch = cities.slice(i, i + batchSize);
    const batchPromises = batch.map(city => fetchCityStats(city));

    try {
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(result => result !== null));
    } catch (error) {
      console.error(`Batch ${Math.floor(i / batchSize) + 1} failed:`, error);
    }
  }

  return results;
}

/**
 * Aggregates statistics from all cities
 *
 * @param {CityData[]} cities - Array of city data objects
 * @param {StatsData[]} statsData - Array of statistics data objects
 * @returns {AggregatedStats} Aggregated statistics across all cities
 *
 * @example
 * const aggregated = aggregateStatistics(cities, statsData);
 * console.log(`Total: ${aggregated.totalCities} cities`);
 */
function aggregateStatistics(cities, statsData) {
  // Calculate unique countries
  const uniqueCountries = new Set(cities.map(city => city.countryId));

  // Currently, five languages: English, Spanish, German, Chinese, and Dutch
  const estimatedLanguages = 5;

  // Aggregate numerical data
  const totalKmExplored = statsData.reduce((sum, stats) => sum + stats.kmExplored, 0);
  const totalLabels = statsData.reduce((sum, stats) => sum + stats.totalLabels, 0);
  const totalValidations = statsData.reduce((sum, stats) => sum + stats.nValidations, 0);

  return {
    totalCities: cities.length,
    totalCountries: uniqueCountries.size,
    totalLanguages: estimatedLanguages,
    totalKmExplored: Math.round(totalKmExplored),
    totalLabels: totalLabels,
    totalValidations: totalValidations
  };
}

/**
 * Formats numbers with appropriate units and thousands separators
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
  const formattedValue = roundedValue.toLocaleString();
  return unit ? `${formattedValue} ${unit}` : formattedValue;
}

/**
 * Updates the paragraph with aggregated statistics
 *
 * @param {AggregatedStats} stats - The aggregated statistics object
 *
 * @example
 * updateStatsDisplay(aggregatedStats);
 */
function updateStatsDisplay(stats) {
  const targetParagraph = document.getElementById('project-sidewalk-aggregate-stats');

  if (!targetParagraph) {
    console.error('Target paragraph with ID "project-sidewalk-aggregate-stats" not found');
    return;
  }

  // Update the paragraph content with real data
  targetParagraph.innerHTML = `
    Working with local community groups and governmental partners, we have deployed Project Sidewalk in
    <strong>${stats.totalCities} cities</strong> across <strong>${stats.totalCountries} countries</strong> and
    <strong>${stats.totalLanguages} natively translated languages</strong>, including Spanish, German, and Chinese.
    Together, our users have assessed over <strong>${formatNumber(stats.totalKmExplored, 'km')}</strong> of city streets,
    contributing <strong>${formatNumber(stats.totalLabels)} labels</strong> and
    <strong>${formatNumber(stats.totalValidations)} validations</strong>.
  `;
}

/**
 * Displays a loading state in the target paragraph
 */
function showLoadingState() {
  const targetParagraph = document.getElementById('project-sidewalk-aggregate-stats');

  if (targetParagraph) {
    targetParagraph.innerHTML = `
      <em>Loading Project Sidewalk statistics...</em>
    `;
  }
}

/**
 * Displays an error state in the target paragraph
 *
 * @param {Error} error - The error object
 */
function showErrorState(error) {
  const targetParagraph = document.getElementById('project-sidewalk-aggregate-stats');

  if (targetParagraph) {
    targetParagraph.innerHTML = `
      Working with local community groups and governmental partners, we have deployed Project Sidewalk in
      multiple cities across several countries and natively translated languages, including Spanish, German, and Chinese.
      Together, our users have assessed thousands of kilometers of city streets.
      <br><small><em>Note: Unable to load real-time statistics. ${error.message}</em></small>
    `;
  }
}

/**
 * Main function to load and display Project Sidewalk statistics
 *
 * This function orchestrates the entire process of fetching cities,
 * getting their statistics, aggregating the data, and updating the display.
 *
 * @returns {Promise<void>}
 *
 * @example
 * // Call this function when the page loads
 * loadProjectSidewalkStats();
 */
async function loadProjectSidewalkStats() {
  try {
    showLoadingState();

    console.log('Fetching Project Sidewalk cities...');
    const cities = await fetchCities();
    console.log(`Found ${cities.length} cities`);

    console.log('Fetching statistics for all cities...');
    const statsData = await fetchAllCityStats(cities);
    console.log(`Successfully fetched stats for ${statsData.length} cities`);

    console.log('Aggregating statistics...');
    const aggregatedStats = aggregateStatistics(cities, statsData);

    console.log('Updating display...');
    updateStatsDisplay(aggregatedStats);

    console.log('Project Sidewalk statistics loaded successfully:', aggregatedStats);

  } catch (error) {
    console.error('Failed to load Project Sidewalk statistics:', error);
    showErrorState(error);
  }
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadProjectSidewalkStats);
  } else {
    loadProjectSidewalkStats();
  }
}
