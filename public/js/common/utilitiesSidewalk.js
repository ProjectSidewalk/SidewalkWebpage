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

  // Example imagery lives at /assets/images/examples/<LabelType>/<name>.png, keyed by what it depicts rather than by
  // a database id (#4723). Label-type dirs keep the PascalCase spelling the rest of the codebase uses for a label
  // type, so `${labelType}` interpolates straight in and can't drift from the `label_type` the API returns.
  const EXAMPLE_IMAGE_BASE = '/assets/images/examples';

  // Countries that ship their own photos for some tags, as the country-id from cityparams.conf that already selects
  // the -india / -zurich locale overrides. Listed rather than probed so servers elsewhere don't 404 on every tag;
  // `make lint-example-images` fails if this drifts from the override dirs actually present under examples/.
  const COUNTRIES_WITH_EXAMPLE_OVERRIDES = ['india', 'switzerland'];

  /**
   * Converts a tag string into the slug used in its example image's filename.
   *
   * Tag strings aren't filename-safe: 14 of them contain `/` ("trash/recycling can"), 6 contain `:` ("cycle lane:
   * parked car"), and one a comma. Every run of non-alphanumeric characters collapses to a single dash, so
   * "debris / pooled water" and "cycle lane: parked car" become "debris-pooled-water" and "cycle-lane-parked-car".
   *
   * @param {string} tag - Tag string exactly as the server sends it, e.g. "trash/recycling can".
   * @returns {string} The slug, e.g. "trash-recycling-can".
   */
  function tagSlug(tag) {
    return tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /**
   * Returns the example-image URLs to try for a tag, best match first.
   *
   * A country that overrides this tag comes first and the shared default second, so callers fall back by walking the
   * list. Scoping by label type is required, not cosmetic: `tag` is UNIQUE per (label_type, tag), so six tag names —
   * "narrow", "bumpy", "construction", "height difference", "brick/cobblestone", "rail/tram track" — belong to two
   * label types each and illustrate different things in each.
   *
   * @param {string} labelType - Label type in PascalCase, e.g. "SurfaceProblem".
   * @param {string} tag - Tag string as the server sends it, e.g. "height difference".
   * @returns {Array<string>} One or two asset URLs, most specific first.
   */
  function getTagExampleImageUrls(labelType, tag) {
    const urls = [];
    if (COUNTRIES_WITH_EXAMPLE_OVERRIDES.includes(window.countryId)) {
      urls.push(`${EXAMPLE_IMAGE_BASE}/${window.countryId}/${labelType}/tag-${tagSlug(tag)}.png`);
    }
    urls.push(`${EXAMPLE_IMAGE_BASE}/${labelType}/tag-${tagSlug(tag)}.png`);
    return urls;
  }

  /**
   * Returns the example-image URL for a severity/quality level.
   *
   * @param {string} labelType - Label type in PascalCase, e.g. "CurbRamp".
   * @param {number|string} severity - 1, 2, or 3.
   * @returns {string} The asset URL.
   */
  function getSeverityExampleImageUrl(labelType, severity) {
    return `${EXAMPLE_IMAGE_BASE}/${labelType}/severity-${severity}.png`;
  }

  /**
   * Returns the example-image URL for one of Validate's "why not?" / "not sure" buttons.
   *
   * Keyed by the button the image belongs to, matching the `<reason>-button-<n>` ids and the
   * `validate-menu.<reason>-reason.*` translation keys, so the three can't fall out of step.
   *
   * @param {string} reason - "disagree" or "unsure".
   * @param {number|string} buttonNumber - The button's 1-based number.
   * @param {?string} [labelType] - Label type in PascalCase; omit for the reasons shared by every label type.
   * @returns {string} The asset URL.
   */
  function getValidateReasonExampleImageUrl(reason, buttonNumber, labelType) {
    return `${EXAMPLE_IMAGE_BASE}/${labelType || '_common'}/${reason}-${buttonNumber}.png`;
  }

  // Annotation marks (arrows, type markers, extent bars) are stored as data in examples/annotations.json rather than
  // painted into the photo, so they can be restyled or repositioned without re-exporting a single raster (#4723).
  // Author them at /admin/exampleImages.
  const EXAMPLE_ANNOTATIONS_URL = `${EXAMPLE_IMAGE_BASE}/annotations.json`;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Marks are stored in normalised 0-1 image coordinates and drawn into an SVG viewBox 100 units tall by
  // 100 * aspectRatio wide. One unit is then the same physical size on both axes, so a mark can't skew with the
  // image's aspect ratio, and every dimension below reads as a percentage of image height — which is what makes one
  // stored record correct at 156px in a tooltip and at 1440px in the source tree.
  const MARK_UNITS_TALL = 100;

  // Mark geometry, in those units. Sized so an arrow still reads at the smallest surface that shows one (the Explore
  // tag tooltip, ~125px tall): below roughly 6 units the head closes up and the mark turns into a smudge.
  const MARK_GEOMETRY = {
    shaftHalfWidth: 1.7,
    headLength: 8.5,
    headHalfWidth: 4.6,
    outlineWidth: 0.9,
    markerWidth: 13,
    capHalfLength: 3.2,
  };

  let exampleAnnotations = null;

  /**
   * Fetches examples/annotations.json once and caches the promise.
   *
   * A missing or malformed manifest resolves to an empty one rather than rejecting: annotations are an enhancement
   * on top of the photo, so losing them should cost the marks, not the example image.
   *
   * @returns {Promise<object>} The manifest, keyed by `<LabelType>/<name>`.
   */
  function loadExampleAnnotations() {
    if (!exampleAnnotations) {
      exampleAnnotations = fetch(EXAMPLE_ANNOTATIONS_URL)
        .then((response) => (response.ok ? response.json() : {}))
        .catch(() => ({}));
    }
    return exampleAnnotations;
  }

  /**
   * Converts an example image URL into its annotation-manifest key.
   *
   * @param {string} url - An example image URL, e.g. "/assets/images/examples/CurbRamp/tag-narrow.png".
   * @returns {string} The key, e.g. "CurbRamp/tag-narrow". Country overrides resolve to their default's key, since
   *                   an override replaces the photo but is framed to depict the same thing.
   */
  function exampleAnnotationKey(url) {
    const path = url.split(`${EXAMPLE_IMAGE_BASE}/`)[1] || '';
    const segments = path.replace(/\.[a-z0-9]+$/i, '').split('/');
    return segments.slice(-2).join('/');
  }

  /**
   * Builds one mark as an SVG element, in the units described above.
   *
   * @param {object} mark - `{type: "arrow"|"extent", from: [u,v], to: [u,v]}` or `{type: "marker", at: [u,v]}`.
   * @param {number} width - viewBox width (100 * aspect ratio).
   * @param {?string} labelType - Label type used by `marker` marks that don't name their own.
   * @returns {?SVGElement} The element, or null if the mark is malformed or of an unknown type.
   */
  function buildMark(mark, width, labelType) {
    const g = MARK_GEOMETRY;
    const point = (p) => (Array.isArray(p) && p.length === 2 ? [p[0] * width, p[1] * MARK_UNITS_TALL] : null);
    if (!mark) return null;

    if (mark.type === 'marker') {
      const at = point(mark.at);
      const type = mark.labelType || labelType;
      if (!at || !type) return null;
      const image = document.createElementNS(SVG_NS, 'image');
      image.setAttribute('href', getIconImagePaths(type).iconImagePath);
      image.setAttribute('width', g.markerWidth);
      image.setAttribute('height', g.markerWidth);
      image.setAttribute('x', at[0] - g.markerWidth / 2);
      image.setAttribute('y', at[1] - g.markerWidth / 2);
      return image;
    }

    const from = point(mark.from);
    const to = point(mark.to);
    if (!from || !to) return null;
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
    const [nx, ny] = [-uy, ux]; // Unit normal, for offsetting to either side of the shaft.
    const shape = document.createElementNS(SVG_NS, 'polygon');

    if (mark.type === 'arrow') {
      // Where the head meets the shaft. Kept off the tip so the outline closes cleanly around the point.
      const neck = [to[0] - ux * g.headLength, to[1] - uy * g.headLength];
      shape.setAttribute('points', [
        [from[0] + nx * g.shaftHalfWidth, from[1] + ny * g.shaftHalfWidth],
        [neck[0] + nx * g.shaftHalfWidth, neck[1] + ny * g.shaftHalfWidth],
        [neck[0] + nx * g.headHalfWidth, neck[1] + ny * g.headHalfWidth],
        to,
        [neck[0] - nx * g.headHalfWidth, neck[1] - ny * g.headHalfWidth],
        [neck[0] - nx * g.shaftHalfWidth, neck[1] - ny * g.shaftHalfWidth],
        [from[0] - nx * g.shaftHalfWidth, from[1] - ny * g.shaftHalfWidth],
      ].map((p) => p.join(',')).join(' '));
    } else if (mark.type === 'extent') {
      // A bar with perpendicular end caps, for tags where the quantity is the geometry ("narrow", "very long
      // crossing"). An arrow can point at a thing; only this can say how much of it there is.
      const caps = [from, to].flatMap((end) => [
        [end[0] + nx * g.capHalfLength, end[1] + ny * g.capHalfLength],
        [end[0] - nx * g.capHalfLength, end[1] - ny * g.capHalfLength],
      ]);
      shape.setAttribute('points', [
        caps[0], caps[1],
        [from[0] - nx * g.shaftHalfWidth / 2, from[1] - ny * g.shaftHalfWidth / 2],
        [to[0] - nx * g.shaftHalfWidth / 2, to[1] - ny * g.shaftHalfWidth / 2],
        caps[3], caps[2],
        [to[0] + nx * g.shaftHalfWidth / 2, to[1] + ny * g.shaftHalfWidth / 2],
        [from[0] + nx * g.shaftHalfWidth / 2, from[1] + ny * g.shaftHalfWidth / 2],
      ].map((p) => p.join(',')).join(' '));
    } else {
      return null;
    }

    // White fill inside a near-black outline is the one treatment that survives every background these photos have —
    // pale concrete, dark asphalt, foliage — without picking a colour per image.
    shape.setAttribute('fill', '#fff');
    shape.setAttribute('stroke', '#1b1e21');
    shape.setAttribute('stroke-width', g.outlineWidth);
    shape.setAttribute('stroke-linejoin', 'round');
    return shape;
  }

  /**
   * Draws a set of marks into an SVG element, replacing whatever it held.
   *
   * The same call renders the authoring tool's live preview and (eventually) the tooltips, so what an author places
   * is by construction what ships.
   *
   * @param {SVGElement} svg - The overlay element. Its viewBox is set here; size it with CSS.
   * @param {Array<object>} marks - Marks in stored form.
   * @param {object} [options] - `aspectRatio` (width/height, default 1.5) and `labelType` for bare `marker` marks.
   */
  function renderExampleMarks(svg, marks, options = {}) {
    const width = MARK_UNITS_TALL * (options.aspectRatio || 1.5);
    svg.setAttribute('viewBox', `0 0 ${width} ${MARK_UNITS_TALL}`);
    svg.setAttribute('preserveAspectRatio', 'none'); // The viewBox already matches the image's aspect ratio.
    svg.setAttribute('aria-hidden', 'true'); // Decorative: the surrounding text already names what's depicted.
    svg.replaceChildren(...(marks || []).map((m) => buildMark(m, width, options.labelType)).filter(Boolean));
  }

  /**
   * Converts a distance in meters to a localized, rounded display string in the user's measurement system.
   * @param {number} distanceInMeters - The distance in meters.
   * @returns {string} E.g. "425 m" in metric locales or "1400 ft" in imperial ones.
   */
  function distanceToString(distanceInMeters) {
    const distanceType = i18next.t('common:measurement-system');
    const unitAbbreviation = i18next.t('common:unit-abbreviation-mission-distance');
    const distance = distanceType === 'metric' ? distanceInMeters : util.math.metersToFeet(distanceInMeters);
    return `${util.math.roundToTwentyFive(distance)} ${unitAbbreviation}`;
  }

  self.distanceToString = distanceToString;
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
  self.tagSlug = tagSlug;
  self.COUNTRIES_WITH_EXAMPLE_OVERRIDES = COUNTRIES_WITH_EXAMPLE_OVERRIDES;
  self.getTagExampleImageUrls = getTagExampleImageUrls;
  self.getSeverityExampleImageUrl = getSeverityExampleImageUrl;
  self.getValidateReasonExampleImageUrl = getValidateReasonExampleImageUrl;
  self.loadExampleAnnotations = loadExampleAnnotations;
  self.exampleAnnotationKey = exampleAnnotationKey;
  self.renderExampleMarks = renderExampleMarks;
  self.MARK_TYPES = ['arrow', 'marker', 'extent'];
  self.reportNoImagery = reportNoImagery;

  return self;
}

util.misc = UtilitiesMisc(JSON);

/**
 * Builds the {url, metadata} object needed by Pannellum from a label metadata object sent by the server.
 *
 * Returns null if backup_image_url is absent or null, or if pano_data is missing.
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
  return {
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
}
