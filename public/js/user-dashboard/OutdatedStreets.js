/**
 * Wires the dashboard's "Streets with newer imagery" section (#4896): the mapper's own streets whose audits now
 * predate the imagery on them (#4384).
 *
 * The rows are server-rendered in dashboard.scala.html; this class only attaches behavior. Because a street has no
 * name to show — street_edge carries geometry, not a label — the rows lean on the contribution map above them for
 * identity: hovering or focusing a row highlights that street there.
 */
class OutdatedStreets {
  #list;
  #mapReady;
  #map = null;
  #highlighted = null;

  /**
   * @param {HTMLElement} listEl - The <ul> of street rows.
   * @param {Object} [opts] - Options.
   * @param {Promise<Object|null>} [opts.mapReady] - Resolves with the contribution map, or null if it failed to load.
   */
  constructor(listEl, opts = {}) {
    this.#list = listEl;
    this.#mapReady = opts.mapReady ?? Promise.resolve(null);
  }

  /** Attaches all row behaviors. */
  init() {
    this.#localizeDates();

    this.#list.querySelectorAll('.ud-reaudit-row').forEach((row) => {
      const streetEdgeId = Number(row.dataset.streetEdgeId);
      row.addEventListener('mouseenter', () => this.#highlight(streetEdgeId));
      row.addEventListener('mouseleave', () => this.#highlight(null));
      row.addEventListener('focusin', () => this.#highlight(streetEdgeId));
      row.addEventListener('focusout', () => this.#highlight(null));
    });

    this.#list.querySelectorAll('.ud-reaudit-explore').forEach((link) => {
      link.addEventListener('click', () => {
        window.logWebpageActivity(`Click_module=ReauditRevisit_streetEdgeId=${link.dataset.streetEdgeId}`);
      });
    });

    // Resolved lazily so a slow (or failed) map can never hold up the rest of the section's wiring; until it
    // lands, #highlight is a no-op and the rows simply don't brush the map.
    this.#mapReady
      .then((map) => {
        this.#map = map;
      })
      .catch(() => {
        this.#map = null;
      });
  }

  /**
   * Rewrites each row's audited-on date into the reader's own timezone.
   *
   * The server can only render a timestamp in UTC, which shows tomorrow's date for anything finished in the evening
   * west of Greenwich.
   */
  #localizeDates() {
    this.#list.querySelectorAll('.ud-reaudit-date').forEach((el) => {
      const auditedAt = new Date(el.dateTime);
      if (!Number.isNaN(auditedAt.getTime())) el.textContent = moment(auditedAt).format('ll');
    });
  }

  /**
   * Thickens one street on the contribution map, clearing whichever was thickened before.
   *
   * Reuses the map's own hover feature-state rather than a second styling path, so a row highlight and a pointer
   * highlight look identical. The source promotes street_edge_id to the feature id, so the row's id addresses it.
   *
   * @param {?number} streetEdgeId - The street to highlight, or null to clear.
   */
  #highlight(streetEdgeId) {
    if (!this.#map || this.#highlighted === streetEdgeId) return;
    if (this.#highlighted !== null) {
      this.#map.setFeatureState({ source: 'streets', id: this.#highlighted }, { hover: false });
    }
    if (streetEdgeId !== null) {
      this.#map.setFeatureState({ source: 'streets', id: streetEdgeId }, { hover: true });
    }
    this.#highlighted = streetEdgeId;
  }
}
