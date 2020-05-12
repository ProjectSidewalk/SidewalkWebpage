function InitialMissionInstruction(compass, mapService, neighborhoodContainer, popUpMessage, taskContainer,
                                   labelContainer, tracker) {
    var self = this;
    var initialHeading;
    var lookingAroundInterval;
    var overallAngleViewed = 0;
    var initialPanoId;
    var maxAngleMousePan = 135; //TODO - Once panorama is resizable, the max panning angle needs to be updated

    this._finishedInstructionToStart = function () {
        if (!svl.isOnboarding()) {
            mapService.bindPositionUpdate(self._instructToCheckSidewalks);
        }
    };

    this._instructToCheckSidewalks = function () {
        if (!svl.isOnboarding()) {
            // Instruct a user to audit both sides of the streets once they have walked for 25 meters.
            var distance = taskContainer.getCompletedTaskDistance({units: 'kilometers'});
            if (distance >= 0.1) {
                var title = i18next.t('popup.both-sides-title');
                var message = i18next.t('popup.both-sides-body');
                var width = '450px';
                var height = '291px';
                var x = '50px';
                var image = "img/examples/lookaround-example.gif";
                tracker.push('PopUpShow_CheckBothSides');

                popUpMessage.notifyWithImage(title, message, width, height, x, image, function() {
                    mapService.unbindPositionUpdate(self._instructToCheckSidewalks);
                    mapService.bindPositionUpdate(self._instructForGSVLabelDisappearing);
                });
            }
        }
    };

    this._finishedInstructionForGSVLabelDisappearing = function () {
        mapService.stopBlinkingGoogleMaps();

        if (!svl.isOnboarding()) {
            mapService.unbindPositionUpdate(self._instructForGSVLabelDisappearing);
        }
    };

    this._instructForGSVLabelDisappearing = function () {
        if (!svl.isOnboarding()) {
            // Instruct the user about GSV labels disappearing when they have labeled and walked for the first time
            var labels = labelContainer.getCurrentLabels();
            var prev_labels = labelContainer.getPreviousLabels();
            if (labels.length == 0) {
                labels = prev_labels;
            }
            var labelCount = labels.length;
            var nOnboardingLabels = 7;
            if (labelCount > 0) {
                if (svl.missionContainer.isTheFirstMission() && labelCount != nOnboardingLabels) {
                    var title = i18next.t('popup.labels-disappear-title');
                    var message = i18next.t('popup.labels-disappear-body');
                    tracker.push('PopUpShow_GSVLabelDisappear');

                    popUpMessage.notify(title, message, self._finishedInstructionForGSVLabelDisappearing);
                    mapService.blinkGoogleMaps();
                }
            }
        }
    };

    this._instructToFollowTheGuidance = function () {
        if (!svl.isOnboarding()) {
            var title = i18next.t('popup.step-title');
            var message = i18next.t('popup.step-body');
            tracker.push('PopUpShow_LookAroundIntersection');

            popUpMessage.notify(title, message, function () {
                self._stopBlinkingNavigationComponents();
            });
            compass.blink();
            mapService.blinkGoogleMaps();
        }
    };
    /*
    This function calculates raw difference in angle relative to previous heading angle.
     */
    this._transformAngle = function (angle) {
        var difference = angle - initialHeading;
        //135 is max degree swipe in panorama
        //if an impossible raw difference is calculated
        if (Math.abs(difference) >= maxAngleMousePan){
            //calculate difference in other direction of rotation
            if (initialHeading > 180){
                difference = 360 - initialHeading + angle;
            }
            else{
                difference = -360 + angle - initialHeading;
            }
        }

        return difference;
    };

    this._pollLookingAroundHasFinished = function () {

        //check the panoId to make sure the user hasn't walked
        if (mapService.getPanoId() == initialPanoId) {
            var currentHeadingAngle = mapService.getPov().heading;
            var transformedCurrent = self._transformAngle(currentHeadingAngle);

            // An explanation of why/how this code was changed to fix a bug can be found here:
            // https://github.com/ProjectSidewalk/SidewalkWebpage/pull/398#issuecomment-259284249
            overallAngleViewed = overallAngleViewed + transformedCurrent;
            initialHeading = currentHeadingAngle; //update heading angle previous

            //Absolute value of total angle viewed by user is more than 330 degrees
            if (Math.abs(overallAngleViewed) >= 330) {
                clearInterval(lookingAroundInterval);
                self._instructToFollowTheGuidance();
            }
        }
    };

    this._stopBlinkingNavigationComponents = function () {
        compass.stopBlinking();
        mapService.stopBlinkingGoogleMaps();
    };

    this.start = function (neighborhood) {
        if (!svl.isOnboarding()) {
            $.getJSON('/cityShortNameParam', function(data) {
                var cityShortName = data.city_short_name;
                var title = i18next.t('popup.start-title');
                var message = i18next.t('popup.start-body',
                    { neighborhood: neighborhood.getProperty("name"), city: cityShortName });
                tracker.push('PopUpShow_LetsGetStarted');

                popUpMessage.notify(title, message, self._finishedInstructionToStart);

                initialHeading = mapService.getPov().heading;
                // lastHeadingTransformed = self._transformAngle(mapService.getPov().heading);
                initialPanoId = mapService.getPanoId();
                lookingAroundInterval = setInterval(self._pollLookingAroundHasFinished, 1);
            });
        }
    };

}