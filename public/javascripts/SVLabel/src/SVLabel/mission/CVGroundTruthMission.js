function CVGroundTruthMission(mission) {
    var self = this;

    /**
     * If an existing ground truth CV audit mission is available, initialize the mission. Otherwise, display
     * form to create a new CV ground truth audit mission.
     */
    function _init(mission) {
        self.verifyAndSubmitCVGroundTruthAuditPanoids = verifyAndSubmitCVGroundTruthAuditPanoids;
        self.cvGroundTruthNextPano = cvGroundTruthNextPano;

        if (mission && mission.length > 0) {
            // There is already an existing incomplete ground truth mission; load it
            loadFirstPanoWhenReady();
        } else {
            // No CV ground truth mission has been initialized; show the panoId entry form and hide other overlays
            $( document ).ready(function() {
                $("#already-completed-neighborhood-overlay").hide()
                $("#cvgroundtruth-panoid-entry-form-overlay").show()
            });
        }
    }

    /**
     * Waits for the street view pane to become visible, and then jumps to the first pano of the active CV ground truth
     * audit mission.
     */
    function loadFirstPanoWhenReady() {
        if(typeof svl.loadComplete !== "undefined" && svl.loadComplete === true){
            // Hide any irrelevant overlays
            $('#compass-message-holder').hide();
            $('#cvgroundtruth-panoid-entry-form-overlay').hide();
            $('#modal-mission-foreground').hide()
            $('#modal-mission-holder').hide();
            $('#modal-mission-background').hide();
            $('#modal-mission-complete-holder').hide()
            $('#next-pano-button-holder').show();
            // Fetch list of panos to complete and jump to first pano
            $.ajax({
                async: true,
                url: '/audit/groundtruth/panos_todo',
                type: 'get',
                success: function(result) {
                    self.remainingPanos = result['remaining_panos'];
                    self.currentPano = self.remainingPanos.shift();
                    svl.panorama.setPano(self.currentPano);
                    svl.popUpMessage.enableInteractions();
                    $( "#remaining-pano-text" ).text((self.remainingPanos.length+1)+" remaining")

                },
                error: function (xhr, ajaxOptions, thrownError) {
                    console.log(thrownError);
                }
            })
        }
        else{
            setTimeout(loadFirstPanoWhenReady, 250);
        }
    }

    /**
     * After user provides list of panoIds and clicks submit, this method checks that the provided panoIds are valid
     * and submits them to the server to create a new ground truth audit mission.
     */
    function verifyAndSubmitCVGroundTruthAuditPanoids() {
        let streetViewQueryService = new google.maps.StreetViewService();
        let lines = $('textarea#panoid-textarea').val().split('\n');
        let panoIds_json = {
            panos: [],
            num_panos: 0
        };
        // Read each panoId, create object, and add to list
        for (let i = 0; i < lines.length; i++) {
            let panoId = lines[i].trim();
            if (panoId.length === 0) {
                continue;
            }
            panoIds_json['panos'].push({panoId: panoId, lat: 0, lng: 0});
        }

        // Query street view service to validate and find lat/lng position of each panoId
        let numPanosValidated = 0;
        for(let i = 0;i < panoIds_json['panos'].length;i++){
            // async-in-a-for-loop; need to wait for all queries to the street view service to complete before submitting
            // https://stackoverflow.com/questions/11488014/asynchronous-process-inside-a-javascript-for-loop
            (function(cntr) {
                streetViewQueryService.getPanorama({pano: panoIds_json['panos'][cntr].panoId}, function(panoData,status) {
                    if (status === google.maps.StreetViewStatus.OK) {
                        panoIds_json['panos'][cntr].lat = panoData.location.latLng.lat();
                        panoIds_json['panos'][cntr].lng = panoData.location.latLng.lng();

                    } else {
                        // Invalid panoId found
                        let shouldProceed = confirm("PanoId "+panoIds_json['panos'][cntr].panoId+" is invalid and will be skipped. Proceed?");
                        panoIds_json['panos'][cntr]=null;
                        if (!shouldProceed) {
                            return;
                        }
                    }

                    numPanosValidated++;
                    // Once all panos have been checked, submit the list and reload page
                    if (numPanosValidated === panoIds_json['panos'].length) {
                        panoIds_json['panos'] = panoIds_json['panos'].filter(Boolean);
                        let url = '/audit/groundtruth/create';
                        panoIds_json['num_panos'] = panoIds_json['panos'].length;
                        $.ajax({
                            async: true,
                            contentType: 'application/json; charset=utf-8',
                            url: url,
                            type: 'post',
                            dataType: 'json',
                            data: JSON.stringify(panoIds_json),
                            success: function (data) {;
                                location.reload();
                            }
                        });
                    }
                });
            })(i);
        }
    }

    /**
     * Moves to the next pano to be audited.
     */
    function cvGroundTruthNextPano() {
        var url = '/audit/groundtruth/mark_complete';
        var payload = {
            pano: self.currentPano,
            num_remaining: self.remainingPanos.length - 1
        };
        // Mark the current pano as complete
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

        // Jump to the next panoId, and fetch a new task from the server for the next panoId
        if (self.remainingPanos.length > 0) {
            self.currentPano = self.remainingPanos.shift();
            svl.panorama.setPano(self.currentPano);
            $( "#remaining-pano-text" ).text((self.remainingPanos.length+1)+" remaining")
            $.ajax({
                async: true,
                contentType: 'application/json; charset=utf-8',
                url: '/task/groundtruth/'+self.currentPano,
                type: 'get',
                dataType: 'json',
                data: JSON.stringify(payload),
                success: function (data) {
                    let lat1 = data.features[0].geometry.coordinates[0][1];
                    let lng1 = data.features[0].geometry.coordinates[0][0];
                    let newTask = svl.taskFactory.create(data, lat1, lng1);
                    svl.taskContainer.setCurrentTask(newTask);
                }
            });
        } else {
            // No more panos to audit, mission complete!
            $("#cvgroundtruth-complete-overlay").show()
            $("#next-pano-button-holder").hide()
        }
    }

    _init(mission)
}