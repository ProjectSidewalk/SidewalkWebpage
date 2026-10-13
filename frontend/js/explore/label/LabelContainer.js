/**
 * The labels of this session, placed here or fetched to resume the mission, bucketed by pano. Owns their lifecycle
 * (creating, placing on the minimap, removing, whether deleting is allowed) and announces what the canvas and the
 * legend draw, since both are built after this.
 */

import { Gate } from '../../common/Gate.js';
import { util } from '../../common/utilities.js';
import { Label } from './Label.js';
import '../../common/pano-viewer/panoUtilities.js';
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('../canvas/CanvasFrame.js').CanvasFrame} CanvasFrame */
/** @typedef {import('../navigation/Minimap.js').Minimap} Minimap */
/** @typedef {import('../mission/MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../../common/pano-viewer/PanoStore.js').PanoStore} PanoStore */
/** @typedef {import('../data/Storage.js').TemporaryStorage} TemporaryStorage */
/** @typedef {import('../sidebar/OverallStats.js').OverallStats} OverallStats */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class LabelContainer {
  // localStorage key for the minimap legend's "My earlier labels" toggle (#4945). Remembered across sessions because
  // a mapper who hides earlier labels to declutter a re-audit wants them hidden on the next street too.
  static EARLIER_LABELS_STORAGE_KEY = 'minimapShowEarlierLabels';

  #config;
  #frame;
  #panoStore;
  #minimap;
  #missionContainer;
  #panoManager;
  #storage;
  #overallStats;
  #tracker;

  #labelsToLog = {};
  #allLabels = {};
  #nextTempLabelId;

  /** @type {?Label} The label placed most recently this session; the tutorial lets only it be deleted. */
  #latestLabel = null;

  /** Deleting labels; the tutorial holds it except on the step that asks for a deletion. */
  deleting = new Gate();

  // The mission the minimap's label eras were last derived for (#4945): the mission container announces after every
  // submission, not only at mission changes, and re-deriving is a pass over every label in the region.
  #minimapEraMissionId = null;

  /** @type {Array<(label: Label) => void>} */
  #placedListeners = [];

  /** @type {Array<(label: Label) => void>} */
  #removedListeners = [];

  /** @type {Array<(label: Label) => void>} */
  #markerClickListeners = [];

  /** @type {Array<(shown: boolean) => void>} */
  #earlierLabelsShownListeners = [];

  /**
   * @param {number} nextTemporaryLabelId - Where the session's temporary label ids start, as the server handed out.
   * @param {ExploreConfig} config
   * @param {CanvasFrame} frame - The frame labels are drawn in.
   * @param {PanoStore} panoStore - Where a new label's pano metadata comes from.
   * @param {Minimap} minimap - Where each label's marker goes.
   * @param {MissionContainer} missionContainer - Whose current mission decides each label's minimap era.
   * @param {PanoManager} panoManager - Whose pano the canvas labels are the ones on.
   * @param {TemporaryStorage} storage - Remembers the "My earlier labels" toggle.
   * @param {OverallStats} overallStats - Counts labels as they come and go.
   * @param {Tracker} tracker
   */
  constructor(nextTemporaryLabelId, config, frame, panoStore, minimap, missionContainer, panoManager, storage,
    overallStats, tracker) {
    this.#nextTempLabelId = nextTemporaryLabelId;
    this.#config = config;
    this.#frame = frame;
    this.#panoStore = panoStore;
    this.#minimap = minimap;
    this.#missionContainer = missionContainer;
    this.#panoManager = panoManager;
    this.#storage = storage;
    this.#overallStats = overallStats;
    this.#tracker = tracker;

    // The mission boundary is what separates this pass's minimap markers from earlier ones (#4945).
    missionContainer.on('MissionContainer:missionChanged', (mission) => {
      const missionId = mission.getProperty('missionId');
      if (missionId === this.#minimapEraMissionId) return;
      this.#minimapEraMissionId = missionId;
      this.refreshMinimapEras();
    });
  }

  /**
   * Told when a label is placed on the canvas (not when one is fetched to resume the mission).
   * @param {(label: Label) => void} listener
   */
  onLabelPlaced(listener) {
    this.#placedListeners.push(listener);
  }

  /**
   * Told when a label is removed.
   * @param {(label: Label) => void} listener
   * @returns {() => void} Stops telling it.
   */
  onLabelRemoved(listener) {
    this.#removedListeners.push(listener);
    return () => {
      this.#removedListeners = this.#removedListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Told when a current-mission label's minimap marker is clicked, to return to its pano (#2561).
   * @param {(label: Label) => void} listener
   */
  onMarkerClick(listener) {
    this.#markerClickListeners.push(listener);
  }

  /**
   * Told whenever the "My earlier labels" setting is applied, so the legend's checkbox can follow it.
   * @param {(shown: boolean) => void} listener
   */
  onEarlierLabelsShownChanged(listener) {
    this.#earlierLabelsShownListeners.push(listener);
  }

  /**
   * Helper func to add a label to given list. Our labels are sorted in objects with panoId keys and lists as values.
   * @param {Record<string, Label[]>} labelListObj
   * @param {Label} label
   */
  #addLabelToListObject(labelListObj, label) {
    const panoId = label.getPanoId();
    const tempId = label.getProperty('temporaryLabelId');

    // Make sure that there is a list available for the given pano ID.
    if (!(panoId in labelListObj)) labelListObj[panoId] = [];

    // If it's not already in the last, add it.
    const inList = labelListObj[panoId].filter((l) => l.getProperty('temporaryLabelId') === tempId).length > 0;
    if (!inList) labelListObj[panoId].push(label);
  }

  /** @returns {?number} The current mission's id, or null before a mission is loaded. */
  #currentMissionId() {
    const mission = this.#missionContainer.getCurrentMission();
    return mission ? mission.getProperty('missionId') : null;
  }

  /**
   * Create a Label object. If the label is new, it won't have a labelId yet, so we assign a temporary one.
   * @returns {Label}
   */
  createLabel(params, isNew) {
    if (isNew) {
      params.temporaryLabelId = this.#nextTempLabelId;
      this.#nextTempLabelId++;
    }
    const label = new Label(params, this.#frame, this.#config.latLngEstimation, this.#panoStore);
    label.placeOnMinimap(this.#minimap, this.#currentMissionId(), () => this.#returnToLabel(label));

    // Add to list of labels. If new, also add to current canvas labels.
    if (isNew) {
      this.#latestLabel = label;
      this.#addLabelToListObject(this.#labelsToLog, label);
      this.#overallStats.incrementLabelCount();
    }
    this.#addLabelToListObject(this.#allLabels, label);
    if (isNew) this.#placedListeners.forEach((listener) => listener(label));

    return label;
  }

  /**
   * Returns to a label's pano and faces it so the user can review or re-mark it (#2561). Ignored during onboarding
   * or if the label isn't from the current mission (returning across missions would desync the map's active task).
   * @param {Label} label
   */
  #returnToLabel(label) {
    if (this.#config.isOnboarding) return;
    if (label.getProperty('missionId') !== this.#currentMissionId()) return;

    this.#tracker.push('Click_MinimapLabelMarker', {
      labelId: label.getProperty('labelId'),
      panoId: label.getPanoId(),
    });
    this.#markerClickListeners.forEach((listener) => listener(label));
  }

  /**
   * Query server for previous labels placed by this user and create label objects for them.
   * @param {number} regionId
   * @param {?number} userRouteId - The route walk the user is on, if any. A route can run through several regions,
   *   so the server gathers the labels from all of them rather than from regionId alone.
   * @param {(result: object) => void} [callback]
   */
  fetchLabelsToResumeMission(regionId, userRouteId, callback) {
    const query = new URLSearchParams({ regionId: String(regionId) });
    if (userRouteId) query.set('userRouteId', String(userRouteId));
    fetch(`/label/resumeMission?${query}`).then((res) => res.json()).then((result) => {
      const labelArr = result.labels;
      for (let i = 0; i < labelArr.length; i++) {
        const originalCanvasXY = {
          x: labelArr[i].canvasX,
          y: labelArr[i].canvasY,
        };
        // The frame the click was made in (#5085): the stored point is decoded through it, and re-encoded for the
        // frame the tool is displaying now, which may be a different shape.
        const originalCanvasFrame = {
          width: labelArr[i].canvasWidth ?? util.EXPLORE_CANVAS_WIDTH,
          height: labelArr[i].canvasHeight ?? util.EXPLORE_CANVAS_HEIGHT,
        };

        // The imagery the click was made on decides the fov it was projected with, and an Explore page renders one
        // imagery source, so the page's viewer is the label's source too.
        const viewerType = this.#panoManager.panoViewer.getViewerType();
        const povOfLabelIfCentered = util.pano.canvasCoordToCenteredPov(
          labelArr[i].originalPov, originalCanvasXY.x, originalCanvasXY.y,
          originalCanvasFrame.width, originalCanvasFrame.height,
          util.pano.renderedHFov(
            labelArr[i].originalPov.zoom, originalCanvasFrame.width / originalCanvasFrame.height, viewerType,
          ),
        );
        const currPov = this.#panoManager.getPov();
        labelArr[i].currCanvasXY = util.pano.centeredPovToCanvasCoord(
          povOfLabelIfCentered, currPov, this.#frame.width, this.#frame.height, this.#frame.iconRadius,
          this.#frame.renderedHFov(currPov.zoom),
        );

        labelArr[i].originalCanvasXY = originalCanvasXY;
        labelArr[i].originalCanvasFrame = originalCanvasFrame;
        labelArr[i].povOfLabelIfCentered = povOfLabelIfCentered;
        labelArr[i].panoXY = { x: labelArr[i].panoX, y: labelArr[i].panoY };
        const label = this.createLabel(labelArr[i], false);

        // Prevent hover info from being rendered initially.
        label.setHoverInfoVisibility('hidden');
      }

      // Honor the remembered legend toggle for the markers just created, and record how much of what came back is
      // an earlier era -- the first measure of how often mappers land on a re-audit (#4945).
      if (!this.earlierLabelsShownPreference()) this.#applyEarlierLabelsShown(false);
      this.#tracker.push('MinimapEarlierLabels_Loaded', this.countLabelsByMinimapEra());

      if (callback) callback(result);
    });
  }

  /**
   * Returns labels for the current pano ID.
   *
   * Labels are bucketed by exact pano id, and that is the whole reason a re-audit starts from a blank canvas: newer
   * imagery is a new pano id, so labels placed on the old imagery never render on it. This is deliberate (#4945),
   * not just a side effect. Reprojecting a label from one pano into another needs a depth we only estimate, and an
   * independent second look is what the per-era comparison (#4792) wants. The minimap is where the earlier pass
   * shows, as the dimmed markers. The corollary also holds on purpose: a pano whose id did not change still shows
   * its old labels, which is exactly a resumed mission.
   */
  getCanvasLabels() {
    const panoId = this.#panoManager.getPanoId();
    return this.#allLabels[panoId] ? this.#allLabels[panoId] : [];
  }

  /**
   * Get labels that need to be logged to the back-end because they are new or the user has interacted with them.
   */
  getLabelsToLog() {
    return Object.keys(this.#labelsToLog).reduce((r, k) => r.concat(this.#labelsToLog[k]), []);
  }

  getAllLabels() {
    return Object.keys(this.#allLabels).reduce((r, k) => r.concat(this.#allLabels[k]), []);
  }

  /** @returns {?Label} The label placed most recently this session. */
  getLatestLabel() {
    return this.#latestLabel;
  }

  /**
   * Adds a label to the list of labels that should be logged; called when a user interacts with an existing label.
   * @param {Label} label
   */
  addToLabelsToLog(label) {
    this.#addLabelToListObject(this.#labelsToLog, label);
  }

  clearLabelsToLog() {
    this.#labelsToLog = {};
  }

  countLabels() {
    const allLabels = this.getAllLabels();
    return allLabels.filter((l) => !l.isDeleted()).length;
  }

  /**
   * Whether the user wants earlier passes' labels shown on the minimap (#4945). Unset means shown: the toggle exists
   * to declutter on request, not to hide history by default. Also shown if storage can't be read (blocked, or a stored
   * value that isn't valid JSON): this runs ahead of the first canvas paint, which a storage error must not take out.
   * @returns {boolean}
   */
  earlierLabelsShownPreference() {
    let stored;
    try {
      stored = this.#storage.get(LabelContainer.EARLIER_LABELS_STORAGE_KEY);
    } catch (e) {
      console.warn('Could not read the minimap earlier-labels preference; showing them.', e);
      return true;
    }
    return stored === null || stored === undefined ? true : Boolean(stored);
  }

  /**
   * Live label counts by minimap era (see Label.minimapEra), for the tracker.
   * @returns {{current: number, prior: number, outdated: number}}
   */
  countLabelsByMinimapEra() {
    const counts = { current: 0, prior: 0, outdated: 0 };
    this.getAllLabels().forEach((l) => {
      if (!l.isDeleted()) counts[l.getMinimapEra()] += 1;
    });
    return counts;
  }

  /**
   * Re-derives every label's minimap era, then re-applies the legend toggle to the result. Called when the current
   * mission changes, so the mission just finished reads as the previous pass and a resumed mission's labels come back
   * as current work, markers included.
   */
  refreshMinimapEras() {
    const currentMissionId = this.#currentMissionId();
    this.getAllLabels().forEach((l) => l.refreshMinimapEra(currentMissionId));
    this.#applyEarlierLabelsShown(this.earlierLabelsShownPreference());
  }

  /**
   * The "My earlier labels" legend toggle: shows or hides the minimap markers of labels from earlier passes, logs the
   * change, and remembers it so it survives reloads and the next street. The markers move first and the preference is
   * saved second, so a storage failure (quota, blocked storage) costs only the memory of the choice, never the choice.
   * @param {boolean} shown
   */
  setEarlierLabelsShown(shown) {
    this.#applyEarlierLabelsShown(shown);
    const counts = this.countLabelsByMinimapEra();
    this.#tracker.push(shown ? 'Click_MinimapEarlierLabels_Show' : 'Click_MinimapEarlierLabels_Hide', {
      prior: counts.prior, outdated: counts.outdated,
    });
    try {
      this.#storage.set(LabelContainer.EARLIER_LABELS_STORAGE_KEY, shown);
    } catch (e) {
      console.warn('Could not save the minimap earlier-labels preference.', e);
    }
  }

  /**
   * Puts each label's minimap marker in the state the toggle asks for: earlier eras ('prior', 'outdated') hidden when
   * `shown` is false, everything else shown. Current markers are set too, not skipped, because a label whose era just
   * went back to current (a resumed mission) may still be suppressed from when it was earlier. Announces the setting,
   * since this is also reached from the stored preference, not only from the legend's checkbox.
   * @param {boolean} shown
   */
  #applyEarlierLabelsShown(shown) {
    this.getAllLabels().forEach((l) => {
      l.setMinimapMarkerSuppressed(!shown && l.getMinimapEra() !== 'current');
    });
    this.#earlierLabelsShownListeners.forEach((listener) => listener(shown));
  }

  /**
   * Whether a label may be deleted right now: nothing holds deleting, and in the tutorial it is the label just placed,
   * since the tutorial's delete step is about the misplaced label it asked for.
   * @param {Label} label
   * @returns {boolean}
   */
  canDelete(label) {
    if (!label || this.deleting.isHeld()) return false;
    return !this.#config.isOnboarding || label === this.#latestLabel;
  }

  /**
   * @param {Label} label
   * @returns {boolean} False when the label may not be deleted (see canDelete).
   */
  removeLabel(label) {
    if (!this.canDelete(label)) return false;
    this.#tracker.push('RemoveLabel', { labelType: label.getProperty('labelType') }, label);
    this.#overallStats.decrementLabelCount();
    label.remove();
    this.#addLabelToListObject(this.#labelsToLog, label);
    this.#removedListeners.forEach((listener) => listener(label));
    return true;
  }
}
