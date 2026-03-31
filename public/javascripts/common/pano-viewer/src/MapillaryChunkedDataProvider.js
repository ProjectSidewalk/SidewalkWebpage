/**
 * Workaround: Mapillary's GraphDataProvider fails when getSpatialImages is called with more than 30 image IDs at once.
 * This subclass chunks requests into batches of 30 to avoid that limit.
 */
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
