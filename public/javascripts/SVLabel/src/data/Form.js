/**
 *
 * @param labelContainer
 * @param missionModel
 * @param missionContainer
 * @param panoStore
 * @param taskContainer
 * @param navigationService
 * @param compass
 * @param tracker
 * @param dataStoreUrl
 * @returns {{className: string}}
 * @constructor
 */
function Form (labelContainer, missionModel, missionContainer, panoStore, taskContainer, navigationService, compass, tracker, dataStoreUrl) {
    var self = this;
    let properties = {
        dataStoreUrl : undefined,
        beaconDataStoreUrl : undefined,
        lastPriorityUpdateTime : new Date() // Assumes that priorities are up-to-date when the page loads.
    };
    const compileDataLock = new AsyncLock();

    missionModel.on("MissionProgress:complete", () => {
        self.submitData(taskContainer.getCurrentTask());
    });

    /**
     * Gathers all the data needed to submit logs to back end. Uses a lock to prevent duplicate logging.
     * @param task
     * @returns {object} The JSON data to submit to the back end.
     */
    const _compileSubmissionData = (task) => {
        const mission = missionContainer.getCurrentMission();
        const missionId = mission.getProperty("missionId");
        mission.updateDistanceProgress();

        let data = {
            timestamp: new Date(),
            user_route_id: svl.userRouteId,
            mission: {
                mission_id: missionId,
                distance_progress: Math.min(mission.getProperty("distanceProgress"), mission.getProperty("distance")),
                region_id: svl.regionId,
                completed: mission.getProperty("isComplete"),
                audit_task_id: task.getAuditTaskId(),
                skipped: mission.getProperty("skipped")
            },
            audit_task: {
                street_edge_id: task.getStreetEdgeId(),
                task_start: task.getProperty("taskStart"),
                audit_task_id: task.getAuditTaskId(),
                completed: task.isComplete(),
                current_lat: svl.panoViewer.getPosition().lat,
                current_lng: svl.panoViewer.getPosition().lng,
                start_point_reversed: task.getProperty("startPointReversed"),
                current_mission_start: task.getMissionStart(missionId),
                last_priority_update_time: properties.lastPriorityUpdateTime,
                // Request updated street priorities if we are at least 60% of the way through the current street.
                request_updated_street_priority: !svl.isOnboarding() && (task.getAuditedDistance() / task.lineDistance()) > 0.6
            },
            environment: {
                browser: util.getBrowser(),
                browser_version: util.getBrowserVersion(),
                browser_width: $(window).width(),
                browser_height: $(window).height(),
                screen_width: screen.width,
                screen_height: screen.height,
                avail_width: screen.availWidth,              // total width - interface (taskbar)
                avail_height: screen.availHeight,            // total height - interface };
                operating_system: util.getOperatingSystem(),
                language: i18next.language,
                css_zoom: svl.cssZoom || 100
            }
        };

        data.interactions = tracker.getActions();
        tracker.refresh();

        data.labels = [];
        const labels = labelContainer.getLabelsToLog();
        for (let i = 0, labelLen = labels.length; i < labelLen; i += 1) {
            let label = labels[i];
            let prop = label.getProperties();
            const labelLatLng = label.toLatLng();
            const tempLabelId = label.getProperty('temporaryLabelId');
            const auditTaskId = label.getProperty('auditTaskId');
            const panoData = panoStore.getPanoData(prop.panoId);

            // If this label is a new label, get the timestamp of its creation from the corresponding interaction.
            const associatedInteraction = data.interactions.find(interaction =>
                interaction.action === 'LabelingCanvas_FinishLabeling'
                && interaction.temporary_label_id === tempLabelId
                && interaction.audit_task_id === auditTaskId);
            const timeCreated = associatedInteraction ? associatedInteraction.timestamp : null;

            let temp = {
                deleted : label.isDeleted(),
                label_type : label.getLabelType(),
                temporary_label_id: tempLabelId,
                audit_task_id: auditTaskId,
                pano_id: prop.panoId,
                pano_source: panoData.getProperty('source'),
                severity: label.getProperty('severity'),
                tag_ids: label.getProperty('tagIds'),
                description: label.getProperty('description') || null,
                time_created: timeCreated,
                tutorial: prop.tutorial,
                label_point: {
                    pano_x : Math.round(prop.panoXY.x),
                    pano_y : Math.round(prop.panoXY.y),
                    canvas_x: prop.originalCanvasXY.x,
                    canvas_y: prop.originalCanvasXY.y,
                    heading: prop.originalPov.heading,
                    pitch: prop.originalPov.pitch,
                    zoom : prop.originalPov.zoom,
                    lat : null,
                    lng : null
                }
            };

            if (labelLatLng) {
                temp.label_point.lat = labelLatLng.lat;
                temp.label_point.lng = labelLatLng.lng;
                temp.label_point.computation_method = labelLatLng.latLngComputationMethod;
            }

            data.labels.push(temp)
        }

        // Keep pano metadata. This is particularly important to keep track of the date when the images were taken.
        data.panos = [];

        let temp;
        const panoramas = panoStore.getStagedPanoData();
        for (let i = 0; i < panoramas.length; i++) {
            const panoData = panoramas[i].getProperties();
            const links = panoData.linkedPanos.map(function(link) {
                return {
                    target_pano_id: link.panoId,
                    yaw_deg: link.heading,
                    description: link.description || null
                }
            });
            const history = panoData.history.map(function(prevPano) {
                return {
                    pano_id: prevPano.panoId,
                    date: prevPano.captureDate.format('YYYY-MM')
                }
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
                links: links,
                copyright: panoData.copyright || null,
                history: history
            };

            data.panos.push(temp);
            panoramas[i].setProperty('submitted', true);
        }
        return data;
    };

    /**
     * Submit the data via an AJAX post request.
     * @param data
     * @param task
     */
    this._submit = function (data, task) {
        labelContainer.clearLabelsToLog();

        return fetch(properties.dataStoreUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(data)
        })
            .then((response) => response.json())
            .then((result) => {
                task.setProperty('auditTaskId', result.audit_task_id);
                svl.tracker.setAuditTaskID(result.audit_task_id);

                // If the back-end says that something is messed up and that we should refresh page, do that now.
                if (result.refresh_page) window.location.reload();

                // If a new mission was sent and we aren't in onboarding, create an object for it on the front-end.
                if (result.mission && !svl.isOnboarding()) missionModel.createAMission(result.mission);

                // Update the priority of streets audited by other users that are auditing at the same time.
                if (result.updated_streets) {
                    properties.lastPriorityUpdateTime = result.updated_streets.last_priority_update_time;
                    taskContainer.updateTaskPriorities(result.updated_streets.updated_street_priorities);
                }

                // Update labels with their official label_id from the server.
                if (!svl.isOnboarding()) {
                    for (const lab of result.label_ids) {
                        labelContainer.getAllLabels()
                            .find(l => l.getProperty('temporaryLabelId') === lab.temporary_label_id)
                            .updateLabelIdAndUploadCrop(lab.label_id);
                    }
                }
            })
            .catch(error => {
                window.location.reload(); // Refresh the page in case the server has gone down.
            });
    };

    properties.dataStoreUrl = dataStoreUrl;
    properties.beaconDataStoreUrl = dataStoreUrl + 'Beacon';

    $(window).on('beforeunload', function () {
        tracker.push("Unload");

        // April 17, 2019
        // What we want here is type: 'application/json'. Can't do that quite yet because the
        // feature has been disabled, but we should switch back when we can.

        // For now, we send plaintext and the server converts it to actual JSON

        // Source for fix and ongoing discussion is here:
        // https://bugs.chromium.org/p/chromium/issues/detail?id=490015
        const task = taskContainer.getCurrentTask();
        const data = _compileSubmissionData(task);
        const jsonData = JSON.stringify(data);
        navigator.sendBeacon(properties.beaconDataStoreUrl, jsonData);
    });

    /**
     * Compile and submit existing logs to the server.
     * @param {Task} [task] The task to submit data for. If not provided, the current task is used.
     */
    this.submitData = async function(task) {
        return await compileDataLock.acquire('submitData', async () => {
            if (typeof task === "undefined") {
                task = taskContainer.getCurrentTask();
            }
            const data = _compileSubmissionData(task);
            await self._submit(data, task);
        });
    }
}
