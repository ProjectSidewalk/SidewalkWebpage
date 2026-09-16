// Map bounds for GeoJSON, shared by the map pages (via the ps-map bundle) and the API docs maps (by script tag).

/**
 * Returns the bounds enclosing a GeoJSON geometry, whatever its nesting depth (point through multi-polygon).
 * @param {GeoJSON.Geometry} geometry - The GeoJSON geometry.
 * @returns {mapboxgl.LngLatBounds} Bounds covering every coordinate in it.
 */
function geometryBounds(geometry) {
  const bounds = new mapboxgl.LngLatBounds();
  const extend = (coords) => {
    if (typeof coords[0] === 'number') bounds.extend(coords);
    else coords.forEach(extend);
  };
  extend(geometry.coordinates);
  return bounds;
}

/**
 * Returns the bounds enclosing every feature in a GeoJSON FeatureCollection.
 * @param {GeoJSON.FeatureCollection} featureCollection - The collection.
 * @returns {mapboxgl.LngLatBounds} Bounds covering all of its features.
 */
function featureCollectionBounds(featureCollection) {
  const bounds = new mapboxgl.LngLatBounds();
  for (const feature of featureCollection.features ?? []) bounds.extend(geometryBounds(feature.geometry));
  return bounds;
}
