/**
 * Workaround: Mapillary's GraphDataProvider fails when getSpatialImages is called with more than 30 image IDs at once.
 * This subclass chunks requests into batches of 30 to avoid that limit.
 *
 * Implemented as a factory function so that the `mapillary` global is not accessed at bundle-load time — it's only
 * needed when actually using Mapillary, and other imagery providers don't load that library at all.
 */
function createMapillaryChunkedDataProvider(options) {
    const { GraphDataProvider } = mapillary;
    class MapillaryChunkedDataProvider extends GraphDataProvider {
        async getSpatialImages(imageIds) {
            const CHUNK_SIZE = 30;
            const chunks = [];
            for (let i = 0; i < imageIds.length; i += CHUNK_SIZE) {
                chunks.push(imageIds.slice(i, i + CHUNK_SIZE));
            }
            const results = await Promise.all(chunks.map(chunk => super.getSpatialImages(chunk)));
            return results.flat();
        }
    }
    return new MapillaryChunkedDataProvider(options);
}
