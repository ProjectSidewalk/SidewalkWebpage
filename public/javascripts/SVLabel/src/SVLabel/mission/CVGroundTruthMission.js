function CVGroundTruthMission(mission) {
    var self = this;

    /**
     * If an existing ground truth CV audit mission is available, initialize the mission. Otherwise, display
     * form to create a new CV ground truth audit mission.
     */
    function _init() {
        loadFirstPanoWhenReady();
        self.cvGroundTruthNextPano = cvGroundTruthNextPano;
    }

    /**
     * Waits for the street view pane to become visible, and then jumps to the first pano of the active CV ground truth
     * audit mission.
     */
    function loadFirstPanoWhenReady() {
        if (typeof svl.loadComplete !== "undefined" && svl.loadComplete === true) {
            // Hide any irrelevant overlays.
            $('#compass-message-holder').hide();
            $('#cvgroundtruth-panoid-entry-form-overlay').hide();
            $('#modal-mission-foreground').hide();
            $('#status-holder').hide();
            $('#modal-mission-holder').hide();
            $('#modal-mission-background').hide();
            $('#modal-mission-complete-holder').hide();
            $('#next-pano-button-holder').show();
            // Fetch list of panos to complete and jump to first pano.
            $.ajax({
                async: true,
                url: '/audit/groundtruth/panosTodo',
                type: 'get',
                success: function (result) {
                    self.remainingPanos = result['remaining_panos'];
                    self.currentPano = self.remainingPanos.shift();
                    svl.panorama.setPano(self.currentPano);
                    svl.popUpMessage.enableInteractions();
                    $("#remaining-pano-text").text((self.remainingPanos.length + 1) + " remaining")
                    $("#current-panoid-text").text("Current Pano: " + self.currentPano);
                },
                error: function (xhr, ajaxOptions, thrownError) {
                    console.log(thrownError);
                }
            })
        }
        else {
            setTimeout(loadFirstPanoWhenReady, 250);
        }
    }


    /**
     * Moves to the next pano to be audited.
     */
    function cvGroundTruthNextPano() {
        var url = '/audit/groundtruth/markComplete';
        var payload = {
            pano: self.currentPano,
            num_remaining: self.remainingPanos.length - 1,
            mission_id: mission.mission_id
        };
        // Mark the current pano as complete.
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            dataType: 'json',
            data: JSON.stringify(payload),
            error: function (xhr, ajaxOptions, thrownError) {
                console.log(thrownError);
            }
        });

        // Jump to the next panoId, and fetch a new task from the server for the next panoId.
        if (self.remainingPanos.length > 0) {
            self.currentPano = self.remainingPanos.shift();
            svl.panorama.setPano(self.currentPano);
            $("#remaining-pano-text").text((self.remainingPanos.length + 1) + " remaining");
            $("#current-panoid-text").text("Current Pano: " + self.currentPano);
            $.ajax({
                async: true,
                contentType: 'application/json; charset=utf-8',
                url: '/task/groundtruth/' + self.currentPano,
                type: 'get',
                dataType: 'json',
                data: JSON.stringify(payload),
                success: function (data) {
                    let lat1 = data.features[0].geometry.coordinates[0][1];
                    let lng1 = data.features[0].geometry.coordinates[0][0];
                    let newTask = svl.taskFactory.create(data, false, lat1, lng1);
                    svl.taskContainer.setCurrentTask(newTask);
                }
            });
        } else {
            // No more panos to audit, mission complete.
            $("#cvgroundtruth-complete-overlay").show();
            $("#next-pano-button-holder").hide();
        }
    }

    _init()
}
