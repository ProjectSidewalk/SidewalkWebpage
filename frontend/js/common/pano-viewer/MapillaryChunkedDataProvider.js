/**
 * Workaround: Mapillary's GraphDataProvider fails when getSpatialImages is called with more than 30 image IDs at once.
 * This subclass chunks requests into batches of 30 to avoid that limit.
 *
 * A factory taking the base class rather than a subclass declared at module level, because the SDK only arrives
 * when MapillaryViewer fetches it (sdk/mapillary.js).
 * @param {typeof import('mapillary-js').GraphDataProvider} GraphDataProvider
 * @param {object} options - The provider's options, e.g. `accessToken`.
 * @returns {import('mapillary-js').GraphDataProvider}
 */
export function createMapillaryChunkedDataProvider(GraphDataProvider, options) {
  class MapillaryChunkedDataProvider extends GraphDataProvider {
    async getSpatialImages(imageIds) {
      const CHUNK_SIZE = 30;
      const chunks = [];
      for (let i = 0; i < imageIds.length; i += CHUNK_SIZE) {
        chunks.push(imageIds.slice(i, i + CHUNK_SIZE));
      }
      const results = await Promise.all(chunks.map((chunk) => super.getSpatialImages(chunk)));
      return results.flat();
    }
  }
  return new MapillaryChunkedDataProvider(options);
}
