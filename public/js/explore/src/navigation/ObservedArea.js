/**
 * Tracks and renders the user's observed area on the minimap: the fog of war, the current field-of-view cone, and the
 * 360°-observed progress ring around the position marker. Also owns the first-run "turn 360°" coach mark and the
 * one-time celebration when a user first completes a full 360° (#4639).
 */
class ObservedArea {
  static #BASE_RADIUS = 40;  // FOV radius in pixels at UI scale 1 and REFERENCE_ZOOM.

  // Zoom the minimap was tuned at; BASE_RADIUS is correct here. As the user zooms the minimap, the observed-area
  // radius is scaled by 2^(zoom - REFERENCE_ZOOM) so the fog/FOV keep covering the same geographic area. Must match
  // Minimap's default zoom.
  static #REFERENCE_ZOOM = 18;

  #uiMinimap;

  #angle = null;            // User's angle.
  #leftAngle = null;        // Left-most angle of the user's FOV.
  #rightAngle = null;       // Right-most angle of the user's FOV.
  #observedAreas = [];     // List of observed areas (panoId, latLng, minAngle, maxAngle).
  #currArea = {};             // Current observed area (panoId, latLng, minAngle, maxAngle).
  #fractionObserved = 0; // User's current fraction of 360 degrees observed.
  #coachVisible = false; // Whether the first-run "turn 360°" coach mark is currently showing.

  // Minimap size (px) at UI scale 1, read from the base dimension defined in svl-minimap.css.
  #baseSize;

  // The canvas bitmaps are kept in sync with the displayed minimap size (which scales with the UI). This is required
  // because the fog is positioned via the map's projection, which returns coordinates in displayed pixels; if the
  // bitmap didn't match, the fog would be offset (e.g. drawn at displayed/2 inside a smaller bitmap).
  #width = 0;          // Canvas bitmap width (set by #syncCanvasSize).
  #height = 0;         // Canvas bitmap height.
  #scaleFactor = 1;    // width / baseSize; scales the FOV/progress geometry to match the minimap.

  // Canvas contexts for the various components of the fog of war view on the mini map.
  #fogOfWarCtx;
  #fovCtx;
  #progressCircleCtx;

  /**
   * @param {Object} uiMinimap - The svl.ui.minimap object holding the minimap's jQuery DOM elements.
   */
  constructor(uiMinimap) {
    this.#uiMinimap = uiMinimap;
    this.#baseSize = parseFloat(getComputedStyle(uiMinimap.holder[0]).getPropertyValue('--minimap-base-size'));
    this.#fogOfWarCtx = uiMinimap.fogOfWar[0].getContext('2d');
    this.#fovCtx = uiMinimap.fov[0].getContext('2d');
    this.#progressCircleCtx = uiMinimap.progressCircle[0].getContext('2d');
    this.#syncCanvasSize();
    uiMinimap.coachDismiss.on('click', () => this.#dismissCoach('Click_MinimapCoach_GotIt'));
  }

  /**
   * Sizes the three minimap canvases' bitmaps to the current displayed minimap size and (re)applies the persistent
   * context state. Setting canvas.width/height resets the context, so the styles must be applied here, after sizing.
   */
  #syncCanvasSize() {
    const uiMinimap = this.#uiMinimap;
    const displayedWidth = Math.round(uiMinimap.fogOfWar.width()) || this.#baseSize;
    const displayedHeight = Math.round(uiMinimap.fogOfWar.height()) || this.#baseSize;
    if (displayedWidth !== this.#width || displayedHeight !== this.#height) {
      this.#width = displayedWidth;
      this.#height = displayedHeight;
      this.#scaleFactor = this.#width / this.#baseSize;
      for (const canvas of [uiMinimap.fogOfWar[0], uiMinimap.fov[0], uiMinimap.progressCircle[0]]) {
        canvas.width = this.#width;
        canvas.height = this.#height;
      }
    }
    // Set up ctx state that doesn't change between renders (and is reset by any resize above). The small blur keeps
    // a near-crisp seen/unseen frontier — the point of the fog is to make "not yet viewed" obvious (#4639).
    this.#fogOfWarCtx.fillStyle = MinimapStyle.fogColor();
    this.#fogOfWarCtx.filter = `blur(${2 * this.#scaleFactor}px)`;
    this.#progressCircleCtx.lineCap = 'round';
  }

  /**
   * Resets the user's angle and adds user's new pano to 'observedAreas'. Called when the user takes a step.
   */
  panoChanged() {
    this.#angle = null;
    this.#leftAngle = null;
    this.#rightAngle = null;
    const panoId = svl.panoViewer.getPanoId();
    this.#currArea = this.#observedAreas.find((area) => area.panoId === panoId);

    if (!this.#currArea) {
      this.#currArea = { panoId, latLng: svl.panoViewer.getPosition(), minAngle: null, maxAngle: null };
      this.#observedAreas.push(this.#currArea);
    }
  }

  /**
   * Converts degrees to radians.
   * @param {number} degrees
   * @returns {number}
   */
  static #toRadians(degrees) {
    return degrees / 180 * Math.PI;
  }

  /**
   * Updates all the angle variables necessary to keep track of the user's observed area.
   */
  #updateAngles() {
    const pov = svl.panoViewer.getPov();
    let heading = pov.heading;
    const fov = util.pano.zoomToFov(pov.zoom);
    if (this.#angle) {
      if (heading - this.#angle > 180) {
        heading -= 360;
      }
      if (heading - this.#angle < -180) {
        heading += 360;
      }
    }
    this.#angle = heading;
    this.#leftAngle = this.#angle - fov / 2;
    this.#rightAngle = this.#angle + fov / 2;
    if (!this.#currArea.minAngle || this.#leftAngle < this.#currArea.minAngle) {
      this.#currArea.minAngle = this.#leftAngle;
    }
    if (!this.#currArea.maxAngle || this.#rightAngle > this.#currArea.maxAngle) {
      this.#currArea.maxAngle = this.#rightAngle;
    }
    this.#fractionObserved = Math.min(this.#currArea.maxAngle - this.#currArea.minAngle, 360) / 360;
  }

  /**
   * Converts a latitude and longitude to pixel xy-coordinates.
   * @param {{lat: number, lng: number}} latLng
   * @returns {{x: number, y: number}}
   */
  #latLngToPixel(latLng) {
    const projection = svl.minimap.getMap().getProjection();
    const bounds = svl.minimap.getMap().getBounds();
    const topRight = projection.fromLatLngToPoint(bounds.getNorthEast());
    const bottomLeft = projection.fromLatLngToPoint(bounds.getSouthWest());
    const scale = Math.pow(2, svl.minimap.getMap().getZoom());
    const worldPoint = projection.fromLatLngToPoint(latLng);
    return {
      x: Math.floor((worldPoint.x - bottomLeft.x) * scale),
      y: Math.floor((worldPoint.y - topRight.y) * scale),
    };
  }

  /**
   * Returns the FOV/observed-area radius in pixels for the minimap's current zoom. Scales BASE_RADIUS by the UI scale
   * and by the zoom relative to REFERENCE_ZOOM so the fog/FOV cover a constant geographic area as the user zooms.
   * @returns {number}
   */
  #currentRadius() {
    const zoom = svl.minimap.getMap().getZoom();
    return ObservedArea.#BASE_RADIUS * this.#scaleFactor * Math.pow(2, zoom - ObservedArea.#REFERENCE_ZOOM);
  }

  /**
   * Renders the fog of war.
   */
  #renderFogOfWar() {
    const radius = this.#currentRadius();
    this.#fogOfWarCtx.fillRect(0, 0, this.#width, this.#height);
    this.#fogOfWarCtx.globalCompositeOperation = 'destination-out';
    for (const observedArea of this.#observedAreas) {
      const center = this.#latLngToPixel(observedArea.latLng);
      this.#fogOfWarCtx.beginPath();
      if (observedArea.maxAngle - observedArea.minAngle < 360) {
        this.#fogOfWarCtx.moveTo(center.x, center.y);
      }
      this.#fogOfWarCtx.arc(center.x, center.y, radius,
        ObservedArea.#toRadians(observedArea.minAngle - 90), ObservedArea.#toRadians(observedArea.maxAngle - 90));
      this.#fogOfWarCtx.fill();
    }
    // Always keep the peg fully clear of fog, no matter how far the user has turned.
    this.#fogOfWarCtx.beginPath();
    this.#fogOfWarCtx.arc(this.#width / 2, this.#height / 2, 8 * this.#scaleFactor, 0, 2 * Math.PI);
    this.#fogOfWarCtx.fill();
    this.#fogOfWarCtx.globalCompositeOperation = 'source-over';
  }

  /**
   * Renders the user's FOV as a cone with a radial falloff, so panning feels like sweeping a beam across the map.
   */
  #renderFov() {
    const centerX = this.#width / 2;
    const centerY = this.#height / 2;
    const radius = this.#currentRadius();
    const { r, g, b } = MinimapStyle.coneRgb();
    const gradient = this.#fovCtx.createRadialGradient(centerX, centerY, radius * 0.1, centerX, centerY, radius);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.55)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

    this.#fovCtx.clearRect(0, 0, this.#width, this.#height);
    this.#fovCtx.fillStyle = gradient;
    this.#fovCtx.beginPath();
    this.#fovCtx.moveTo(centerX, centerY);
    this.#fovCtx.arc(centerX, centerY, radius,
      ObservedArea.#toRadians(this.#leftAngle - 90), ObservedArea.#toRadians(this.#rightAngle - 90));
    this.#fovCtx.fill();
  }

  /**
   * Draws a small faded-blue ring at each visited pano (skipping the current one, which the peg marks) — a breadcrumb
   * trail, in the peg's own hue, of where the user has been — then clears a hole at the peg so neither the cone nor the
   * rings occlude it. Rendered on the FOV canvas, on top of the cone (#4639).
   */
  #renderVisitedPanos() {
    const ctx = this.#fovCtx;
    const radius = 3.5 * this.#scaleFactor;
    // Full opacity (the FOV canvas already carries a 0.8 CSS opacity, so this reads as solid) so the trail stays clear.
    ctx.lineWidth = 1.4 * this.#scaleFactor;
    ctx.strokeStyle = 'rgb(62, 139, 217)';
    for (const observedArea of this.#observedAreas) {
      if (observedArea === this.#currArea) continue;
      const center = this.#latLngToPixel(observedArea.latLng);
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
    // Keep the peg (canvas center) clear of the cone and the visited dots.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(this.#width / 2, this.#height / 2, 8 * this.#scaleFactor, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Renders the 360°-observed progress ring around the position marker (the map stays centered on the current pano,
   * so the marker is at the canvas center). A faint full-circle track shows the goal; the arc fills as the user turns
   * and switches to the success color at 100%.
   */
  #renderProgressCircle() {
    const ctx = this.#progressCircleCtx;
    // Top-right corner; the ring sits on a white disc (chip-like) with the percentage label centered inside it.
    const centerX = this.#width - 18 * this.#scaleFactor;
    const centerY = 18 * this.#scaleFactor;
    const radius = 12 * this.#scaleFactor;

    ctx.clearRect(0, 0, this.#width, this.#height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 15 * this.#scaleFactor, 0, 2 * Math.PI);
    ctx.fill();

    ctx.lineWidth = 2.5 * this.#scaleFactor;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();

    if (this.#fractionObserved > 0) {
      // Plain progress gauge filling clockwise from 12 o'clock; pine while in progress, success color at 100%.
      ctx.strokeStyle = this.#fractionObserved === 1 ? MinimapStyle.ringCompleteColor() : MinimapStyle.ringColor();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius,
        ObservedArea.#toRadians(-90), ObservedArea.#toRadians(this.#fractionObserved * 360 - 90));
      ctx.stroke();
    }
  }

  /**
   * Returns the user's current fraction of 360 degrees observed.
   * @returns {number}
   */
  getFractionObserved() {
    return this.#fractionObserved;
  }

  /**
   * Shows the first-run coach mark unless the user has already dismissed it (or plainly doesn't need it). Replaces
   * the old always-on minimap banner (#4639).
   */
  #maybeShowCoach() {
    if (this.#coachVisible || svl.isOnboarding() || svl.storage.get('minimapCoachDismissed')) return;
    // Users with a completed mission long ago learned the 360° habit; don't teach them again.
    if (svl.userHasCompletedAMission) {
      svl.storage.set('minimapCoachDismissed', true);
      return;
    }
    this.#coachVisible = true;
    this.#uiMinimap.coach.removeClass('minimap-coach-hidden');
    svl.tracker.push('MinimapCoach_Shown');
  }

  /**
   * Hides the coach mark and remembers the dismissal so it never shows again.
   * @param {string} logEvent - Tracker event name recording how it was dismissed.
   */
  #dismissCoach(logEvent) {
    if (!this.#coachVisible) return;
    this.#coachVisible = false;
    svl.storage.set('minimapCoachDismissed', true);
    this.#uiMinimap.coach.addClass('minimap-coach-hidden');
    svl.tracker.push(logEvent);
  }

  /**
   * One-time celebration the first time the user ever observes a full 360°: an expanding ring pulse around the
   * position marker (skipped under prefers-reduced-motion).
   */
  #maybeCelebrate() {
    if (svl.storage.get('minimap360Celebrated')) return;
    svl.storage.set('minimap360Celebrated', true);
    svl.tracker.push('Minimap360Celebration_Shown');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const start = performance.now();
    const { r, g, b } = MinimapStyle.coneRgb();
    const animate = (now) => {
      const t = (now - start) / 800;
      this.#renderProgressCircle(); // Clears the canvas, so redraw the ring under each pulse frame.
      if (t >= 1) return;
      const ctx = this.#progressCircleCtx;
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.8 * (1 - t)})`;
      ctx.lineWidth = 2.5 * this.#scaleFactor;
      ctx.beginPath();
      ctx.arc(this.#width - 18 * this.#scaleFactor, 18 * this.#scaleFactor, (15 + 15 * t) * this.#scaleFactor, 0,
        2 * Math.PI);
      ctx.stroke();
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  /**
   * Updates everything relevant to the user's observed area.
   */
  update() {
    if (this.#observedAreas.length > 0) {
      this.#syncCanvasSize();
      // While the heading is settling after a move, hold the FOV at its pre-move angles rather than recomputing
      // from the mid-animation heading; the settle poll recomputes once it's final. (#4174)
      if (!svl.navigationService || !svl.navigationService.getStatus('headingSettling')) {
        this.#updateAngles();
      }
      this.#renderFogOfWar();
      this.#renderFov();
      this.#renderVisitedPanos();
      this.#renderProgressCircle();
      // Point the peg's heading triangle where the user is looking. #angle is unwrapped (continuous), so the CSS
      // rotation transitions the short way across the 0/360 boundary.
      if (svl.peg && this.#angle !== null) svl.peg.setHeading(this.#angle);
      this.#uiMinimap.percentObserved.text(`${Math.floor(100 * this.#fractionObserved)}%`);
      this.#maybeShowCoach();
      if (this.#fractionObserved === 1) {
        this.#dismissCoach('MinimapCoach_AutoDismissed');
        this.#maybeCelebrate();
      }
    }
  }
}
