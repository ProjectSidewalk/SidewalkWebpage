/**
 * Handles compiling and submitting Explore/Audit interaction data to the back end.
 */
class Form {
  #labelContainer;
  #missionModel;
  #missionContainer;
  #panoStore;
  #taskContainer;
  #tracker;
  #dataStoreUrl;
  #lastPriorityUpdateTime;
  #compileDataLock;

  /**
     * @param {LabelContainer} labelContainer - Holds the labels placed during the current session.
     * @param {MissionModel} missionModel - Emits mission lifecycle events (e.g. progress completion).
     * @param {MissionContainer} missionContainer - Tracks the current mission and its progress.
     * @param {PanoStore} panoStore - Holds metadata for the panoramas seen this session.
     * @param {TaskContainer} taskContainer - Tracks the current audit task.
     * @param {Tracker} tracker - Buffers the interaction log to be flushed to the back end.
     * @param {string} dataStoreUrl - URL to POST submission data to.
     */
  constructor(labelContainer, missionModel, missionContainer, panoStore, taskContainer, tracker, dataStoreUrl) {
    this.#labelContainer = labelContainer;
    this.#missionModel = missionModel;
    this.#missionContainer = missionContainer;
    this.#panoStore = panoStore;
    this.#taskContainer = taskContainer;
    this.#tracker = tracker;
    this.#dataStoreUrl = dataStoreUrl;
    this.#lastPriorityUpdateTime = new Date(); // Assumes that priorities are up-to-date when the page loads.
    this.#compileDataLock = new AsyncLock();

    this.#missionModel.on('MissionProgress:complete', () => {
      this.submitData(this.#taskContainer.getCurrentTask());
    });

    // Flush any remaining logs when the page is being dismissed. `pagehide` is the reliable, bfcache-compatible
    // unload signal; `keepalive` lets the POST outlive the page while still routing through AppManager's fetch
    // wrapper, which attaches the `Csrf-Token` header Play's CSRF filter requires (#3935).
    window.addEventListener('pagehide', () => {
      this.#tracker.push('Unload');
      const task = this.#taskContainer.getCurrentTask();
      const data = this.#compileSubmissionData(task);
      fetch(this.#dataStoreUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(data),
        keepalive: true,
      });
    });
  }

  /**
     * Gathers all the data needed to submit logs to the back end.
     *
     * @param {Task} task - The audit task to compile submission data for.
     * @returns {Object} The JSON data to submit to the back end.
     */
  #compileSubmissionData(task) {
    const mission = this.#missionContainer.getCurrentMission();
    const missionId = mission.getProperty('missionId');
    mission.updateDistanceProgress();

    const data = {
      timestamp: new Date(),
      user_route_id: svl.userRouteId,
      mission: {
        mission_id: missionId,
        distance_progress: Math.min(mission.getProperty('distanceProgress'), mission.getProperty('distance')),
        region_id: svl.regionId,
        completed: mission.getProperty('isComplete'),
        audit_task_id: task.getAuditTaskId(),
        skipped: mission.getProperty('skipped'),
      },
      audit_task: {
        street_edge_id: task.getStreetEdgeId(),
        task_start: task.getProperty('taskStart'),
        audit_task_id: task.getAuditTaskId(),
        completed: task.isComplete(),
        current_lat: svl.panoViewer.getPosition().lat,
        current_lng: svl.panoViewer.getPosition().lng,
        start_point_reversed: task.getProperty('startPointReversed'),
        current_mission_start: task.getMissionStart(missionId),
        last_priority_update_time: this.#lastPriorityUpdateTime,
        // Request updated street priorities if we are at least 60% of the way through the current street.
        request_updated_street_priority: !svl.isOnboarding() && (task.getAuditedDistance() / task.lineDistance()) > 0.6,
      },
      environment: {
        browser: util.getBrowser(),
        browser_version: util.getBrowserVersion(),
        browser_width: $(window).width(),
        browser_height: $(window).height(),
        screen_width: screen.width,
        screen_height: screen.height,
        avail_width: screen.availWidth,              // total width - interface (taskbar)
        avail_height: screen.availHeight,            // total height - interface
        operating_system: util.getOperatingSystem(),
        language: i18next.language,
        css_zoom: 100, // Sent for back-end compatibility; UI scaling is done via real layout sizes (--ui-scale).
      },
    };

    data.interactions = this.#tracker.getActions();
    this.#tracker.refresh();

    data.labels = [];
    const labels = this.#labelContainer.getLabelsToLog();
    for (let i = 0, labelLen = labels.length; i < labelLen; i += 1) {
      const label = labels[i];
      const prop = label.getProperties();
      const labelLatLng = label.toLatLng();
      const tempLabelId = label.getProperty('temporaryLabelId');
      const panoData = this.#panoStore.getPanoData(prop.panoId);

      // If this label is a new label, get the timestamp of its creation from the corresponding interaction.
      const associatedInteraction = data.interactions.find((interaction) =>
        interaction.action === 'LabelingCanvas_FinishLabeling'
        && interaction.temporary_label_id === tempLabelId);
      const timeCreated = associatedInteraction ? associatedInteraction.timestamp : null;

      const temp = {
        deleted: label.isDeleted(),
        label_type: label.getLabelType(),
        temporary_label_id: tempLabelId,
        pano_id: prop.panoId,
        pano_source: panoData.getProperty('source'),
        severity: label.getProperty('severity'),
        tag_ids: label.getProperty('tagIds'),
        description: label.getProperty('description') || null,
        time_created: timeCreated,
        tutorial: prop.tutorial,
        label_point: {
          pano_x: Math.round(prop.panoXY.x),
          pano_y: Math.round(prop.panoXY.y),
          canvas_x: prop.originalCanvasXY.x,
          canvas_y: prop.originalCanvasXY.y,
          heading: prop.originalPov.heading,
          pitch: prop.originalPov.pitch,
          zoom: prop.originalPov.zoom,
          lat: null,
          lng: null,
        },
      };

      if (labelLatLng) {
        temp.label_point.lat = labelLatLng.lat;
        temp.label_point.lng = labelLatLng.lng;
        temp.label_point.computation_method = labelLatLng.latLngComputationMethod;
      }

      data.labels.push(temp);
    }

    // Keep pano metadata. This is particularly important to keep track of the date when the images were taken.
    data.panos = [];

    let temp;
    const panoramas = this.#panoStore.getStagedPanoData();
    for (let i = 0; i < panoramas.length; i++) {
      const panoData = panoramas[i].getProperties();
      const links = panoData.linkedPanos.map((link) => {
        return {
          target_pano_id: link.panoId,
          yaw_deg: link.heading,
          description: link.description || null,
        };
      });
      const history = panoData.history.map((prevPano) => {
        return {
          pano_id: prevPano.panoId,
          date: prevPano.captureDate.format('YYYY-MM'),
        };
      });

      temp = {
        pano_id: panoData.panoId,
        source: panoData.source,
        capture_date: panoData.captureDate.format('YYYY-MM'),
        width: panoData.width,
        height: panoData.height,
        tile_width: panoData.tileWidth,
        tile_height: panoData.tileHeight,
        lat: panoData.lat,
        lng: panoData.lng,
        camera_heading: panoData.cameraHeading,
        camera_pitch: panoData.cameraPitch,
        camera_roll: panoData.cameraRoll,
        links,
        copyright: panoData.copyright || null,
        history,
      };

      data.panos.push(temp);
      panoramas[i].setProperty('submitted', true);
    }
    return data;
  }

  /**
     * Submit the compiled data to the back end and apply the server's response.
     *
     * @param {Object} data - The compiled submission data.
     * @param {Task} task - The audit task the data belongs to.
     * @returns {Promise<void>}
     */
  #submit(data, task) {
    this.#labelContainer.clearLabelsToLog();

    return fetch(this.#dataStoreUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(data),
    })
      .then((response) => response.json())
      .then((result) => {
        task.setProperty('auditTaskId', result.audit_task_id);
        svl.tracker.setAuditTaskID(result.audit_task_id);

        // If the back-end says that something is messed up and that we should refresh page, do that now.
        if (result.refresh_page) window.location.reload();

        // If a new mission was sent and we aren't in onboarding, create an object for it on the front-end.
        if (result.mission && !svl.isOnboarding()) this.#missionModel.createAMission(result.mission);

        // Update the priority of streets audited by other users that are auditing at the same time.
        if (result.updated_streets) {
          this.#lastPriorityUpdateTime = result.updated_streets.last_priority_update_time;
          this.#taskContainer.updateTaskPriorities(result.updated_streets.updated_street_priorities);
        }

        // Update labels with their official label_id from the server.
        if (!svl.isOnboarding()) {
          for (const lab of result.label_ids) {
            this.#labelContainer.getAllLabels()
              .find((l) => l.getProperty('temporaryLabelId') === lab.temporary_label_id)
              .updateLabelIdAndUploadCrop(lab.label_id);
          }
        }
      })
      .catch(() => {
        window.location.reload(); // Refresh the page in case the server has gone down.
      });
  }

  /**
     * Compile and submit existing logs to the server. Uses a lock to prevent duplicate logging.
     *
     * @param {Task} [task] - The task to submit data for. If not provided, the current task is used.
     * @returns {Promise<void>}
     */
  async submitData(task) {
    return await this.#compileDataLock.acquire('submitData', async () => {
      if (typeof task === 'undefined') {
        task = this.#taskContainer.getCurrentTask();
      }
      const data = this.#compileSubmissionData(task);
      await this.#submit(data, task);
    });
  }
}
