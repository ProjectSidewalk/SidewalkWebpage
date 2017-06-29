function InitialMissionInstruction(compass, mapService, neighborhoodContainer, popUpMessage, taskContainer,
                                   labelContainer) {
    var self = this;
    var initialHeading;
    var lookingAroundInterval;
    var lastHeadingTransformed;
    var viewedCWTransformed = 0, viewedCCWTransformed = 360;
    var initialPanoId;

    this._finishedInstructionToStart = function () {
        if (!svl.isOnboarding()) {
            mapService.bindPositionUpdate(self._instructToCheckSidewalks);
        }
    };

    this._instructToCheckSidewalks = function () {
        if (!svl.isOnboarding()) {
            // Instruct a user to audit both sides of the streets once they have walked for 25 meters.
            var neighborhood = neighborhoodContainer.getCurrentNeighborhood();
            var distance = taskContainer.getCompletedTaskDistance(neighborhood.getProperty("regionId"), "kilometers");
            if (distance >= 0.025) {
                var title = "Please check both sides of the street";
                var message = "Remember, we would like you to check both sides of the street. " +
                    "Please label accessibility issues like sidewalk obstacles and surface problems.";

                popUpMessage.notify(title, message, function() {
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
                    var title = "Labels on the image disappear";
                    var message = "If you turn back now to look at your labels, they would not appear on the Street View " +
                        "image after you have taken a step. " +
                        "<span class='bold'>However, they aren't gone</span>. You can track them on the highlighed map.";

                    popUpMessage.notify(title, message, self._finishedInstructionForGSVLabelDisappearing);
                    mapService.blinkGoogleMaps();
                }
            }
        }
    };

    this._instructToFollowTheGuidance = function () {
        if (!svl.isOnboarding()) {
            var title = "Let's take a step!";
            var message = "It looks like you've looked around this entire intersection, so it's time to explore " +
                "other areas. Walk in the direction of the red line highlighted on the map.";

            popUpMessage.notify(title, message, function () {
                self._stopBlinkingNavigationComponents();
            });
            compass.blink();
            mapService.blinkGoogleMaps();
        }
    };

    this._transformAngle = function (angle) {
        while ((angle - initialHeading) % 360 < 0)
            angle += 360;
        return (angle - initialHeading) % 360;
    };

    this._pollLookingAroundHasFinished = function () {

        //check the panoId to make sure the user hasn't walked
        if (mapService.getPanoId() == initialPanoId) {
            var currentHeadingAngle = mapService.getPov().heading;
            var transformedCurrent = self._transformAngle(currentHeadingAngle);
            var direction;
            var EPS = 30; //the smaller it is the higher the speed of calling this function should be

            if (transformedCurrent > 360 - EPS && lastHeadingTransformed < EPS) //interval cross from after 0 to before 360 [30, -30]
                direction = transformedCurrent - (lastHeadingTransformed + 360);
            else if (currentHeadingAngle < EPS && lastHeadingTransformed > 360 - EPS) //interval crossing from before 360 to 0 [-30, 30]
                direction = transformedCurrent - (lastHeadingTransformed - 360);
            else
                direction = transformedCurrent - lastHeadingTransformed; //regular subtraction to determine direction of rotation

            if (direction > 0 && transformedCurrent < viewedCWTransformed + EPS) { //
                // user is rotating clockwise
                viewedCWTransformed = Math.max(viewedCWTransformed, transformedCurrent);
            } else if (direction < 0 && transformedCurrent > viewedCCWTransformed - EPS) { //
                //user is rotating counter clockwise
                viewedCCWTransformed = Math.min(viewedCCWTransformed, transformedCurrent);
            }

            lastHeadingTransformed = transformedCurrent;

            var overallAngleViewed = (360 - viewedCCWTransformed) + viewedCWTransformed;

            if (overallAngleViewed >= 360 - EPS) {
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
            var title = "Let's get started!";
            var message = "We have moved you to a street in " + neighborhood.getProperty("name") +
                ", DC! You are currently standing at the intersection. Please find and label all the curb ramps and " +
                "accessibility problems at this intersection.";

            popUpMessage.notify(title, message, self._finishedInstructionToStart);

            initialHeading = mapService.getPov().heading;
            lastHeadingTransformed = self._transformAngle(mapService.getPov().heading);
            initialPanoId = mapService.getPanoId();
            lookingAroundInterval = setInterval(self._pollLookingAroundHasFinished, 1);
        }
    };

}