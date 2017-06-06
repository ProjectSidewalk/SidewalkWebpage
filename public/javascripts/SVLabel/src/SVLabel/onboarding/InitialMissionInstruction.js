function InitialMissionInstruction(compass, mapService, neighborhoodContainer, popUpMessage, taskContainer) {
    var self = this;
    var initialHeading;
    var lookingAroundInterval;
    var lastHeadingTransformed;
    var viewedCWTransformed = 0, viewedCCWTransformed = 360;
    var initialPanoId;

    this._finishedInstructionToFollowTheGuidance = function () {
        self._stopBlinkingNavigationComponents();

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
                var title = "Please check both sides of the street!";
                var message = "Remember, we would like you to check both sides of the street! " +
                    "Please label accessibility issues like sidewalk obstacles and surface problems!";

                popUpMessage.notify(title, message);
                mapService.unbindPositionUpdate(self._instructToCheckSidewalks);
            }
        }
    };

    this._instructToFollowTheGuidance = function () {
        if (!svl.isOnboarding()) {
            var title = "Follow the navigator and audit the street!";
            var message = "It looks like you've looked around this entire intersection. " +
                "If you're done labeling this place, it's time to take a step. " +
                "Walk in the direction of the red line highlighted on the map.";

            popUpMessage.notify(title, message, this._finishedInstructionToFollowTheGuidance);
            compass.blink();
            mapService.blinkGoogleMaps();
        }
    };

    this._transformAngle = function(angle) {
        while ((angle - initialHeading) % 360 < 0)
            angle += 360;
        return (angle - initialHeading) % 360;
    };

    this._pollLookingAroundHasFinished = function () {
        var currentHeadingAngle = mapService.getPov().heading;
        var transformedCurrent = self._transformAngle(currentHeadingAngle);
        var direction;
        var EPS = 30; //the smaller it is the higher the speed of calling this function should be

        if (transformedCurrent > 360-EPS && lastHeadingTransformed < EPS)
            direction = transformedCurrent - (lastHeadingTransformed + 360);
        else if (currentHeadingAngle < EPS && lastHeadingTransformed > 360-EPS)
            direction = transformedCurrent - (lastHeadingTransformed - 360);
        else
            direction = transformedCurrent - lastHeadingTransformed;

        if (direction > 0 && transformedCurrent < viewedCWTransformed + EPS) {
            // user is rotating clockwise
            viewedCWTransformed = Math.max(viewedCWTransformed, transformedCurrent);
        } else if (direction < 0 && transformedCurrent > viewedCCWTransformed - EPS) {
            //user is rotating counter clockwise
            viewedCCWTransformed = Math.min(viewedCCWTransformed, transformedCurrent);
        }

        lastHeadingTransformed = transformedCurrent;

        var overallAngleViewed = (360 - viewedCCWTransformed) + viewedCWTransformed;

        if (overallAngleViewed >= 360 - EPS) {
            clearInterval(lookingAroundInterval);
            
            //check the panoId to make sure the user hasn't walked
            if (mapService.getPanoId() == initialPanoId) {
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
            popUpMessage.notify("Let's get started!",
                "We have moved you to a street in " + neighborhood.getProperty("name") +
                ", DC! You are currently standing at the intersection. Please find and label all the curb ramps and " +
                "accessibility problems at this intersection.");

            initialHeading = mapService.getPov().heading;
            console.log("Initial heading:" + initialHeading);
            lastHeadingTransformed = self._transformAngle(mapService.getPov().heading);
            initialPanoId = mapService.getPanoId();
            lookingAroundInterval = setInterval(self._pollLookingAroundHasFinished, 1);
        }
    };

}