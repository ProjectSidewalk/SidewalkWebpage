/**
 *
 * @param labelContainer
 * @param missionModel
 * @param missionContainer
 * @param navigationModel
 * @param neighborhoodModel
 * @param panoramaContainer
 * @param taskContainer
 * @param mapService
 * @param compass
 * @param tracker
 * @param params
 * @returns {{className: string}}
 * @constructor
 */
function Form (labelContainer, missionModel, missionContainer, navigationModel, neighborhoodModel, panoramaContainer, taskContainer, mapService, compass, tracker, params) {
    var self = this;
    var properties = {
        dataStoreUrl : undefined
    };

    missionModel.on("MissionProgress:complete", function (parameters) {
        self.submitData(true);
    });

    /**
     * This method gathers all the data needed for submission.
     * @returns {{}}
     */
    this.compileSubmissionData = function (task) {
        var data = {};

        data.amt_assignment_id = svl.amtAssignmentId;

        var mission = missionContainer.getCurrentMission();
        mission.updateDistanceProgress();
        data.mission = {
            mission_id: mission.getProperty("missionId"),
            distance_progress: Math.min(mission.getProperty("distanceProgress"), mission.getProperty("distance")),
            completed: mission.getProperty("isComplete"),
            skipped: mission.getProperty("skipped")
        };

        data.audit_task = {
            street_edge_id: task.getStreetEdgeId(),
            task_start: task.getTaskStart(),
            audit_task_id: task.getAuditTaskId(),
            completed: task.isComplete()
        };

        data.environment = {
            browser: util.getBrowser(),
            browser_version: util.getBrowserVersion(),
            browser_width: $(window).width(),
            browser_height: $(window).height(),
            screen_width: screen.width,
            screen_height: screen.height,
            avail_width: screen.availWidth,		// total width - interface (taskbar)
            avail_height: screen.availHeight,		// total height - interface };
            operating_system: util.getOperatingSystem()
        };

        data.interactions = tracker.getActions();
        tracker.refresh();

        data.labels = [];
        var labels = labelContainer.getCurrentLabels();
        for(var i = 0, labelLen = labels.length; i < labelLen; i += 1) {
            var label = labels[i];
            var prop = label.getProperties();
            var points = label.getPath().getPoints();
            var labelLatLng = label.toLatLng();
            var tempLabelId = label.getProperty('temporary_label_id');
            var auditTaskId = label.getProperty('audit_task_id');

            // if this label is a new label, get the timestamp of its creation from the corresponding interaction
            var associatedInteraction = data.interactions.find(interaction =>
                interaction.action === 'LabelingCanvas_FinishLabeling' && interaction.temporary_label_id === tempLabelId
                && interaction.audit_task_id === auditTaskId);
            var timeCreated = associatedInteraction ? associatedInteraction.timestamp : null;


            var temp = {
                deleted : label.isDeleted(),
                label_id : label.getLabelId(),
                label_type : label.getLabelType(),
                photographer_heading : prop.photographerHeading,
                photographer_pitch : prop.photographerPitch,
                panorama_lat: prop.panoramaLat,
                panorama_lng: prop.panoramaLng,
                temporary_label_id: tempLabelId,
                audit_task_id: auditTaskId,
                gsv_panorama_id : prop.panoId,
                label_points : [],
                severity: label.getProperty('severity'),
                temporary_label: label.getProperty('temporaryLabel'),
                tag_ids: label.getProperty('tagIds'),
                description: label.getProperty('description'),
                time_created: timeCreated,
                tutorial: prop.tutorial
            };

            for (var j = 0, pathLen = points.length; j < pathLen; j += 1) {
                var point = points[j],
                    gsvImageCoordinate = point.getGSVImageCoordinate(),
                    pointParam = {
                        sv_image_x : gsvImageCoordinate.x,
                        sv_image_y : gsvImageCoordinate.y,
                        canvas_x: point.originalCanvasCoordinate.x,
                        canvas_y: point.originalCanvasCoordinate.y,
                        heading: point.panoramaPov.heading,
                        pitch: point.panoramaPov.pitch,
                        zoom : point.panoramaPov.zoom,
                        canvas_height : prop.canvasHeight,
                        canvas_width : prop.canvasWidth,
                        alpha_x : prop.canvasDistortionAlphaX,
                        alpha_y : prop.canvasDistortionAlphaY,
                        lat : null,
                        lng : null
                    };

                if (labelLatLng) {
                    pointParam.lat = labelLatLng.lat;
                    pointParam.lng = labelLatLng.lng;
                }
                temp.label_points.push(pointParam);
            }

            data.labels.push(temp)
        }

        // Keep Street View meta data. This is particularly important to keep track of the date when the images were taken (i.e., the date of the accessibility attributes).
        data.gsv_panoramas = [];

        var temp;
        var panoramaData;
        var link;
        var links;
        var panoramas = panoramaContainer.getStagedPanoramas();
        for (var i = 0, panoramaLen = panoramas.length; i < panoramaLen; i++) {
            panoramaData = panoramas[i].data();
            links = [];
            if ("links" in panoramaData) {
                for (j = 0; j < panoramaData.links.length; j++) {
                    link = panoramaData.links[j];
                    links.push({
                        target_gsv_panorama_id: ("pano" in link) ? link.pano : "",
                        yaw_deg: ("heading" in link) ? link.heading : 0.0,
                        description: ("description" in link) ? link.description : ""
                    });
                }
            }
            temp = {
                panorama_id: ("location" in panoramaData && "pano" in panoramaData.location) ? panoramaData.location.pano : "",
                image_date: "imageDate" in panoramaData ? panoramaData.imageDate : "",
                links: links,
                copyright: "copyright" in panoramaData ? panoramaData.copyright : ""
            };
            data.gsv_panoramas.push(temp);
            panoramas[i].setProperty("submitted", true);
        }

        return data;
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
            util.misc.reportNoStreetView(task.getStreetEdgeId());
        } else {
            // Set the tasksMissionsOffset so that the mission progress bar remains the same after the jump.
            var currTaskDist = util.math.kilometersToMeters(taskContainer.getCurrentTaskDistance());
            var oldOffset = missionContainer.getTasksMissionsOffset();
            missionContainer.setTasksMissionsOffset(oldOffset + currTaskDist);
        }

        task.eraseFromGoogleMaps();
        self.skipSubmit(data, task);

        // If the jump was clicked in the middle of the beforeJumpTask,
        // reset the beforeJump tracking parameters
        var jumpListenerStatus = mapService.getLabelBeforeJumpListenerStatus();
        if (jumpListenerStatus) {
            mapService.setLabelBeforeJumpListenerStatus(false);
            compass.resetBeforeJump();
            mapService.finishCurrentTaskBeforeJumping();
        }

        taskContainer.getFinishedAndInitNextTask(task);
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

        var data = self.compileSubmissionData(task);
        data.incomplete = dataIn;

        self.submit(data, task);
        return false;
    };

    /**
     * Submit the data via an AJAX post request.
     * @param data
     * @param task
     * @param async
     */
    this.submit = function (data, task, async) {
        if (typeof async === "undefined") { async = true; }
        if (data.constructor !== Array) { data = [data]; }

        if ('interactions' in data[0] && data[0].constructor === Array) {
            var action = tracker.create("TaskSubmit");
            data[0].interactions.push(action);
        }

        labelContainer.refresh();

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
                    if (result.mission) missionModel.createAMission(result.mission);
                }
            },
            error: function (result) {
                console.error(result);
            }
        });
    };

    properties.dataStoreUrl = params.dataStoreUrl;

    $(window).on('beforeunload', function () {
        tracker.push("Unload");

        // Old code: this does not work on the newest versions of Google Chrome.
        // TODO: Replace with beacon (or some ajax alternative) asap. Starter code below.
        self.submitData(false);

        // // April 17, 2019
        // // What we want here is type: 'application/json'. Can't do that quite yet because the
        // // feature has been disabled, but we should switch back when we can.
        //
        // // Source for fix and ongoing discussion is here:
        // // https://bugs.chromium.org/p/chromium/issues/detail?id=490015
        var data = self.compileSubmissionData(task);
        var jsonData = JSON.stringify(data);
        var headers = {
            type: 'application/x-www-form-urlencoded'
        };

        var blob = new Blob([jsonData], headers);
        navigator.sendBeacon(properties.dataStoreUrl, blob);
    });

    /**
     * Manually triggers form submission from other functions.
     * @param async     Whether data should be submitted asynchronously or not (if undefined,
     *                  then submits asynchronously by default)
     */
    this.submitData = function (async) {
        if (typeof async === "undefined") { async = true; }
        var task = taskContainer.getCurrentTask();
        var data = self.compileSubmissionData(task);
        self.submit(data, task, async);
    }
}
