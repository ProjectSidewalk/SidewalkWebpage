/**
 * Adds regions to the map and returns a promise.
 *
 * @param {mapboxgl.Map} map - The Mapbox map object.
 * @param {GeoJSON.FeatureCollection} regionGeoJSON - GeoJSON object containing region polygons to draw on the map.
 * @param {Array<Record<string, any>>} completionRates - Completion rates for each region.
 * @param {object} params - Properties that can change the process of choropleth creation.
 * @param {string} params.mapName - Name of the HTML ID of the map.
 * @param {string} [params.regionFillMode] - One of 'singleColor' or 'completionRate'.
 * @param {string} [params.regionTooltip='none'] - One of 'none' or 'completionRate'.
 * @param {boolean} [params.logClicks=true] - Whether clicks should be logged when it takes you to the explore page.
 * @param {string} [params.regionFillColor] - Fill color to use if regionFillMode='singleColor'.
 * @param {number} [params.regionFillOpacity] - Fill opacity to use if regionFillMode='singleColor'
 * @returns {Promise<void>} Promise that resolves when the regions have been added to the map.
 */
function addRegionsToMap(map, regionGeoJSON, completionRates, params) {
  const REGION_LAYER_NAME = 'region-polygons';
  const REGION_OUTLINE_LAYER_NAME = 'region-polygons-outline';

  // Add the completion rates, label counts, and styling info to the region GeoJSON.
  const isMetric = util.isMetric();
  for (const region of regionGeoJSON.features) {
    const compRate = completionRates.find((r) => {
      return r.region_id === region.properties.region_id;
    });
    region.properties.completionRate = Math.min(100, 100.0 * compRate.rate);
    region.properties.completed_distance_m = compRate.completed_distance_m;
    region.properties.total_distance_m = compRate.total_distance_m;
    region.properties.outdated_distance_m = compRate.outdated_distance_m || 0;
    region.dist_remaining_m = compRate.total_distance_m - compRate.completed_distance_m;
    if (isMetric) {
      region.properties.dist_remaining_converted = region.dist_remaining_m * 0.001; // Kilometers.
      region.properties.outdated_dist_converted = region.properties.outdated_distance_m * 0.001;
    } else {
      region.properties.dist_remaining_converted = region.dist_remaining_m * 0.000621371; // Miles.
      region.properties.outdated_dist_converted = region.properties.outdated_distance_m * 0.000621371;
    }

    // Compute fill color/opacity for each region.
    let regionStyle;
    if (params.regionFillMode === 'singleColor') {
      regionStyle = { fillColor: params.regionFillColor, fillOpacity: params.regionFillOpacity };
    } else if (params.regionFillMode === 'completionRate') {
      regionStyle = getRegionStyleFromCompletionRate(region.properties);
    }
    region.properties.fillColor = regionStyle.fillColor;
    region.properties.fillOpacity = regionStyle.fillOpacity;
  }

  initializeMapRegionPolygons();
  addRegionClickAndHoverEvents();

  // Return promise that is resolved once all the layers have been added to the map.
  return new Promise((resolve) => {
    if (map.getLayer(REGION_LAYER_NAME) && map.getLayer(REGION_OUTLINE_LAYER_NAME)) {
      resolve();
    } else {
      map.on('sourcedataloading', () => {
        if (map.getLayer(REGION_LAYER_NAME) && map.getLayer(REGION_OUTLINE_LAYER_NAME)) {
          resolve();
        }
      });
    }
  });

  // Renders the region polygons, colored by completion percentage.
  function initializeMapRegionPolygons() {
    // Add the region polygons to the map.
    map.addSource(REGION_LAYER_NAME, {
      type: 'geojson',
      data: regionGeoJSON,
      promoteId: 'region_id',
    });
    map.addLayer({
      id: REGION_LAYER_NAME,
      type: 'fill',
      source: REGION_LAYER_NAME,
      paint: {
        'fill-color': ['get', 'fillColor'],
        'fill-outline-color': ['get', 'fillColor'],
        'fill-opacity': ['get', 'fillOpacity'],
      },
    });
    // Need an extra line layer for the region outlines bc WebGL doesn't render outlines wider than width of 1.
    // https://github.com/mapbox/mapbox-gl-js/issues/3018#issuecomment-240381965
    map.addLayer({
      id: REGION_OUTLINE_LAYER_NAME,
      type: 'line',
      source: REGION_LAYER_NAME,
      paint: {
        'line-color': ['case',
          ['boolean', ['feature-state', 'hover'], false], '#000', '#888',
        ],
        'line-width': ['case',
          ['boolean', ['feature-state', 'hover'], false], 3, 1.5,
        ],
        'line-opacity': ['case',
          ['boolean', ['feature-state', 'hover'], false], 1.0, 0.25,
        ],
      },
    });
  }

  function addRegionClickAndHoverEvents() {
    let hoveredRegionId = null;
    let tooltipTimeout;

    const regionTooltip = new mapboxgl.Popup({ maxWidth: '300px', focusAfterOpen: false, closeOnClick: false });
    map.on('mousemove', REGION_LAYER_NAME, (event) => {
      const currRegion = event.features[0];
      let addOrUpdatePopup = false;
      if (hoveredRegionId && hoveredRegionId !== currRegion.properties.region_id) {
        map.setFeatureState({ source: REGION_LAYER_NAME, id: hoveredRegionId }, { hover: false });
        hoveredRegionId = currRegion.properties.region_id;
        map.setFeatureState({ source: REGION_LAYER_NAME, id: hoveredRegionId }, { hover: true });
        addOrUpdatePopup = true;
      } else if (!hoveredRegionId) {
        hoveredRegionId = currRegion.properties.region_id;
        map.setFeatureState({ source: REGION_LAYER_NAME, id: hoveredRegionId }, { hover: true });
        addOrUpdatePopup = true;
      }

      // Adds popup text, mouseover and click events, etc. to the region polygons.
      if (params.regionTooltip === 'completionRate' && addOrUpdatePopup) {
        let popupContent;
        const regionName = currRegion.properties.name;
        const url = `/explore?regionId=${hoveredRegionId}`;
        const compRate = currRegion.properties.completionRate;
        const compRateRounded = Math.floor(compRate);
        const distanceLeftRounded = Math.round(currRegion.properties.dist_remaining_converted);
        // The needs-re-audit annotation + CTA (#4384): completion keeps crediting streets whose audits predate newer
        // imagery, so a fully-explored region can still invite work. Shown whenever the re-audit distance
        // doesn't round away to zero.
        const outdatedConverted = currRegion.properties.outdated_dist_converted;
        const outdatedRounded = outdatedConverted < 10
          ? Math.round(outdatedConverted * 10) / 10
          : Math.round(outdatedConverted);
        const reauditLine = outdatedRounded > 0
          ? `${i18next.t('common:map.needs-reaudit', { n: outdatedRounded, interpolation: { escapeValue: true } })}<br>`
          : '';
        const reauditCta = i18next.t('common:map.click-to-reaudit', {
          url, regionId: hoveredRegionId, interpolation: { escapeValue: true },
        });
        if (currRegion.properties.user_completed) {
          popupContent = `<strong>${util.escapeHTML(regionName)}</strong>:
            ${i18next.t('common:map.100-percent-complete')}<br>
            ${i18next.t('common:map.thanks')}`;
          if (reauditLine) {
            popupContent += `<br>
            ${reauditLine}${reauditCta}`;
          }
        } else if (compRate === 100) {
          // A fully-audited region's CTA flips from "help finish" to "re-explore" when re-audits are the work left.
          const fullRegionCta = reauditLine
            ? `${reauditLine}${reauditCta}`
            : i18next.t('common:map.click-to-help', {
                url, regionId: hoveredRegionId, interpolation: { escapeValue: true },
              });
          popupContent = `<strong>${util.escapeHTML(regionName)}</strong>:
            ${i18next.t('common:map.100-percent-complete')}<br>
            ${fullRegionCta}`;
        } else if (distanceLeftRounded === 0) {
          popupContent = `<strong>${util.escapeHTML(regionName)}</strong>:
            ${i18next.t('common:map.percent-complete', {
              percent: compRateRounded, interpolation: { escapeValue: true },
            })}<br>
            ${i18next.t('common:map.less-than-one-unit-left')}<br>
            ${reauditLine}${i18next.t('common:map.click-to-help', {
              url, regionId: hoveredRegionId, interpolation: { escapeValue: true },
            })}`;
        } else {
          popupContent = `<strong>${util.escapeHTML(regionName)}</strong>:
            ${i18next.t('common:map.percent-complete', {
              percent: compRateRounded, interpolation: { escapeValue: true },
            })}<br>
            ${i18next.t('common:map.distance-left', {
              count: distanceLeftRounded, interpolation: { escapeValue: true },
            })}<br>
            ${reauditLine}${i18next.t('common:map.click-to-help', {
              url, regionId: hoveredRegionId, interpolation: { escapeValue: true },
            })}`;
        }

        // Set tooltip to center of region.
        regionTooltip.setHTML(popupContent);
        const regionCenter = turf.centerOfMass(currRegion).geometry.coordinates;
        regionTooltip.setLngLat({ lng: regionCenter[0], lat: regionCenter[1] }).addTo(map);

        // Clear timeout when entering a tooltip.
        regionTooltip._content.onmouseenter = function () {
          clearTimeout(tooltipTimeout);
        };

        // Remove the tooltip after a delay when the mouse leaves the tooltip.
        regionTooltip._content.onmouseleave = function () {
          tooltipTimeout = setTimeout(() => {
            map.setFeatureState({ source: REGION_LAYER_NAME, id: hoveredRegionId }, { hover: false });
            regionTooltip.remove();
            hoveredRegionId = null;
          }, 200);
        };

        // Make sure the region outline is removed when the popup close button is clicked.
        regionTooltip._content.querySelector('.mapboxgl-popup-close-button').onclick = function () {
          map.setFeatureState({ source: REGION_LAYER_NAME, id: hoveredRegionId }, { hover: false });
          regionTooltip.remove();
          hoveredRegionId = null;
        };
      }
    });

    // Remove region polygon outline when mouse no longer on any region.
    map.on('mouseleave', REGION_LAYER_NAME, (e) => {
      const pageLostFocus = !e.originalEvent || !e.originalEvent.toElement;
      const isOverTooltip = e.originalEvent && e.originalEvent.toElement
        && e.originalEvent.toElement.closest('.mapboxgl-popup');

      if (hoveredRegionId !== null && (pageLostFocus || !isOverTooltip)) {
        tooltipTimeout = setTimeout(() => {
          map.setFeatureState({ source: REGION_LAYER_NAME, id: hoveredRegionId }, { hover: false });
          regionTooltip.remove();
          hoveredRegionId = null;
        }, 500);
      }
    });

    // Clear the timeout if the mouse re-enters the region polygon.
    map.on('mouseenter', REGION_LAYER_NAME, () => {
      clearTimeout(tooltipTimeout);
    });

    if (params.logClicks) {
      // Logs to the webpage_activity table when a region is selected from the map and 'Click here' is clicked.
      // Log form: 'Click_module=<mapName>_regionId=<regionId>_distanceLeft=<'0', '<1', '1' or '>1'>
      //           _needsReaudit=<bool>_target=audit' (one string; wrapped here for line length).
      // needsReaudit says whether the region had streets flagged for re-audit (#4384) when clicked, so re-audit CTA
      // clicks can be distinguished from first-audit ones.
      // Delegated: popups are re-created as regions are clicked, so the listener lives on the map container.
      document.getElementById(params.mapName).addEventListener('click', (event) => {
        const trigger = /** @type {Element} */ (event.target).closest('.region-selection-trigger');
        if (!trigger) return;
        const regionId = parseInt(trigger.getAttribute('regionId'), 10);
        const region = regionGeoJSON.features.find((x) => {
          return regionId === x.properties.region_id;
        });
        const distanceLeftRounded = Math.round(region.properties.dist_remaining_converted);
        let distanceLeftStr;
        if (region.properties.completionRate === 100) distanceLeftStr = '0';
        else if (distanceLeftRounded === 0) distanceLeftStr = '<1';
        else if (distanceLeftRounded === 1) distanceLeftStr = '1';
        else distanceLeftStr = '>1';
        const needsReaudit = (region.properties.outdated_distance_m || 0) > 0;
        const activity = `Click_module=${params.mapName}_regionId=${regionId}`
          + `_distanceLeft=${distanceLeftStr}_needsReaudit=${needsReaudit}_target=audit`;
        window.logWebpageActivity(activity);
      });
    }
  }

  // Returns the color for a region based on a gradient.
  function getColorFromGradient(num, gradient) {
    for (const step in gradient) {
      if (num <= step) return gradient[step];
    }
  }

  /**
   * Finds the color for a region based on completion rate (used for landing page map).
   */
  function getRegionStyleFromCompletionRate(polygonData) {
    const regionColorGradient = {
      10: '#c6dbef',
      20: '#b3d3e8',
      30: '#9ecae1',
      40: '#82badb',
      50: '#6baed6',
      60: '#4292c6',
      70: '#2171b5',
      80: '#08719c',
      90: '#08519c',
      100: '#08306b',
    };
    const compRate = polygonData.completionRate;
    const complete = Math.abs(compRate - 100) < Number.EPSILON;
    return {
      fillColor: complete ? '#03152f' : getColorFromGradient(compRate, regionColorGradient),
      fillOpacity: 0.35 + (0.4 * compRate / 100),
    };
  }
}
