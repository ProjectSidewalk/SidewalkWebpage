function InitialMissionInstruction (compass, mapService, popUpMessage, taskContainer) {
    var self = this;
    var initialHeading;
    var finishedLookingAround = false;
    var lookingAroundInterval;

    this._finishedInstructionToFollowTheGuidance = function () {
        self._stopBlinkingNavigationComponents();

        mapService.bindPositionUpdate(self._instructToCheckSidewalks);
    };

    this._instructToCheckSidewalks = function () {
        // Instruct a user to audit both sides of the streets once they have walked for 25 meters.
        // Todo.
    };

    this._instructToFollowTheGuidance = function () {
        var title = "Follow the navigator and audit the street!";
        var message = "Great! It looks like you finished auditing this intersection. " +
            "Now, follow the red line in the map to complete your mission. " +
            "We provide turn-by-turn instructions to guide your path.</span>";

        popUpMessage.notify(title, message, this._finishedInstructionToFollowTheGuidance);
        compass.blink();
        mapService.blinkGoogleMaps();
    };

    this._pollLookingAroundHasFinished = function () {
        var currentHeadingAngle = mapService.getPov().heading;
        var angleDelta = util.math.toRadians(initialHeading - currentHeadingAngle);

        if (Math.cos(angleDelta) < 0) {
            finishedLookingAround = true;
        }

        if (finishedLookingAround && Math.cos(angleDelta) > 0.5) {
            clearInterval(lookingAroundInterval);
            self._instructToFollowTheGuidance();
        }
    };

    this._stopBlinkingNavigationComponents = function () {
        compass.stopBlinking();
        mapService.stopBlinkingGoogleMaps();
    };

    this.start = function (neighborhood) {
        popUpMessage.notify("Let's get started!",
            "We have moved you to a street in " + neighborhood.getProperty("name") +
            ", DC! You are currently standing at the intersection. Please find and label all the curb ramps and " +
            "accessibility problems at this intersection.");

        initialHeading = mapService.getPov().heading;
        lookingAroundInterval = setInterval(self._pollLookingAroundHasFinished, 1000);
    };

}