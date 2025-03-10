/**
 *
 * @param labelContainer
 * @param missionModel
 * @param missionContainer
 * @param navigationModel
 * @param panoramaContainer
 * @param taskContainer
 * @param mapService
 * @param compass
 * @param tracker
 * @param params
 * @returns {{className: string}}
 * @constructor
 */
function Form (labelContainer, missionModel, missionContainer, navigationModel, panoramaContainer, taskContainer, mapService, compass, tracker, params) {
    var self = this;
    let properties = {
        dataStoreUrl : undefined,
        beaconDataStoreUrl : undefined,
        lastPriorityUpdateTime : new Date() // Assumes that priorities are up-to-date when the page loads.
    };
    const compileDataLock = new AsyncLock();

    missionModel.on("MissionProgress:complete", function (parameters) {
        self.submitData(taskContainer.getCurrentTask(), true);
    });

    this.convertPanoHistoryFormat = function (prevPanos) {
        var history = [];
        for (let i = 0; i < prevPanos.length; i++) {
            history.push({
                pano_id: prevPanos[i].pano,
                date: moment(prevPanos[i].Gw).format('YYYY-MM')
            });
        }
        return history;
    }

    /**
     * Gathers all the data needed to submit logs to back end. Uses a lock to prevent duplicate logging.
     * @param task
     * @returns {Promise<*>}
     */
    this._compileSubmissionData = async function (task) {
        return await compileDataLock.acquire('_compileSubmissionData', async () => {
            var data = { timestamp: new Date() };
            data.amt_assignment_id = svl.amtAssignmentId;
            data.user_route_id = svl.userRouteId;

            var mission = missionContainer.getCurrentMission();
            var missionId = mission.getProperty("missionId");
            mission.updateDistanceProgress();
            data.mission = {
                mission_id: missionId,
                distance_progress: Math.min(mission.getProperty("distanceProgress"), mission.getProperty("distance")),
                completed: mission.getProperty("isComplete"),
                audit_task_id: task.getAuditTaskId(),
                skipped: mission.getProperty("skipped")
            };

            data.audit_task = {
                street_edge_id: task.getStreetEdgeId(),
                task_start: task.getProperty("taskStart"),
                audit_task_id: task.getAuditTaskId(),
                completed: task.isComplete(),
                current_lat: navigationModel.getPosition().lat,
                current_lng: navigationModel.getPosition().lng,
                start_point_reversed: task.getProperty("startPointReversed"),
                current_mission_start: task.getMissionStart(missionId),
                last_priority_update_time: properties.lastPriorityUpdateTime,
                // Request updated street priorities if we are at least 60% of the way through the current street.
                request_updated_street_priority: !svl.isOnboarding() && (task.getAuditedDistance() / task.lineDistance()) > 0.6
            };

            data.environment = {
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
                css_zoom: svl.cssZoom ? svl.cssZoom : 100
            };

            data.interactions = tracker.getActions();
            tracker.refresh();

            data.labels = [];
            var labels = labelContainer.getLabelsToLog();
            for (var i = 0, labelLen = labels.length; i < labelLen; i += 1) {
                var label = labels[i];
                var prop = label.getProperties();
                var labelLatLng = label.toLatLng();
                var tempLabelId = label.getProperty('temporaryLabelId');
                var auditTaskId = label.getProperty('auditTaskId');

                // If this label is a new label, get the timestamp of its creation from the corresponding interaction.
                var associatedInteraction = data.interactions.find(interaction =>
                    interaction.action === 'LabelingCanvas_FinishLabeling'
                    && interaction.temporary_label_id === tempLabelId
                    && interaction.audit_task_id === auditTaskId);
                var timeCreated = associatedInteraction ? associatedInteraction.timestamp : null;

                var temp = {
                    deleted : label.isDeleted(),
                    label_type : label.getLabelType(),
                    temporary_label_id: tempLabelId,
                    audit_task_id: auditTaskId,
                    gsv_panorama_id : prop.panoId,
                    severity: label.getProperty('severity'),
                    temporary: label.getProperty('temporaryLabel'),
                    tag_ids: label.getProperty('tagIds'),
                    description: label.getProperty('description') ? label.getProperty('description') : null,
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

            // Keep Street View metadata. This is particularly important to keep track of the date when the images were
            // taken (i.e., the date of the accessibility attributes).
            data.gsv_panoramas = [];

            var temp;
            var panoData;
            var link;
            var links;
            var panoramas = panoramaContainer.getStagedPanoramas();
            for (var i = 0, panoramaLen = panoramas.length; i < panoramaLen; i++) {
                panoData = panoramas[i].data();
                links = [];
                if ("links" in panoData) {
                    for (j = 0; j < panoData.links.length; j++) {
                        link = panoData.links[j];
                        links.push({
                            target_gsv_panorama_id: ("pano" in link) ? link.pano : "",
                            yaw_deg: ("heading" in link) ? link.heading : 0.0,
                            description: ("description" in link) ? link.description : ""
                        });
                    }
                }

                var panoId = ("location" in panoData && "pano" in panoData.location) ? panoData.location.pano : "";
                temp = {
                    panorama_id: panoId,
                    capture_date: "imageDate" in panoData ? panoData.imageDate : "",
                    width: panoData.tiles.worldSize.width,
                    height: panoData.tiles.worldSize.height,
                    tile_width: panoData.tiles.tileSize.width,
                    tile_height: panoData.tiles.tileSize.height,
                    lat: panoData.location.latLng.lat(),
                    lng: panoData.location.latLng.lng(),
                    camera_heading: panoData.tiles.originHeading,
                    camera_pitch: -panoData.tiles.originPitch, // camera_pitch is negative origin_pitch.
                    links: links,
                    copyright: "copyright" in panoData ? panoData.copyright : "",
                    history: []
                };

                if (panoData.time !== undefined && panoId !== "") {
                    temp.history = this.convertPanoHistoryFormat(panoData.time);
                }

                data.gsv_panoramas.push(temp);
                panoramas[i].setProperty("submitted", true);
            }
            return data;
        });
    };

    this._prepareSkipData = function (issueDescription) {
        var position = navigationModel.getPosition();
        return {
            issue_description: issueDescription,
            lat: position.lat,
            lng: position.lng
        };
    };

    this.skip = function (task, skipReasonLabel) {
        var data = self._prepareSkipData(skipReasonLabel);

        if (skipReasonLabel === "GSVNotAvailable") {
            taskContainer.endTask(task);
            missionContainer.getCurrentMission().pushATaskToTheRoute(task);
            util.misc.reportNoStreetView(task.getStreetEdgeId());
        } else {
            // Set the tasksMissionsOffset so that the mission progress bar remains the same after the jump.
            var currTaskDist = util.math.kilometersToMeters(taskContainer.getCurrentTaskDistance());
            var oldOffset = missionContainer.getTasksMissionsOffset();
            missionContainer.setTasksMissionsOffset(oldOffset + currTaskDist);
        }

        self.skipSubmit(data, task);

        // If the jump was clicked in the middle of the beforeJumpTask, reset the beforeJump tracking parameters.
        var jumpListenerStatus = mapService.getLabelBeforeJumpListenerStatus();
        if (jumpListenerStatus) {
            mapService.setLabelBeforeJumpListenerStatus(false);
            compass.resetBeforeJump();
            mapService.finishCurrentTaskBeforeJumping();
        }

        taskContainer.getFinishedAndInitNextTask(task);

        if (svl.neighborhoodModel.isRouteOrNeighborhoodComplete()) {
            svl.neighborhoodModel.trigger("Neighborhood:wrapUpRouteOrNeighborhood");
        }
    };

    /**
     * Submit the data collected so far and move to another location.
     *
     * @param dataIn An object that has issue_description, lat, and lng as fields.
     * @param task
     * @returns {boolean}
     */
    this.skipSubmit = function (dataIn, task) {
        tracker.push('TaskSkip');

        self._compileSubmissionData(task).then(data => {
            data.incomplete = dataIn;
            self._submit(data, task);
        });

        return false;
    };

    /**
     * Submit the data via an AJAX post request.
     * @param data
     * @param task
     * @param async
     */
    this._submit = function (data, task, async) {
        if (typeof async === "undefined") { async = true; }
        labelContainer.clearLabelsToLog();

        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: properties.dataStoreUrl,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                if (result) {
                    var taskId = result.audit_task_id;
                    task.setProperty("auditTaskId", taskId);
                    svl.tracker.setAuditTaskID(taskId);

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
                }
            },
            error: function (result) {
                window.location.reload(); // Refresh the page in case the server has gone down.
            }
        });
    };

    properties.dataStoreUrl = params.dataStoreUrl;
    properties.beaconDataStoreUrl = params.beaconDataStoreUrl;

    $(window).on('beforeunload', function () {
        tracker.push("Unload");

        // // April 17, 2019
        // // What we want here is type: 'application/json'. Can't do that quite yet because the
        // // feature has been disabled, but we should switch back when we can.
        //
        // // For now, we send plaintext and the server converts it to actual JSON
        //
        // // Source for fix and ongoing discussion is here:
        // // https://bugs.chromium.org/p/chromium/issues/detail?id=490015
        var task = taskContainer.getCurrentTask();
        self._compileSubmissionData(task).then(data => {
            var jsonData = JSON.stringify(data);
            navigator.sendBeacon(properties.beaconDataStoreUrl, jsonData);
        });
    });

    /**
     * Compile and submit existing logs to the server.
     * @param task      The task to submit data for. If not provided, the current task is used.
     * @param asyncAjax Whether AJAX call to submit data should be done asynchronously or not (true by default).
     */
    this.submitData = async function(task, asyncAjax = true) {
        if (typeof task === "undefined") { task = taskContainer.getCurrentTask(); }
        const data = await self._compileSubmissionData(task);
        self._submit(data, task, asyncAjax);
    }
}
