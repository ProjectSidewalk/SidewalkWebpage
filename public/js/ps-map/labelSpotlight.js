/**
 * The map center that makes `coords` render `dx`/`dy` pixels from the viewport center at `zoom`, via plain
 * web-mercator math. Computed by hand because mapbox's instant camera moves silently drop CameraOptions.offset
 * (jumpTo ignores it, and a zero-duration easeTo is treated as a jump) — so to drop a deep-linked dot into the
 * gutter beside the dialog without an animation, we shift the center ourselves instead of passing an offset.
 * @param {Array<number>} coords [lng, lat] to show.
 * @param {number} dx Horizontal pixel offset from the viewport center (positive puts `coords` right of center).
 * @param {number} dy Vertical pixel offset from the viewport center.
 * @param {number} zoom Target zoom (the mercator world size depends on it).
 * @returns {Array<number>} The [lng, lat] to pass as the map center.
 */
function centerShowingLabelAt(coords, dx, dy, zoom) {
  const worldSize = 512 * (2 ** zoom); // Mapbox GL's tile size is 512px.
  const sinLat = Math.sin(coords[1] * Math.PI / 180);
  const pxX = ((coords[0] + 180) / 360) * worldSize - dx;
  const pxY = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize - dy;
  const merc = Math.PI - 2 * Math.PI * (pxY / worldSize);
  return [(pxX / worldSize) * 360 - 180, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(merc) - Math.exp(-merc)))];
}

/**
 * Spotlight affordances tying the label popup to its label's dot on a Mapbox map (#4572): a beacon reticle over
 * the dot (one ring pulse on landing, one on close), camera placement that keeps the dot centered in the free
 * gutter beside the centered dialog, a chat-bubble tail connecting the dialog to the dot, and a sidebar-filter
 * bypass so a label the user explicitly asked to see can't be hidden by the active filters.
 *
 * @param {Object} host Page adapter.
 * @param {HTMLDialogElement} host.dialog The label popup's <dialog>.
 * @param {function(): ?Object} host.getMap Returns the Mapbox map once created (null/undefined before).
 * @param {function(): ?Object} host.getMapData Returns the map layer tracker from addLabelsToMap, used for the
 *     filter bypass (null/undefined before the label layers exist).
 * @param {function(number): ?Array<number>} host.getCoords Best known [lng, lat] for a label ID.
 * @param {function(number): ?string} host.getLabelType Best known label type for a label ID.
 * @returns {{spotlight: function(number, boolean=): void, pulse: function(number): void,
 *     updateTail: function(): void, spotlightedLabelId: function(): ?number}}
 *     `spotlight(labelId, jump)` beacons + positions the camera while the popup shows the label, `pulse(labelId)`
 *     flashes the dot once after the popup closes, `updateTail` repositions the tail (hosts call it on map
 *     'move'), and `spotlightedLabelId()` reports the currently spotlighted label (null when none).
 */
function createLabelSpotlight({ dialog, getMap, getMapData, getCoords, getLabelType }) {
  let spotlightedLabelId = null;

  // Marks `labelId` (or null) as exempt from the sidebar filters, so the dot a user explicitly asked to see
  // (deep link, arrow paging) can't be hidden by them — e.g. the default incorrect/low-quality exclusions
  // hide dots that Gallery deep links routinely point at. No-op until the label layers exist.
  const setSpotlightFilter = (labelId) => {
    const map = getMap();
    const mapData = getMapData();
    if (!map || !mapData || mapData.spotlightLabelId === labelId) return;
    mapData.spotlightLabelId = labelId;
    filterLabelLayers(null, map, mapData, true);
  };

  // Chat-bubble tail connecting the dialog to the spotlighted dot, so the pair visibly reads as one unit:
  // a triangle whose base sits on the dialog edge facing the dot and whose tip stops at the beacon's rim.
  // A fixed full-viewport SVG under the dialog's top layer, repositioned on every map/dialog change and
  // hidden while the dot is behind the dialog or off-screen.
  const tailSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tailSvg.setAttribute('class', 'labelmap-tail');
  const tailShape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  tailSvg.appendChild(tailShape);
  document.body.appendChild(tailSvg);
  let tailVisible = false;
  const hideTail = () => {
    if (!tailVisible) return;
    tailSvg.style.display = 'none';
    tailVisible = false;
  };
  // Hosts run this on every map 'move' frame, so the common no-spotlight state must bail before any DOM work.
  const updateTail = () => {
    const map = getMap();
    const coords = spotlightedLabelId && getCoords(spotlightedLabelId);
    if (!coords || !map || !dialog.open) {
      hideTail();
      return;
    }
    const mapRect = map.getContainer().getBoundingClientRect();
    const p = map.project(coords);
    const dot = { x: mapRect.left + p.x, y: mapRect.top + p.y };
    const r = dialog.getBoundingClientRect();
    const inDialog = dot.x >= r.left && dot.x <= r.right && dot.y >= r.top && dot.y <= r.bottom;
    const onScreen = dot.x >= 0 && dot.x <= window.innerWidth && dot.y >= 0 && dot.y <= window.innerHeight;
    if (inDialog || !onScreen) {
      hideTail();
      return;
    }
    // The base sits on whichever edge faces the dot — a horizontal one when it is above or below, which is the
    // narrow-viewport case. CORNER_MARGIN keeps the base clear of the dialog's rounded corners.
    const CORNER_MARGIN = 48;
    const HALF_BASE = 26;
    const onSide = dot.x < r.left || dot.x > r.right;
    const baseX = onSide
      ? (dot.x >= (r.left + r.right) / 2 ? r.right - 1 : r.left + 1)
      : Math.min(Math.max(dot.x, r.left + CORNER_MARGIN), r.right - CORNER_MARGIN);
    const baseY = onSide
      ? Math.min(Math.max(dot.y, r.top + CORNER_MARGIN), r.bottom - CORNER_MARGIN)
      : (dot.y >= (r.top + r.bottom) / 2 ? r.bottom - 1 : r.top + 1);
    const dx = dot.x - baseX;
    const dy = dot.y - baseY;
    const len = Math.hypot(dx, dy);
    if (len < 40) {
      hideTail(); // Too close for a triangle to read; the beacon alone marks it.
      return;
    }
    const tip = { x: dot.x - (dx / len) * 18, y: dot.y - (dy / len) * 18 }; // Stop at the beacon's rim.
    const spreadX = onSide ? 0 : HALF_BASE;
    const spreadY = onSide ? HALF_BASE : 0;
    const corner1 = `${baseX - spreadX},${baseY - spreadY}`;
    const corner2 = `${baseX + spreadX},${baseY + spreadY}`;
    tailShape.setAttribute('points', `${corner1} ${corner2} ${tip.x},${tip.y}`);
    if (!tailVisible) {
      tailSvg.style.display = 'block';
      tailVisible = true;
    }
  };
  new ResizeObserver(updateTail).observe(dialog);
  window.addEventListener('resize', updateTail);

  // A single reusable beacon marker over the label currently tied to the popup: a reticle whose center is
  // filled with the label type's canonical color, so the label reads even when the map's own dot is tiny
  // or would be filtered out. Each mode pulses its ring exactly once:
  //   'spotlight' — pulses on landing, then stays as a calm reticle while the popup is open
  //   'flash'     — one pulse then auto-remove, to re-anchor the user after the popup closes
  let beacon = null;
  let beaconTimer = null;
  const setBeacon = (labelId, mode) => {
    const coords = getCoords(labelId);
    if (!coords) return;
    if (beacon) beacon.remove();
    if (beaconTimer) {
      clearTimeout(beaconTimer);
      beaconTimer = null;
    }
    setSpotlightFilter(labelId);
    const el = document.createElement('div');
    el.className = `labelmap-beacon labelmap-beacon--${mode}`;
    const type = getLabelType(labelId);
    const fill = type && util.misc.getLabelColors()[type];
    if (fill) {
      const centerDot = document.createElement('div');
      centerDot.className = 'labelmap-beacon__dot';
      centerDot.style.background = fill.fillStyle;
      el.appendChild(centerDot);
    }
    beacon = new mapboxgl.Marker({ element: el }).setLngLat(coords).addTo(getMap());
    if (mode === 'flash') {
      beaconTimer = setTimeout(() => {
        if (beacon && beacon.getElement() === el) {
          beacon.remove();
          beacon = null;
        }
        setSpotlightFilter(null); // Re-hide a filtered-out dot only after the flash is done ringing it.
      }, 2600);
    }
  };

  // Spotlights the label the popup is showing: a beacon on its dot (one pulse on landing), placed in a free gutter
  // beside or below the centered dialog and tail-tied to it. Falls back to plain centering only when no gutter can
  // hold the beacon's pulse ring, which costs both affordances at once — the dot ends up under the dialog.
  const spotlight = (labelId, jump = false) => {
    const map = getMap();
    const coords = getCoords(labelId);
    if (!map || !coords) return;
    // Right gutter first; the left one is under the filter sidebar. Without the vertical fallback a narrow viewport
    // (a phone, or devtools docked beside the page) buries the dot under the dialog, losing beacon and tail at once.
    const MIN_GUTTER = 80;
    const rect = dialog.open ? dialog.getBoundingClientRect() : null;
    const gutterX = (window.innerWidth - (rect?.width || 650)) / 2;
    const gutterY = (window.innerHeight - (rect?.height || 0)) / 2;
    let dx = 0;
    let dy = 0;
    if (gutterX > MIN_GUTTER) dx = (window.innerWidth - gutterX) / 2;
    else if (gutterY > MIN_GUTTER) dy = (window.innerHeight - gutterY) / 2;
    const zoom = Math.max(map.getZoom(), 16);
    // Pre-shift the center by hand rather than passing CameraOptions.offset: a deep-link/paging jump must be
    // instant, and mapbox drops offset on instant moves (see centerShowingLabelAt), which would bury the dot —
    // and with it the beacon and tail — under the centered dialog. This keeps jump and ease placing identically.
    const camera = { center: centerShowingLabelAt(coords, dx, dy, zoom), zoom };
    if (jump) map.jumpTo(camera);
    else map.easeTo(camera);
    setBeacon(labelId, 'spotlight');
    spotlightedLabelId = labelId;
    updateTail();
  };

  // On popup close, leave a brief flash so the user is re-anchored to the dot they were viewing.
  const pulse = (labelId) => {
    spotlightedLabelId = null;
    updateTail();
    const map = getMap();
    const coords = getCoords(labelId);
    if (!map || !coords) return;
    if (!map.getBounds().contains(coords)) {
      map.easeTo({ center: coords, zoom: Math.max(map.getZoom(), 16) });
    }
    setBeacon(labelId, 'flash');
  };

  return { spotlight, pulse, updateTail, spotlightedLabelId: () => spotlightedLabelId };
}
