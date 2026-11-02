/**
 * The clusters behind the scores, fetched once per region and shared by every surface that shows them (#5748): the
 * insights dock's photo strip and the street panel both read a region's `/v3/api/labelClusters` feed and the
 * `/label/id/:id` JSON of the labels they picture. A street is a filter over its region's clusters, and a city has
 * too many clusters to fetch for a dozen pictures, so the feed is cached per region for the page's life, and a
 * label's JSON for as long as nobody votes on it.
 */

/** @typedef {import('./AccessScoreClusterLayer.js').AccessScoreClusterProps} AccessScoreClusterProps */
/** @typedef {import('./AccessScoreModel.js').AccessScoreStreetExplanation} AccessScoreStreetExplanation */

/**
 * A cluster's properties with its position, as the feed hands them out.
 * @typedef {AccessScoreClusterProps & {coordinates: ?number[]}} AccessScoreFeedCluster
 */

export class AccessScoreClusterFeed {
  /**
   * Worst first: 3 is the bad end of both rating scales (unrated trails), then confirmed over unchecked over
   * disputed, then the more agreed, then `size` (a cluster's label count).
   * @param {{severity: ?number, agree: number, disagree: number, size?: number}} a - One entry's rating and votes.
   * @param {{severity: ?number, agree: number, disagree: number, size?: number}} b - The other's.
   * @returns {number} Negative when `a` ranks ahead of `b`.
   */
  static compareWorstFirst(a, b) {
    const verdict = (e) => Math.sign(e.agree - e.disagree);
    return (b.severity ?? 0) - (a.severity ?? 0)
      || verdict(b) - verdict(a)
      || b.agree - a.agree
      || (b.size ?? 0) - (a.size ?? 0);
  }

  /**
   * A cluster's rating and votes in the shape `compareWorstFirst` ranks.
   * @param {AccessScoreClusterProps} p - The cluster.
   * @returns {{severity: ?number, agree: number, disagree: number, size: number}}
   */
  static standing(p) {
    return {
      severity: p.median_severity, agree: p.agree_count || 0, disagree: p.disagree_count || 0, size: p.cluster_size,
    };
  }

  /**
   * The label that stands for a cluster until the feed carries one: its newest. Label ids are a serial, so the
   * highest is the latest placed.
   * @param {AccessScoreClusterProps} p - A cluster with `label_ids`.
   * @returns {number} A label id.
   */
  static newestLabelId(p) {
    return Math.max(...p.label_ids);
  }

  #types;
  /** @type {Map<number, Promise<AccessScoreFeedCluster[]>>} */
  #clustersByRegion = new Map();
  /** @type {Map<number, Promise<Record<string, any>>>} */
  #labelsById = new Map();

  /**
   * @param {object} options - Configuration.
   * @param {string[]} options.types - The scored label types the feed is asked for; an Occlusion cluster moves no
   *   score and would only be noise.
   */
  constructor({ types }) {
    this.#types = types;
  }

  /**
   * One region's scored clusters, fetched once. A failed fetch is not cached, so the next ask retries it.
   * @param {number} regionId - The region.
   * @returns {Promise<AccessScoreFeedCluster[]>} The clusters' properties, each with its point's `coordinates`.
   */
  regionClusters(regionId) {
    if (!this.#clustersByRegion.has(regionId)) {
      const url = new URL('/v3/api/labelClusters', window.location.origin);
      url.searchParams.set('labelType', this.#types.join(','));
      url.searchParams.set('regionId', String(regionId));
      const request = fetch(url).then((r) => {
        if (!r.ok) throw new Error(`labelClusters regionId=${regionId}: HTTP ${r.status}`);
        return r.json();
      }).then((fc) => (fc.features || []).map((f) => ({
        ...f.properties,
        // The point is what a viewport filter tests; it lives on the geometry, which the properties don't carry.
        coordinates: f.geometry?.coordinates ?? f.properties.coordinates ?? null,
      })));
      request.catch(() => this.#clustersByRegion.delete(regionId));
      this.#clustersByRegion.set(regionId, request);
    }
    return this.#clustersByRegion.get(regionId);
  }

  /**
   * The clusters a street's score is made of, in the three places the engine scores them: along the block, and at
   * the crossing at either end, where a corner cluster counts whichever street it sits on. A crossing with no
   * intersection (a dead end) has an empty list. Read from the street's own region's feed: a corner cluster across a
   * region boundary is out of reach, as it is for the photo strip.
   * @param {AccessScoreStreetExplanation} street - The street, from `explainStreet`.
   * @returns {Promise<{block: AccessScoreFeedCluster[], start: AccessScoreFeedCluster[],
   *   end: AccessScoreFeedCluster[]}>} Each list in the feed's order; the caller ranks them.
   */
  async forStreet(street) {
    const clusters = await this.regionClusters(street.regionId);
    const startId = street.startIntersection?.id ?? null;
    const endId = street.endIntersection?.id ?? null;
    const groups = { block: [], start: [], end: [] };
    for (const p of clusters) {
      const at = p.intersection_id ?? null;
      if (at !== null && at === startId) groups.start.push(p);
      else if (at !== null && at === endId) groups.end.push(p);
      else if (p.street_edge_id === street.streetId) groups.block.push(p);
    }
    return groups;
  }

  /**
   * One label's card data, fetched once.
   * @param {number} id - The label.
   * @returns {Promise<Record<string, any>>} Its `/label/id/:id` JSON.
   */
  label(id) {
    if (!this.#labelsById.has(id)) {
      const request = fetch(`/label/id/${id}`).then((r) => {
        if (!r.ok) throw new Error(`label ${id}: HTTP ${r.status}`);
        return r.json();
      });
      request.catch(() => this.#labelsById.delete(id));
      this.#labelsById.set(id, request);
    }
    return this.#labelsById.get(id);
  }

  /**
   * Keeps fresh label JSON (after a vote in the full card) for the next surface that asks.
   * @param {Record<string, any>} label - A `/label/id/:id` JSON.
   */
  rememberLabel(label) {
    this.#labelsById.set(label.label_id, Promise.resolve(label));
  }
}
