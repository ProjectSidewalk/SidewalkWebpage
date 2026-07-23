/**
 * Whole-route overview inset for the Explore minimap, shown only on designated (RouteBuilder) routes — where the full
 * ordered path is known up front. It renders the entire route (explored streets solid in the explored color, streets
 * ahead dashed in the ahead color) with a "you are here" marker and a box outlining the minimap's current zoomed
 * extent, so the user always sees the whole route alongside the street-level view — the way a game shows a world map
 * beside your local view. It sits in the upper-right corner, alongside the mini-legend. On a neighborhood audit the
 * route grows street-by-street, so there's nothing to preview and this stays hidden (#4639).
 *
 * It draws the route geometry the tool already has (svl.taskContainer) onto a small canvas — no second Google map — so
 * it's cheap to redraw whenever the peg moves or a street completes. Clicking it fits the minimap to the whole route
 * (the same action as the ⛶ button).
 */
class RouteOverview {
  /** @type {Tracker} */
  #tracker;
  /** @type {HTMLCanvasElement} */
  #canvas;
  /** @type {CanvasRenderingContext2D} */
  #ctx;
  /** @type {boolean} Only active on designated routes. */
  #enabled;

  /**
   * @param {Object} uiMinimap - The svl.ui.minimap object holding the minimap's jQuery DOM elements.
   * @param {Tracker} tracker - Interaction logger.
   */
  constructor(uiMinimap, tracker) {
    this.#tracker = tracker;
    this.#canvas = uiMinimap.routeOverviewCanvas[0];
    this.#ctx = this.#canvas.getContext('2d');
    this.#enabled = !!(svl.neighborhoodModel && svl.neighborhoodModel.isRoute);

    if (this.#enabled) {
      // Reveal the top-left overview inset (CSS keys off this holder class); the mini-legend stays in the bottom-left.
      uiMinimap.holder.addClass('minimap-route-mode');
      uiMinimap.routeOverview.on('click', () => {
        this.#tracker.push('Click_MinimapRouteOverview');
        svl.minimap.toggleOverview('route-inset');
      });
    }
  }

  /**
   * (Re)draws the whole-route overview. No-op off designated routes, before the map/tasks exist, or when the inset
   * has no displayed size (e.g. while the minimap is fitted to the route and the inset is hidden by CSS).
   */
  render() {
    if (!this.#enabled || !svl.taskContainer || !svl.panoViewer) return;
    const tasks = svl.taskContainer.getTasks();
    if (!tasks || tasks.length === 0) return;

    // Size the backing store to the displayed inset size (× dpr) so the lines stay crisp as the UI scales.
    const rect = this.#canvas.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.#canvas.width !== w * dpr || this.#canvas.height !== h * dpr) {
      this.#canvas.width = w * dpr;
      this.#canvas.height = h * dpr;
    }
    const ctx = this.#ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const project = this.#buildProjection(tasks, w, h, 8);
    if (!project) return;

    this.#drawRoute(ctx, tasks, project);
    this.#drawViewportBox(ctx, project);
    this.#drawYouAreHere(ctx, project);
  }

  /**
   * Builds a lng/lat → inset-pixel projection that fits every route street with uniform scale and padding. Longitude
   * is scaled by cos(latitude) so the route keeps its true shape at these latitudes.
   * @param {Task[]} tasks - The route's tasks (each carrying a LineString).
   * @param {number} w - Canvas width in CSS px.
   * @param {number} h - Canvas height in CSS px.
   * @param {number} pad - Padding in px keeping the route off the edges.
   * @returns {(function(number, number): number[])|null} project(lng, lat) → [x, y]; null if the route has no extent.
   */
  #buildProjection(tasks, w, h, pad) {
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const task of tasks) {
      for (const [lng, lat] of task.getGeoJSON().geometry.coordinates) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }
    if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;

    const cosLat = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
    const spanX = Math.max((maxLng - minLng) * cosLat, 1e-9);
    const spanY = Math.max(maxLat - minLat, 1e-9);
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
    const offX = (w - spanX * scale) / 2;
    const offY = (h - spanY * scale) / 2;
    // Flip Y: latitude increases northward (up), but canvas y increases downward.
    return (lng, lat) => [offX + (lng - minLng) * cosLat * scale, offY + (maxLat - lat) * scale];
  }

  /**
   * Strokes each route street: completed streets solid in the explored color, the rest dashed in the ahead color, each
   * over a white casing so the route reads on the muted basemap regardless of hue (matching the street-level route).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Task[]} tasks
   * @param {function(number, number): number[]} project
   */
  #drawRoute(ctx, tasks, project) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const task of tasks) {
      const coords = task.getGeoJSON().geometry.coordinates;
      if (coords.length < 2) continue;
      const done = task.isComplete();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = done ? 5 : 4.5;
      this.#tracePath(ctx, coords, project);
      ctx.setLineDash(done ? [] : [3, 3]);
      ctx.strokeStyle = done ? MinimapStyle.auditedColor() : MinimapStyle.remainingColor();
      ctx.lineWidth = done ? 3 : 2.5;
      this.#tracePath(ctx, coords, project);
    }
    ctx.setLineDash([]);
  }

  /**
   * Traces one street's LineString as a canvas path and strokes it with the current context style.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number[][]} coords - Array of [lng, lat] pairs.
   * @param {function(number, number): number[]} project
   */
  #tracePath(ctx, coords, project) {
    ctx.beginPath();
    for (let i = 0; i < coords.length; i++) {
      const [x, y] = project(coords[i][0], coords[i][1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /**
   * Outlines the geographic extent the main minimap currently shows, so the inset reads as a zoomed-out companion to
   * the street-level view ("you're looking at this part of the route"). Skipped until the map's bounds are ready.
   * @param {CanvasRenderingContext2D} ctx
   * @param {function(number, number): number[]} project
   */
  #drawViewportBox(ctx, project) {
    const map = svl.minimap && svl.minimap.getMap();
    const bounds = map && map.getBounds();
    if (!bounds) return;
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const [x1, y1] = project(sw.lng(), ne.lat()); // top-left corner of the viewport
    const [x2, y2] = project(ne.lng(), sw.lat()); // bottom-right corner
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.restore();
  }

  /**
   * Draws the "you are here" marker at the current pano: a white-cased blue dot with a heading wedge. The minimap is
   * north-up, so the wedge points up at heading 0 and rotates clockwise with the compass heading. The blue matches the
   * peg and the breadcrumb trail on the street-level view.
   * @param {CanvasRenderingContext2D} ctx
   * @param {function(number, number): number[]} project
   */
  #drawYouAreHere(ctx, project) {
    const pos = svl.panoViewer.getPosition();
    if (!pos) return;
    const [x, y] = project(pos.lng, pos.lat);
    const pov = svl.panoViewer.getPov();
    const heading = pov ? pov.heading : 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading * Math.PI / 180);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(-3.5, -3);
    ctx.lineTo(3.5, -3);
    ctx.closePath();
    ctx.fillStyle = MinimapStyle.pegColor();
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, 2 * Math.PI);
    ctx.fillStyle = MinimapStyle.pegColor();
    ctx.fill();
  }
}
