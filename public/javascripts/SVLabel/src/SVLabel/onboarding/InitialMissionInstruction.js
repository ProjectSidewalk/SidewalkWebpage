function InitialMissionInstruction (compass, mapService, popUpMessage) {
    this.start = function (neighborhood) {
        popUpMessage.notify("Let's get started!",
            "We have moved you to a street in " + neighborhood.getProperty("name") +
            ", DC! You are currently standing at the intersection. Please find and label all the curb ramps and " +
            "accessibility problems at this intersection.");

        var initialHeading = mapService.getPov().heading;
        var lookedAround = false;
        var interval = setInterval(function () {
            var angleDelta = util.math.toRadians(initialHeading - mapService.getPov().heading);
            if (Math.cos(angleDelta) < 0) {
                lookedAround = true;
            }

            if (lookedAround && Math.cos(angleDelta) > 0.5) {
                clearInterval(interval);
                popUpMessage.notify("Follow the navigator and audit the street!",
                    "Great! It looks like you finished auditing this intersection. Now, follow the red line in the map to " +
                    "complete your mission. We provide turn-by-turn instructions to guide your path.</span>");
                compass.blink();
            }
        }, 1000);
    };
}