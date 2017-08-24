/**
 *
 * @param svl. Todo. Get rid of this dependency eventually.
 * @param missionContainer
 * @param modalMissionCompleteMap
 * @param uiModalMissionComplete
 * @param modalModel
 * @returns {{className: string}}
 * @constructor
 */
function ModalMissionComplete (svl, missionContainer, taskContainer,
                               modalMissionCompleteMap, modalMissionProgressBar,
                               uiModalMissionComplete, modalModel, statusModel, onboardingModel) {
    var self = this;
    var _modalModel = modalModel;
    var nextMission;

    this._properties = {
        boxTop: 180,
        boxLeft: 45,
        boxWidth: 640
    };
    this._status = {
        isOpen: false
    };

    this._uiModalMissionComplete = uiModalMissionComplete;
    this._modalMissionCompleteMap = modalMissionCompleteMap;

    _modalModel.on("ModalMissionComplete:update", function (parameters) {
        self.update(parameters.mission, parameters.neighborhood);
    });

    _modalModel.on("ModalMissionComplete:show", function () {
        self.show();
    });

    _modalModel.on("ModalMissionComplete:one", function (parameters) {
        self.one(parameters.uiComponent, parameters.eventType, parameters.callback);
    });

    onboardingModel.on("Onboarding:startOnboarding", function () {
        self.hide();
    });

    svl.neighborhoodModel.on("Neighborhood:completed", function(parameters) {
        var neighborhood = svl.neighborhoodContainer.get(parameters.completedRegionId);
        var neighborhoodName = neighborhood.getProperty("name");
        self.setMissionTitle("Bravo! You completed " + neighborhoodName + " neighborhood!");
        uiModalMissionComplete.closeButton.html('Audit Another Neighborhood');
    });

    this._handleBackgroundClick = function (e) {
        self._closeModal();
    };

    this._handleCloseButtonClick = function (e) {
        self._closeModal();
    };

    this._closeModal = function (e) {
        svl.actionStack.reset();
        if (svl.neighborhoodModel.isNeighborhoodCompleted) {
            // reload the page to load another neighborhood
            window.location.replace('/audit');
        } else {
            var nextMission = missionContainer.getCurrentMission();
            _modalModel.triggerMissionCompleteClosed( { nextMission: nextMission } );
            self.hide();
        }
    };

    this.hide = function () {
        this._status.isOpen = false;
        this._uiModalMissionComplete.holder.css('visibility', 'hidden');
        this._uiModalMissionComplete.foreground.css('visibility', "hidden");
        this._uiModalMissionComplete.background.css('visibility', "hidden");
        this._uiModalMissionComplete.closeButton.css('visibility', "hidden");
        // this._horizontalBarMissionLabel.style("visibility", "hidden");
        this._modalMissionCompleteMap.hide();
        statusModel.setProgressBar(0);
        statusModel.setMissionCompletionRate(0);
        if(uiModalMissionComplete.confirmationText!=null && uiModalMissionComplete.confirmationText!=undefined){
            uiModalMissionComplete.confirmationText.empty();
            uiModalMissionComplete.confirmationText.remove();
            delete uiModalMissionComplete.confirmationText;
        }
    };

    this.show = function () {
        this._status.isOpen = true;
        uiModalMissionComplete.holder.css('visibility', 'visible');
        uiModalMissionComplete.foreground.css('visibility', "visible");
        uiModalMissionComplete.background.css('visibility', "visible");
        uiModalMissionComplete.closeButton.css('visibility', "visible");
        // horizontalBarMissionLabel.style("visibility", "visible");
        modalMissionCompleteMap.show();

        /*If the user has completed his first mission then hide the continue button.
         Display the generate confirmation button. When clicked, remove this button completely
         and make the Continue button visible again.
         */
        if(uiModalMissionComplete.generateConfirmationButton!=null && uiModalMissionComplete.generateConfirmationButton!=undefined) {
            uiModalMissionComplete.closeButton.css('visibility', "hidden");
            //TODO: AJAX call to generate a confirmation code associated with HIT Id, Assignment Id, and Worker Id
            uiModalMissionComplete.generateConfirmationButton.click(function () {
                var para = document.createElement("p");
                var node = document.createTextNode("Confirmation Code: Q-W-EEF-RG");
                para.appendChild(node);
                para.setAttribute("id", "modal-mission-complete-confirmation-text");
                this.after(para);
                uiModalMissionComplete.confirmationText = $("modal-mission-complete-confirmation-text");
                uiModalMissionComplete.closeButton.css('visibility', "visible");
                this.remove();
                delete uiModalMissionComplete.generateConfirmationButton
            });

        }
    };

    this.update = function (mission, neighborhood) {
        // Update the horizontal bar chart to show how much distance the user has audited
        var unit = "miles";
        var regionId = neighborhood.getProperty("regionId");

        var missionDistance = mission.getProperty("auditDistanceMi");
        var auditedDistance = neighborhood.completedLineDistance(unit);
        var remainingDistance = neighborhood.totalLineDistance(unit) - auditedDistance;

        var completedTasks = taskContainer.getCompletedTasks(regionId);
        var missionTasks = mission.getRoute();
        var totalLineDistance = taskContainer.totalLineDistanceInARegion(regionId, unit);
        var missionDistanceRate = missionDistance / totalLineDistance;
        var auditedDistanceRate = Math.max(0, auditedDistance / totalLineDistance - missionDistanceRate);

        var labelCount = mission.getLabelCount(),
            curbRampCount = labelCount ? labelCount["CurbRamp"] : 0,
            noCurbRampCount = labelCount ? labelCount["NoCurbRamp"] : 0 ,
            obstacleCount = labelCount ? labelCount["Obstacle"] : 0,
            surfaceProblemCount = labelCount ? labelCount["SurfaceProblem"] : 0,
            otherCount = labelCount ? labelCount["Other"] : 0;

        var neighborhoodName = neighborhood.getProperty("name");
        this.setMissionTitle(neighborhoodName + ": Mission Complete!");

        modalMissionCompleteMap.update(mission, neighborhood);
        modalMissionCompleteMap.updateStreetSegments(missionTasks, completedTasks);
        modalMissionProgressBar.update(missionDistanceRate, auditedDistanceRate);

        this._updateMissionProgressStatistics(missionDistance, auditedDistance, remainingDistance, unit);
        this._updateMissionLabelStatistics(curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, otherCount);

    };

    uiModalMissionComplete.background.on("click", this._handleBackgroundClick);
    uiModalMissionComplete.closeButton.on("click", this._handleCloseButtonClick);
    this.hide();
}



ModalMissionComplete.prototype.getProperty = function (key) {
    return key in this._properties ? this._properties[key] : null;
};

ModalMissionComplete.prototype.isOpen = function () {
    return this._status.isOpen;
};

ModalMissionComplete.prototype.one = function (uiComponent, eventType, callback) {
    this._uiModalMissionComplete[uiComponent].one(eventType, callback);
};

ModalMissionComplete.prototype.setMissionTitle = function (missionTitle) {
    this._uiModalMissionComplete.missionTitle.html(missionTitle);
};

ModalMissionComplete.prototype._updateMissionProgressStatistics = function (missionDistance, cumulativeAuditedDistance, remainingDistance, unit) {
    if (!unit) unit = "kilometers";
    remainingDistance = Math.max(remainingDistance, 0);
    this._uiModalMissionComplete.missionDistance.html(missionDistance.toFixed(1) + " " + unit);
    this._uiModalMissionComplete.totalAuditedDistance.html(cumulativeAuditedDistance.toFixed(1) + " " + unit);
    this._uiModalMissionComplete.remainingDistance.html(remainingDistance.toFixed(1) + " " + unit);
};

ModalMissionComplete.prototype._updateTheMissionCompleteMessage = function () {
    var unusedMessages = [
        'You\'re one lightning bolt away from being a greek diety. Keep on going!',
        'Gold star. You can wear it proudly on your forehead all day if you\'d like. </br>We won\'t judge.',
        '"Great job. Every accomplishment starts with the decision to try."</br> - That inspirational poster in your office',
        'Wow you did really well. You also did good! Kind of like superman.'
    ];
    var messages = [
            'Couldn’t have done it better myself.',
            'Aren’t you proud of yourself? We are!',
            'WOWZA. Even the sidewalks are impressed. Keep labeling!',
            'Your auditing is out of this world.',
            'Incredible. You\'re a machine! ...no wait, I am.',
            'Ooh la la! Those accessibility labels are to die for.',
            'We knew you had it in you all along. Great work!',
            'The [mass x acceleration] is strong with this one. (Physics + Star Wars, get it?)',
            'Hey, check out the reflection in your computer screen. That\'s what awesome looks like.',
            'You. Are. Unstoppable. Keep it up!',
            'Today you are Harry Potter\'s golden snitch. Your wings are made of awesome.',
            'They say unicorns don\'t exist, but hey! We found you. Keep on keepin\' on.',
            '"Uhhhhhhrr Ahhhhrrrrrrrrgggg " Translation: Awesome job! Keep going. - Chewbacca',
            'You\'re seriously talented. You could go pro at this.',
            'Forget Frodo, I would have picked you to take the one ring to Mordor. Great work!',
            'You might actually be a wizard. These sidewalks are better because of you.'
        ],
        emojis = [' :D', ' :)', ' ;-)'],
        message = messages[Math.floor(Math.random() * messages.length)] + emojis[Math.floor(Math.random() * emojis.length)];
    this._uiModalMissionComplete.message.html(message);
};

ModalMissionComplete.prototype._updateMissionLabelStatistics = function (curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, otherCount) {
    this._uiModalMissionComplete.curbRampCount.html(curbRampCount);
    this._uiModalMissionComplete.noCurbRampCount.html(noCurbRampCount);
    this._uiModalMissionComplete.obstacleCount.html(obstacleCount);
    this._uiModalMissionComplete.surfaceProblemCount.html(surfaceProblemCount);
    this._uiModalMissionComplete.otherCount.html(otherCount);
};