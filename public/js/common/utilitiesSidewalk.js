window.util = window.util || {};
util.misc = util.misc || {};

function UtilitiesMisc(JSON) {
  const self = { className: 'UtilitiesMisc' };

  // Corresponds to the label type lists defined in LabelTypeTable.scala.
  self.VALID_LABEL_TYPES = [
    'CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'Other', 'Occlusion', 'NoSidewalk', 'Crosswalk', 'Signal',
  ];
  self.PRIMARY_LABEL_TYPES
    = ['CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'NoSidewalk', 'Crosswalk', 'Signal'];
  self.PRIMARY_VALIDATE_LABEL_TYPES = ['CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'Crosswalk', 'Signal'];
  self.VALID_LABEL_TYPES_WITHOUT_OTHER
    = ['CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'Occlusion', 'NoSidewalk', 'Crosswalk', 'Signal'];

  // Returns the marker-icon path for each label type. Every frontend surface — canvas, map markers, cards, cursors —
  // uses the one scalable SVG so the icon stays crisp at whatever size it lands at; the raster `_small`/`_tiny`/full
  // -size PNGs beside it exist only for consumers that can't take vector art (server-side share-image compositing in
  // ShareController, and the icon URLs published by /v3/api/labelTypes).
  function getIconImagePaths(category) {
    const iconBasePath = '/assets/images/icons/label_type_icons';
    const imagePaths = { Walk: { id: 'Walk', iconImagePath: null } };
    for (const labelType of self.VALID_LABEL_TYPES) {
      imagePaths[labelType] = { id: labelType, iconImagePath: `${iconBasePath}/${labelType}_small.svg` };
    }

    return category ? imagePaths[category] : imagePaths;
  }

  // TODO either explain why the translations aren't found programmatically, or make it programmatic.
  function getLabelDescriptions(category) {
    const descriptions = {
      Walk: {
        id: 'Walk',
        keyChar: 'E',
      },
      CurbRamp: {
        id: 'CurbRamp',
        keyChar: 'C',
        tagInfo: {
          'narrow': {
            keyChar: 'A',
            text: i18next.t('center-ui.context-menu.tag.narrow'),
          },
          'points into traffic': {
            keyChar: 'I',
            text: i18next.t('center-ui.context-menu.tag.points-into-traffic'),
          },
          'missing tactile warning': {
            keyChar: 'E',
            text: i18next.t('center-ui.context-menu.tag.missing-tactile-warning'),
          },
          'tactile warning': {
            keyChar: 'H',
            text: i18next.t('center-ui.context-menu.tag.tactile-warning'),
          },
          'steep': {
            keyChar: 'T',
            text: i18next.t('center-ui.context-menu.tag.steep'),
          },
          'not enough landing space': {
            keyChar: 'L',
            text: i18next.t('center-ui.context-menu.tag.not-enough-landing-space'),
          },
          'not level with street': {
            keyChar: 'V',
            text: i18next.t('center-ui.context-menu.tag.not-level-with-street'),
          },
          'surface problem': {
            keyChar: 'R',
            text: i18next.t('center-ui.context-menu.tag.surface-problem'),
          },
          'debris / pooled water': {
            keyChar: 'D',
            text: i18next.t('center-ui.context-menu.tag.debris-pooled-water'),
          },
          'parallel lines': {
            keyChar: 'J',
            text: i18next.t('center-ui.context-menu.tag.parallel-lines'),
          },
          'not aligned with crosswalk': {
            keyChar: 'G',
            text: i18next.t('center-ui.context-menu.tag.not-aligned-with-crosswalk'),
          },
          'not visible': {
            keyChar: '[',
            text: i18next.t('center-ui.context-menu.tag.not-visible'),
          },
        },
      },
      NoCurbRamp: {
        id: 'NoCurbRamp',
        keyChar: 'M',
        tagInfo: {
          'alternate route present': {
            keyChar: 'A',
            text: i18next.t('center-ui.context-menu.tag.alternate-route-present'),
          },
          'no alternate route': {
            keyChar: 'L',
            text: i18next.t('center-ui.context-menu.tag.no-alternate-route'),
          },
          'unclear if needed': {
            keyChar: 'U',
            text: i18next.t('center-ui.context-menu.tag.unclear-if-needed'),
          },
        },
      },
      Obstacle: {
        id: 'Obstacle',
        keyChar: 'O',
        tagInfo: {
          'trash/recycling can': {
            keyChar: 'H',
            text: i18next.t('center-ui.context-menu.tag.trash-recycling-can'),
          },
          'fire hydrant': {
            keyChar: 'F',
            text: i18next.t('center-ui.context-menu.tag.fire-hydrant'),
          },
          'pole': {
            keyChar: 'L',
            text: i18next.t('center-ui.context-menu.tag.pole'),
          },
          'tree': {
            keyChar: 'E',
            text: i18next.t('center-ui.context-menu.tag.tree'),
          },
          'vegetation': {
            keyChar: 'V',
            text: i18next.t('center-ui.context-menu.tag.vegetation'),
          },
          'parked car': {
            keyChar: 'U',
            text: i18next.t('center-ui.context-menu.tag.parked-car'),
          },
          'parked bike': {
            keyChar: 'K',
            text: i18next.t('center-ui.context-menu.tag.parked-bike'),
          },
          'construction': {
            keyChar: 'T',
            text: i18next.t('center-ui.context-menu.tag.construction'),
          },
          'sign': {
            keyChar: 'I',
            text: i18next.t('center-ui.context-menu.tag.sign'),
          },
          'garage entrance': {
            keyChar: 'G',
            text: i18next.t('center-ui.context-menu.tag.garage-entrance'),
          },
          'stairs': {
            keyChar: 'R',
            text: i18next.t('center-ui.context-menu.tag.stairs'),
          },
          'street vendor': {
            keyChar: 'J',
            text: i18next.t('center-ui.context-menu.tag.street-vendor'),
          },
          'height difference': {
            keyChar: 'D',
            text: i18next.t('center-ui.context-menu.tag.height-difference'),
          },
          'narrow': {
            keyChar: 'A',
            text: i18next.t('center-ui.context-menu.tag.narrow'),
          },
          'litter/garbage': {
            keyChar: 'X',
            text: i18next.t('center-ui.context-menu.tag.litter-garbage'),
          },
          'parked scooter/motorcycle': {
            keyChar: 'Y',
            text: i18next.t('center-ui.context-menu.tag.parked-scooter-motorcycle'),
          },
          'outdoor dining area': {
            keyChar: 'Q',
            text: i18next.t('center-ui.context-menu.tag.outdoor-dining-area'),
          },
          'mailbox': {
            keyChar: '[',
            text: i18next.t('center-ui.context-menu.tag.mailbox'),
          },
          'utility cabinet': {
            keyChar: ']',
            text: i18next.t('center-ui.context-menu.tag.utility-cabinet'),
          },
          'cart': {
            keyChar: ';',
            text: i18next.t('center-ui.context-menu.tag.cart'),
          },
          'drainage': {
            keyChar: ',',
            text: i18next.t('center-ui.context-menu.tag.drainage'),
          },
          'electrical box': {
            keyChar: '.',
            text: i18next.t('center-ui.context-menu.tag.electrical-box'),
          },
          'bollard': {
            keyChar: '/',
            text: i18next.t('center-ui.context-menu.tag.bollard'),
          },
        },
      },
      SurfaceProblem: {
        id: 'SurfaceProblem',
        keyChar: 'S',
        tagInfo: {
          'bumpy': {
            keyChar: 'Y',
            text: i18next.t('center-ui.context-menu.tag.bumpy'),
          },
          'uneven/slanted': {
            keyChar: 'U',
            text: i18next.t('center-ui.context-menu.tag.uneven-slanted'),
          },
          'cracks': {
            keyChar: 'K',
            text: i18next.t('center-ui.context-menu.tag.cracks'),
          },
          'grass': {
            keyChar: 'G',
            text: i18next.t('center-ui.context-menu.tag.grass'),
          },
          'narrow sidewalk': {
            keyChar: 'A',
            text: i18next.t('center-ui.context-menu.tag.narrow'),
          },
          'brick/cobblestone': {
            keyChar: 'I',
            text: i18next.t('center-ui.context-menu.tag.brick-cobblestone'),
          },
          'construction': {
            keyChar: 'T',
            text: i18next.t('center-ui.context-menu.tag.construction'),
          },
          'very broken': {
            keyChar: 'R',
            text: i18next.t('center-ui.context-menu.tag.very-broken'),
          },
          'height difference': {
            keyChar: 'D',
            text: i18next.t('center-ui.context-menu.tag.height-difference'),
          },
          'rail/tram track': {
            keyChar: 'L',
            text: i18next.t('center-ui.context-menu.tag.rail-tram-track'),
          },
          'sand/gravel': {
            keyChar: 'V',
            text: i18next.t('center-ui.context-menu.tag.sand-gravel'),
          },
          'uncovered manhole': {
            keyChar: 'Q',
            text: i18next.t('center-ui.context-menu.tag.uncovered-manhole'),
          },
          'utility panel': {
            keyChar: 'E',
            text: i18next.t('center-ui.context-menu.tag.utility-panel'),
          },
          'debris': {
            keyChar: 'F',
            text: i18next.t('center-ui.context-menu.tag.debris'),
          },
        },
      },
      NoSidewalk: {
        id: 'NoSidewalk',
        keyChar: 'N',
        tagInfo: {
          'ends abruptly': {
            keyChar: 'A',
            text: i18next.t('center-ui.context-menu.tag.ends-abruptly'),
          },
          'street has a sidewalk': {
            keyChar: 'R',
            text: i18next.t('center-ui.context-menu.tag.street-has-a-sidewalk'),
          },
          'street has no sidewalks': {
            keyChar: 'T',
            text: i18next.t('center-ui.context-menu.tag.street-has-no-sidewalks'),
          },
          'gravel/dirt road': {
            keyChar: 'D',
            text: i18next.t('center-ui.context-menu.tag.gravel-dirt-road'),
          },
          'shared pedestrian/car space': {
            keyChar: 'E',
            text: i18next.t('center-ui.context-menu.tag.shared-pedestrian-car-space'),
          },
          'pedestrian lane marking': {
            keyChar: 'I',
            text: i18next.t('center-ui.context-menu.tag.pedestrian-lane-marking'),
          },
          'covered walkway': {
            keyChar: 'L',
            text: i18next.t('center-ui.context-menu.tag.covered-walkway'),
          },
          'too dirty/cluttered': {
            keyChar: 'Y',
            text: i18next.t('center-ui.context-menu.tag.too-dirty-cluttered'),
          },
        },
      },
      Crosswalk: {
        id: 'Crosswalk',
        keyChar: 'W',
        tagInfo: {
          'paint fading': {
            keyChar: 'F',
            text: i18next.t('center-ui.context-menu.tag.paint-fading'),
          },
          'broken surface': {
            keyChar: 'R',
            text: i18next.t('center-ui.context-menu.tag.broken-surface'),
          },
          'uneven surface': {
            keyChar: 'E',
            text: i18next.t('center-ui.context-menu.tag.uneven-surface'),
          },
          'brick/cobblestone': {
            keyChar: 'I',
            text: i18next.t('center-ui.context-menu.tag.brick-cobblestone'),
          },
          'bumpy': {
            keyChar: 'Y',
            text: i18next.t('center-ui.context-menu.tag.bumpy'),
          },
          'rail/tram track': {
            keyChar: 'L',
            text: i18next.t('center-ui.context-menu.tag.rail-tram-track'),
          },
          'no pedestrian priority': {
            keyChar: 'V',
            text: i18next.t('center-ui.context-menu.tag.no-pedestrian-priority'),
          },
          'very long crossing': {
            keyChar: 'U',
            text: i18next.t('center-ui.context-menu.tag.very-long-crossing'),
          },
          'level with sidewalk': {
            keyChar: 'D',
            text: i18next.t('center-ui.context-menu.tag.level-with-sidewalk'),
          },
          'too close to traffic': {
            keyChar: 'T',
            text: i18next.t('center-ui.context-menu.tag.too-close-to-traffic'),
          },
        },
      },
      Signal: {
        id: 'Signal',
        keyChar: 'P',
        tagInfo: {
          'button waist height': {
            keyChar: 'H',
            text: i18next.t('center-ui.context-menu.tag.button-waist-height'),
          },
          'APS': {
            keyChar: 'A',
            text: i18next.t('center-ui.context-menu.tag.APS'),
          },
          'one button': {
            keyChar: 'E',
            text: i18next.t('center-ui.context-menu.tag.one-button'),
          },
          'two buttons': {
            keyChar: 'T',
            text: i18next.t('center-ui.context-menu.tag.two-buttons'),
          },
          'hard to reach buttons': {
            keyChar: 'R',
            text: i18next.t('center-ui.context-menu.tag.hard-to-reach-buttons'),
          },
          'yellow box, accessibility features not visible': {
            keyChar: 'Z',
            text: i18next.t('center-ui.context-menu.tag.yellow-box-accessibility-features-not-visible'),
          },
        },
      },
      Other: {
        id: 'Other',
        tagInfo: {
          'missing crosswalk': {
            keyChar: 'I',
            text: i18next.t('center-ui.context-menu.tag.missing-crosswalk'),
          },
          'no bus stop access': {
            keyChar: 'A',
            text: i18next.t('center-ui.context-menu.tag.no-bus-stop-access'),
          },
          'cycle lane: protection from traffic': {
            keyChar: 'E',
            text: i18next.t('center-ui.context-menu.tag.cycle-lane-protection-from-traffic'),
          },
          'cycle lane: no protection from traffic': {
            keyChar: 'T',
            text: i18next.t('center-ui.context-menu.tag.cycle-lane-no-protection-from-traffic'),
          },
          'cycle lane: surface problem': {
            keyChar: 'R',
            text: i18next.t('center-ui.context-menu.tag.cycle-lane-surface-problem'),
          },
          'cycle lane: faded paint': {
            keyChar: 'F',
            text: i18next.t('center-ui.context-menu.tag.cycle-lane-faded-paint'),
          },
          'cycle lane: debris / pooled water': {
            keyChar: 'D',
            text: i18next.t('center-ui.context-menu.tag.cycle-lane-debris-pooled-water'),
          },
          'cycle lane: parked car': {
            keyChar: 'U',
            text: i18next.t('center-ui.context-menu.tag.cycle-lane-parked-car'),
          },
          'cycle box': {
            keyChar: 'X',
            text: i18next.t('center-ui.context-menu.tag.cycle-box'),
          },
        },
      },
      Occlusion: {
        id: 'Occlusion',
        keyChar: 'B',
      },
    };
    return category ? descriptions[category] : descriptions;
  }

  const SMILEY_ICON_BASE = '/assets/images/icons/smileys/';
  const POSITIVE_LABEL_TYPES = ['CurbRamp', 'Crosswalk'];
  const LABEL_TYPES_WITHOUT_SEVERITY = ['NoSidewalk', 'Signal', 'Occlusion'];

  /**
   * Returns true if label type uses the "positive" rating scheme (Good/Okay/Bad) vs the "negative" (Low/Medium/High).
   * @param {string} labelType
   * @returns {boolean}
   */
  function isPositiveLabelType(labelType) {
    return POSITIVE_LABEL_TYPES.includes(labelType);
  }

  /**
   * Returns true if label type supports a severity/quality rating.
   * @param {string} labelType
   * @returns {boolean}
   */
  function labelTypeHasSeverity(labelType) {
    return !LABEL_TYPES_WITHOUT_SEVERITY.includes(labelType);
  }

  /**
   * Re-expresses a pano x-coordinate on whichever side of the image seam the camera is currently facing.
   *
   * An equirectangular pano wraps, so a point near one edge is also a point just past the other. Picking the wrong
   * representation puts an annotation — or a callout anchored to one — a full pano-width away from where the user is
   * looking. Only a point within a quarter-width of the seam is ambiguous; everything else is returned unchanged.
   *
   * @param {number} panoX - Pano image x-coordinate, as stored on tutorial state annotations.
   * @param {number} heading - The camera's current heading, in degrees.
   * @param {number} panoWidth - Full width of the pano image in pixels.
   * @returns {number} The equivalent x-coordinate nearest the current view; may be negative or exceed panoWidth.
   */
  function unwrapPanoX(panoX, heading, panoWidth) {
    const seamZone = panoWidth / 4;
    // Facing the first half, a point in the far quarter sits behind the camera's left edge, and vice versa.
    if (heading < 180) return panoX > panoWidth - seamZone ? panoX - panoWidth : panoX;
    return panoX < seamZone ? panoX + panoWidth : panoX;
  }

  /**
   * Merges a tutorial state's own annotations with the ones carried over from earlier states, without duplicates.
   *
   * The carry-over list is rebuilt from this merged list on every draw, and a state is drawn many times over (once
   * per pano move, once per animation frame while example labels pop in). Concatenating blindly would therefore
   * re-append the same annotation objects on every pass, so the list grows for as long as the step is on screen:
   * the icons overdraw at identical coordinates, and the arrow-blink period — derived from how many arrows are in
   * the list — stretches out as it fills up (#4832). Annotations are shared by reference, so identity dedupes them.
   *
   * @param {Array<Object>} savedAnnotations - Annotations carried over from previous states.
   * @param {?Array<Object>} stateAnnotations - The current state's own annotations, if it declares any.
   * @returns {Array<Object>} The union, in carry-over-then-own order, each annotation appearing once.
   */
  function mergeOnboardingAnnotations(savedAnnotations, stateAnnotations) {
    return [...new Set([...savedAnnotations, ...(stateAnnotations || [])])];
  }

  /**
   * Picks the annotations that should stay on screen after the given state, i.e. those tagged to outlive it.
   *
   * @param {Array<Object>} annotations - The state's merged annotation list.
   * @param {string} stateId - Id of the state being drawn; an annotation kept "until" it expires here.
   * @returns {Array<Object>} The subset to carry into the next state.
   */
  function carryOverOnboardingAnnotations(annotations, stateId) {
    return annotations.filter((a) => a.keepUntil && a.keepUntil !== stateId);
  }

  /**
   * Returns a map from rating level (1/2/3) to the i18n key (under the `common` namespace) for that level's label.
   * @param {string} labelType
   * @returns {Object.<number, string>}
   */
  function getRatingLevelKeys(labelType) {
    return isPositiveLabelType(labelType)
      ? { 1: 'good', 2: 'okay', 3: 'bad' }
      : { 1: 'low', 2: 'medium', 3: 'high' };
  }

  /**
   * Returns the full asset path for the smiley icon at the given severity and label type.
   * @param {number} severity - 0 (N/A), 1 (low), 2 (medium), or 3 (high).
   * @param {string} labelType - The label type, used to pick positive vs negative icon set.
   * @param {boolean} selected - Whether to return the filled (selected-state) variant.
   * @returns {string}
   */
  function getSmileyIconPath(severity, labelType, selected) {
    // Severity 0 (N/A) is a neutral circle; only the negative asset exists and it's reused for both sets.
    const set = severity === 0 || !isPositiveLabelType(labelType) ? 'negative' : 'positive';
    return `${SMILEY_ICON_BASE}sev-${severity}-${set}${selected ? '-filled' : ''}.svg`;
  }

  // Each rating level's colours, as design-system custom properties so no hex is duplicated here. `face` mirrors
  // the fill inside sev-<level>-*-filled.svg — recolour that artwork and these have to move with it. `edge` and
  // `wash` are the darkened and lightened counterparts a selected control uses.
  //
  // Level colours, per scale. Green is a value judgement and belongs only to the quality scale: a curb ramp rated
  // 1 is genuinely good, but a surface problem rated 1 is a mild problem, not an absence of one, and colouring it
  // green would tell a mapper it needs no attention. Severity keeps the yellow-amber-orange heat ramp, where the
  // colour tracks how bad rather than whether bad. Same positive/negative split getSmileyIconPath makes, and these
  // mirror the fill inside sev-<level>-<set>-filled.svg.
  //
  // Edges are picked per level rather than by a fixed step offset, for two reasons. The ramps are not
  // perceptually aligned, so the same step is not equally dark on each -- banana-700 on banana-200 is 1.68:1,
  // invisible on its own wash, where banana-900 clears the 3:1 non-text bar. And the banana ramp has only one
  // step dark enough to qualify, so severity's edges escalate by hue rather than by depth alone: gold, then rust,
  // then dark rust (L* 53 / 44 / 25). Two levels sharing banana-900 made Low and Medium indistinguishable.
  //
  // The wash avoids -100 for the reverse reason -- jade-100 is 13/255 off the white panel behind it, too close to
  // register as a state at all.
  const SEVERITY_LEVEL_COLORS = {
    positive: {
      1: { face: 'jade-400', edge: 'jade-700', wash: 'jade-200' },
      2: { face: 'banana-400', edge: 'banana-900', wash: 'banana-200' },
      3: { face: 'orange-400', edge: 'orange-600', wash: 'orange-200' },
    },
    negative: {
      1: { face: 'banana-400', edge: 'banana-900', wash: 'banana-200' },
      2: { face: 'banana-700', edge: 'orange-600', wash: 'banana-300' },
      3: { face: 'orange-400', edge: 'orange-800', wash: 'orange-200' },
    },
  };

  /**
   * Returns the colours for a rating level as CSS custom-property references.
   *
   * Takes the label type for the same reason getSmileyIconPath does: the two scales do not share a palette. Only
   * quality has a "good" end worth colouring green; on severity, level 1 is a mild problem and stays yellow.
   * @param {number} severity - 1, 2, or 3.
   * @param {string} labelType - Picks the quality palette for positive types, the severity palette otherwise.
   * @returns {?{face: string, edge: string, wash: string}} `var(--color-…)` references, or null for 0/N-A.
   */
  function getSeverityLevelColors(severity, labelType) {
    const scale = isPositiveLabelType(labelType) ? 'positive' : 'negative';
    const level = SEVERITY_LEVEL_COLORS[scale][severity];
    if (!level) return null;
    return Object.fromEntries(Object.entries(level).map(([role, token]) => [role, `var(--color-${token})`]));
  }

  /**
   * Sends a POST request to the server to report that there is no street view for the given street edge.
   *
   * TODO it makes way more sense to have this in Form.js, but Form has a dependency on PanoViewer, and we want to
   *      call this function if PanoViewer fails to load...
   *
   * @param {Task} task - The audit task for the street edge that is missing imagery.
   * @param {number} missionId - ID of the mission the user was working on when imagery was found to be missing.
   * @returns {Promise<Response>} The fetch promise for the POST request, so callers can await completion.
   */
  function reportNoImagery(task, missionId) {
    console.error(`Imagery missing for a large portion of street: ${task.getStreetEdgeId()}`);
    const reversed = task.getProperty('startPointReversed');
    const data = {
      audit_task: {
        street_edge_id: task.getStreetEdgeId(),
        task_start: task.getProperty('taskStart'),
        audit_task_id: task.getAuditTaskId(),
        completed: task.isComplete(),
        current_lat: reversed ? task.getEndCoordinate().lat : task.getStartCoordinate().lat,
        current_lng: reversed ? task.getEndCoordinate().lng : task.getStartCoordinate().lng,
        start_point_reversed: reversed,
        current_mission_start: null,
        last_priority_update_time: new Date(),
        request_updated_street_priority: false,
      },
      mission_id: missionId,
    };

    return fetch('/explore/nostreetview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  /**
   * Names the street nearest a coordinate, for telling a labeler where they have been taken.
   *
   * Street names aren't in our data — `street_edge` carries geometry and an OSM way id, no name — so this asks
   * Mapbox, the same reverse-geocode the route builder's endpoint fields use. Purely decorative: every failure
   * mode (no key, offline, rate limit, a coordinate the geocoder can't place) resolves to null so the caller can
   * fall back to unnamed wording rather than to no message at all.
   *
   * @param {{lat: number, lng: number}} latLng - Where to look.
   * @param {string} mapboxApiKey - Mapbox access token.
   * @returns {Promise<string|null>} The street name, or null when it can't be determined.
   */
  async function getStreetNameNear(latLng, mapboxApiKey) {
    if (!mapboxApiKey) return null;
    try {
      const params = new URLSearchParams({
        longitude: latLng.lng,
        latitude: latLng.lat,
        types: 'address,street',
        language: i18next.t('common:mapbox-language-code'),
        access_token: mapboxApiKey,
      });
      const response = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?${params}`);
      if (!response.ok) return null;
      const data = await response.json();
      const props = data.features?.[0]?.properties;
      if (!props) return null;
      // An address result names its street in `context`; a street result names itself.
      const ownName = props.feature_type === 'street' ? (props.name_preferred || props.name) : null;
      return props.context?.street?.name || ownName || null;
    } catch {
      return null;
    }
  }

  // TODO These colors should probably match the colors in our Design System Tokens in main.css.
  const colors = {
    Walk: {
      id: 'Walk',
      fillStyle: 'rgba(0, 0, 0, 1)',
      strokeStyle: '#FFFFFF',
    },
    CurbRamp: {
      id: 'CurbRamp',
      fillStyle: '#90C31F',
      strokeStyle: '#FFFFFF',
    },
    NoCurbRamp: {
      id: 'NoCurbRamp',
      fillStyle: '#E679B6',
      strokeStyle: '#FFFFFF',
    },
    Obstacle: {
      id: 'Obstacle',
      fillStyle: '#78B0EA',
      strokeStyle: '#FFFFFF',
    },
    Other: {
      id: 'Other',
      fillStyle: '#B3B3B3',
      strokeStyle: '#0000FF',
    },
    Occlusion: {
      id: 'Occlusion',
      fillStyle: '#B3B3B3',
      strokeStyle: '#009902',
    },
    NoSidewalk: {
      id: 'NoSidewalk',
      fillStyle: '#BE87D8',
      strokeStyle: '#FFFFFF',
    },
    SurfaceProblem: {
      id: 'SurfaceProblem',
      fillStyle: '#F68D3E',
      strokeStyle: '#FFFFFF',
    },
    Crosswalk: {
      id: 'Crosswalk',
      fillStyle: '#FABF1C',
      strokeStyle: '#FFFFFF',
    },
    Signal: {
      id: 'Signal',
      fillStyle: '#63C0AB',
      strokeStyle: '#FFFFFF',
    },
  };

  function getLabelColors(category) {
    return category ? colors[category].fillStyle : colors;
  }

  self.getIconImagePaths = getIconImagePaths;
  self.getLabelDescriptions = getLabelDescriptions;
  self.isPositiveLabelType = isPositiveLabelType;
  self.POSITIVE_LABEL_TYPES = POSITIVE_LABEL_TYPES;
  self.labelTypeHasSeverity = labelTypeHasSeverity;
  self.LABEL_TYPES_WITHOUT_SEVERITY = LABEL_TYPES_WITHOUT_SEVERITY;
  self.getSmileyIconPath = getSmileyIconPath;
  self.getSeverityLevelColors = getSeverityLevelColors;
  self.getRatingLevelKeys = getRatingLevelKeys;
  self.getLabelColors = getLabelColors;
  self.reportNoImagery = reportNoImagery;
  self.getStreetNameNear = getStreetNameNear;
  self.unwrapPanoX = unwrapPanoX;
  self.mergeOnboardingAnnotations = mergeOnboardingAnnotations;
  self.carryOverOnboardingAnnotations = carryOverOnboardingAnnotations;

  return self;
}

util.misc = UtilitiesMisc(JSON);

/**
 * Fields PannellumViewer needs to render a backup pano: the subset of PanoData's `requiredParams` that a pano_data
 * row can be missing. See the note there before changing this list.
 *
 * A property rather than a top-level `const` because some views load this file directly on a page whose bundle
 * already concatenates it. Re-running it must stay harmless, and a repeated `const` is a fatal redeclaration.
 */
util.misc.BACKUP_IMAGE_REQUIRED_FIELDS = ['width', 'height', 'lat', 'lng', 'cameraHeading', 'cameraPitch'];

/**
 * Whether a backup pano carries the metadata PannellumViewer needs to render it.
 *
 * Old pano_data rows carry nulls for these and PanoData rejects them (#4804). Guards the buildBackupImageData path
 * only — the /backupImage/:panoId/metadata payload is already filtered server-side by `getLocalBackupImage`.
 *
 * @param {?object} data Backup pano metadata in the camelCase shape buildBackupImageData produces, or null.
 * @returns {boolean} True when every field the viewer needs is present and numeric.
 */
function backupImageDataIsComplete(data) {
  return !!data
    && util.misc.BACKUP_IMAGE_REQUIRED_FIELDS.every((f) => typeof data[f] === 'number' && !isNaN(data[f]));
}

/**
 * Builds the {url, metadata} object needed by Pannellum from a label metadata object sent by the server.
 *
 * Returns null if backup_image_url is absent or null, if pano_data is missing, or if pano_data is too incomplete to
 * render (see backupImageDataIsComplete).
 * @param {object} meta Label metadata object from the server.
 * @param {string|null} meta.backup_image_url URL for the self-hosted backup image, or null.
 * @param {object|null} meta.pano_data Nested pano viewer metadata, or null.
 * @param {string} meta.pano_id The panorama ID.
 * @param {number} meta.camera_lat Latitude of the camera.
 * @param {number} meta.camera_lng Longitude of the camera.
 * @param {string} meta.image_capture_date Date the panorama was captured.
 * @returns {{metadata: object}|null}
 */
function buildBackupImageData(meta) {
  if (!meta.backup_image_url || !meta.pano_data) return null;
  const pd = meta.pano_data;
  const backupImageData = {
    panoId: meta.pano_id,
    imageUrl: meta.backup_image_url,
    width: pd.width,
    height: pd.height,
    tileWidth: pd.tile_width,
    tileHeight: pd.tile_height,
    lat: meta.camera_lat,
    lng: meta.camera_lng,
    cameraHeading: pd.camera_heading,
    cameraPitch: pd.camera_pitch,
    cameraRoll: pd.camera_roll,
    captureDate: meta.image_capture_date,
    copyright: pd.copyright,
    address: pd.address,
  };
  return backupImageDataIsComplete(backupImageData) ? backupImageData : null;
}
