/**
 * Signals that a pano the provider still has did not finish loading within the viewer's deadline.
 *
 * Kept apart from NoImageryError on purpose (#5581). "Gone" is a fact about the pano and justifies dropping whatever
 * needed it; "slow" is a fact about this network, this CDN, this moment, and the same pano often loads on a second
 * try. Treated as "gone", a slow CDN drops valid labels from Validate missions and ends them at the "Imagery couldn't
 * be loaded" screen with the imagery still there.
 *
 * Only a viewer that has checked the pano still exists (or could not find out) throws this; a pano the provider says
 * is missing is a NoImageryError however long the load took.
 */
class PanoLoadTimeoutError extends Error {
  /**
   * @param {string} panoId - The pano that did not load.
   * @param {number} elapsedMs - How long the load ran before the viewer gave up on it.
   * @param {object} [options] - Standard Error options; `cause` carries the timeout the viewer hit.
   */
  constructor(panoId, elapsedMs, options) {
    super(`Pano ${panoId} did not load within ${elapsedMs} ms.`, options);
    this.name = 'PanoLoadTimeoutError';
    /** @type {string} */
    this.panoId = panoId;
    /** @type {number} */
    this.elapsedMs = elapsedMs;
  }
}
