function InitialMissionInstruction(compass, mapService, neighborhoodContainer, popUpMessage, taskContainer,
                                   labelContainer, tracker) {
    var self = this;
    var initialHeading;
    var lookingAroundInterval;
    //var lastHeadingTransformed; //old variable
    var overallAngleViewed = 0;
    //var viewedCWTransformed = 0, viewedCCWTransformed = 360; //old variable
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
            if (distance >= 0.025) {
                var title = "Please check both sides of the street";
                var message = "Remember, we would like you to check both sides of the street. " +
                    "Please label accessibility issues like sidewalk obstacles and surface problems.";
                tracker.push('PopUpShow_CheckBothSides');

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
                    var message = "Wondering where your labels went? After taking a step, you won't see them in the " +
                        "Street View image anymore, but you can still see them on the highlighted mini map!";
                    tracker.push('PopUpShow_GSVLabelDisappear');

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
        /*********** OLD CODE ***********
         while ((angle - initialHeading) % 360 < 0)
         angle += 360;
         return (angle - initialHeading) % 360;*/


        //*********** NEW CODE ***********
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
        //*********** END NEW CODE ***********
    };

    this._pollLookingAroundHasFinished = function () {

        //check the panoId to make sure the user hasn't walked
        if (mapService.getPanoId() == initialPanoId) {
            var currentHeadingAngle = mapService.getPov().heading;
            var transformedCurrent = self._transformAngle(currentHeadingAngle);
            /* OLD CODE - note: does not properly handle large degree mouse panning
            Explanation: https://github.com/ProjectSidewalk/SidewalkWebpage/pull/398#issuecomment-259284249
            Pasted:
            The heading of the panorama indicates the angle in which the user is looking at and could be any number
            between 0 and 360.
            We constantly track the heading to detect when the whole scene has been viewed.
            The problem is that the user might alter between moving clockwise and counter-clockwise
            (this is what was not considered in the original code and caused this problem to happen).
            To detect this, I store and constantly update two variables: viewedCWTransformed and viewedCCWTransformed.
            The first one stores the size of the largest arc from the initial heading that the user has seen while
            moving clockwise.
            Similarly, the second variable stores the same thing but when the user is moving counter-clockwise.
            The sum of these two arcs indicates the portion of the scene that the user has viewed.
            To implement this there are two technical problems:
                (1) the initial heading might be any number in [0, 360] and this would cause a lot of special cases.
                (2) the events are given in discrete time points and therefore it is not very easy to detect if the
                user just moved 10° in clockwise or 350° counter-clockwise.
            To fix the first problem I transfer all the angles in function _transformAngle and then simply assume
            the initial heading is always 0.
            And to fix the second problem I define a variable EPS and use it to detect the direction.


            var direction;
            var EPS = 30; //the smaller it is the higher the speed of calling this function should be
            if (transformedCurrent > 360 - EPS && lastHeadingTransformed < EPS) //interval cross from after 0 to before 360 [30, -30]
                direction = transformedCurrent - (lastHeadingTransformed + 360);
            else if (currentHeadingAngle < EPS && lastHeadingTransformed > 360 - EPS) //interval crossing from before 360 to 0 [-30, 30]
                direction = transformedCurrent - (lastHeadingTransformed - 360);
            else
                direction = transformedCurrent - lastHeadingTransformed; //regular subtraction to determine direction of rotation
            if (direction > 0 ) { //&& transformedCurrent < viewedCWTransformed + EPS
                // user is rotating clockwise
                //viewedCWTransformed = Math.max(viewedCWTransformed, transformedCurrent);
            } else if (direction < 0 ) { //&& transformedCurrent > viewedCCWTransformed - EPS
                //user is rotating counter clockwise
                //viewedCCWTransformed = Math.min(viewedCCWTransformed, transformedCurrent);
            }
            lastHeadingTransformed = transformedCurrent;
            var overallAngleViewed = (360 - viewedCCWTransformed) + viewedCWTransformed;*/




            //***********  NEW CODE ***********
            overallAngleViewed = overallAngleViewed + transformedCurrent;
            initialHeading = currentHeadingAngle; //update heading angle previous
            //*********** END NEW CODE ***********

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
            var title = "Let's get started!";
            var message = "We have moved you to a street in " + neighborhood.getProperty("name") +
                ", DC! You are currently standing at the intersection. Please find and label all the curb ramps and " +
                "accessibility problems at this intersection.";
            tracker.push('PopUpShow_LetsGetStarted');

            popUpMessage.notify(title, message, self._finishedInstructionToStart);

            initialHeading = mapService.getPov().heading;
            // lastHeadingTransformed = self._transformAngle(mapService.getPov().heading);
            initialPanoId = mapService.getPanoId();
            lookingAroundInterval = setInterval(self._pollLookingAroundHasFinished, 1);
        }
    };

}