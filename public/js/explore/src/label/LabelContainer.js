/**
 * Label Container module. This is responsible for storing the label objects that were created in the current session.
 *
 * @memberof svl
 */
class LabelContainer {
  // localStorage key for the minimap legend's "My earlier labels" toggle (#4945). Remembered across sessions because
  // a mapper who hides earlier labels to declutter a re-audit wants them hidden on the next street too.
  static EARLIER_LABELS_STORAGE_KEY = 'minimapShowEarlierLabels';

  #jquery;
  #labelsToLog = {};
  #allLabels = {};
  #nextTempLabelId;

  /**
   * @param {JQueryStatic} $ - jQuery object.
   * @param {number} nextTemporaryLabelId
   */
  constructor($, nextTemporaryLabelId) {
    this.#jquery = $;
    this.#nextTempLabelId = nextTemporaryLabelId;
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

  /**
   * Create a Label object. If the label is new, it won't have a labelId yet, so we assign a temporary one.
   * @returns {Label}
   */
  createLabel(params, isNew) {
    if (isNew) {
      params.temporaryLabelId = this.#nextTempLabelId;
      this.#nextTempLabelId++;
    }
    const label = new Label(params);

    // If in tutorial, update the current label id field in onboarding.
    if (svl.onboarding) {
      svl.onboarding.setCurrentLabelId(label.getProperty('temporaryLabelId'));
    }

    // Add to list of labels. If new, also add to current canvas labels.
    if (isNew) {
      this.#addLabelToListObject(this.#labelsToLog, label);
      svl.overallStats.incrementLabelCount();

      // Save a screenshot of the pano when a new label is placed.
      // Use the setTimeout to avoid blocking UI rendering and interactions.
      if (svl.makeCrops && !params.tutorial) {
        setTimeout(() => {
          try {
            svl.canvas.saveCanvasScreenshot(label);
          } catch (e) {
            // todo: better logging
            console.log('Error saving pano screenshot: ', e);
          }
        }, 0);
      }
    }
    this.#addLabelToListObject(this.#allLabels, label);

    return label;
  }

  /**
   * Query server for previous labels placed by this user and create label objects for them.
   * @param {number} regionId
   * @param {(result: object) => void} [callback]
   */
  fetchLabelsToResumeMission(regionId, callback) {
    this.#jquery.getJSON('/label/resumeMission', { regionId }, (result) => {
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

        const viewerType = svl.panoViewer.getViewerType();
        const povOfLabelIfCentered = util.pano.canvasCoordToCenteredPov(
          labelArr[i].originalPov, originalCanvasXY.x, originalCanvasXY.y,
          originalCanvasFrame.width, originalCanvasFrame.height,
          util.pano.renderedHFov(
            labelArr[i].originalPov.zoom, originalCanvasFrame.width / originalCanvasFrame.height, viewerType,
          ),
        );
        const currPov = svl.panoViewer.getPov();
        labelArr[i].currCanvasXY = util.pano.centeredPovToCanvasCoord(
          povOfLabelIfCentered, currPov,
          svl.CANVAS_FRAME.width, svl.CANVAS_FRAME.height, svl.LABEL_ICON_RADIUS, svl.renderedHFov(currPov.zoom),
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
      if (!LabelContainer.earlierLabelsShownPreference()) this.#applyEarlierLabelsShown(false);
      svl.tracker.push('MinimapEarlierLabels_Loaded', this.countLabelsByMinimapEra());

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
    const panoId = svl.panoViewer.getPanoId();
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

  /**
   * Find a label with matching temporary ID.
   * @param {number} tempId
   */
  findLabelByTempId(tempId) {
    const matchingLabels = this.getCanvasLabels().filter((l) => l.getProperty('temporaryLabelId') === tempId);
    if (matchingLabels.length > 1) {
      console.warn('Multiple labels with same temp ID!');
      console.log(this.getCanvasLabels());
    }
    // Returns most recent version of label (though there shouldn't be multiple).
    return matchingLabels[matchingLabels.length - 1];
  }

  /**
   * Adds a label to the list of labels that should be logged; called when a user interacts with an existing label.
   * @param {number} tempId
   */
  addToLabelsToLog(tempId) {
    const match = this.findLabelByTempId(tempId);
    if (match) this.#addLabelToListObject(this.#labelsToLog, match);
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
  static earlierLabelsShownPreference() {
    let stored;
    try {
      stored = svl.storage?.get(LabelContainer.EARLIER_LABELS_STORAGE_KEY);
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
    this.getAllLabels().forEach((l) => l.refreshMinimapEra());
    this.#applyEarlierLabelsShown(LabelContainer.earlierLabelsShownPreference());
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
    svl.tracker.push(shown ? 'Click_MinimapEarlierLabels_Show' : 'Click_MinimapEarlierLabels_Hide', {
      prior: counts.prior, outdated: counts.outdated,
    });
    try {
      svl.storage?.set(LabelContainer.EARLIER_LABELS_STORAGE_KEY, shown);
    } catch (e) {
      console.warn('Could not save the minimap earlier-labels preference.', e);
    }
  }

  /**
   * Puts each label's minimap marker in the state the toggle asks for: earlier eras ('prior', 'outdated') hidden when
   * `shown` is false, everything else shown. Current markers are set too, not skipped, because a label whose era just
   * went back to current (a resumed mission) may still be suppressed from when it was earlier. Keeps the legend
   * checkbox in step, since this is also reached from the stored preference, not only from the checkbox.
   * @param {boolean} shown
   */
  #applyEarlierLabelsShown(shown) {
    this.getAllLabels().forEach((l) => {
      l.setMinimapMarkerSuppressed(!shown && l.getMinimapEra() !== 'current');
    });
    svl.ui?.minimap?.legendEarlierLabels?.prop('checked', shown);
  }

  /**
   * Removes a passed label, updates the canvas, and updates label counts.
   */
  removeLabel(label) {
    if (!label) {
      return false;
    }
    svl.tracker.push('RemoveLabel', { labelType: label.getProperty('labelType') });
    if (svl.isOnboarding()) this.#jquery(document).trigger('RemoveLabel');
    svl.overallStats.decrementLabelCount();
    label.remove();
    this.#addLabelToListObject(this.#labelsToLog, label);
    svl.canvas.clear().render();
    return this;
  }
}
