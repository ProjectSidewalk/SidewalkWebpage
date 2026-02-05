function InitialMissionInstruction(compass, navigationService, popUpMessage, taskContainer, labelContainer, aiGuidance, tracker) {
    let lookingAroundInterval;
    let initialPanoId;

    /**
     * Instruct a user to audit both sides of the streets once they have walked for 100 meters.
     * @private
     */
    const _instructToCheckSidewalks = () => {
        const distance = taskContainer.getCompletedTaskDistance({ units: 'meters' });
        if (distance >= 100) {
            tracker.push('PopUpShow_CheckBothSides');
            const title = i18next.t('popup.both-sides-title');
            const message = i18next.t('popup.both-sides-body');
            const width = '450px';
            const height = '291px';
            const x = '50px';
            const image = '/assets/images/examples/lookaround-example.gif';

            // Send the notification. After they click OK, get ready to notify them about disappearing labels.
            popUpMessage.notifyWithImage(title, message, image, width, height, x, () => {
                navigationService.unbindPositionUpdate(_instructToCheckSidewalks);
                navigationService.bindPositionUpdate(_instructForLabelDisappearing);
            });
        }
    };

    /**
     * Instruct the user about labels disappearing when they have labeled and walked for the first time.
     * @private
     */
    const _instructForLabelDisappearing = () => {
        if (labelContainer.getAllLabels().length > 0) {
            tracker.push('PopUpShow_LabelDisappear');
            const title = i18next.t('popup.labels-disappear-title');
            const message = i18next.t('popup.labels-disappear-body');
            popUpMessage.notify(title, message, () => {
                svl.minimap.stopBlinkingMinimap();
                navigationService.unbindPositionUpdate(_instructForLabelDisappearing);
            });
            svl.minimap.blinkMinimap();
        }
    };

    /**
     * Shows the popup that tells the user to follow the line on the minimap if they spun in a circle at start.
     * @private
     */
    const _instructToFollowTheGuidance = () => {
        tracker.push('PopUpShow_LookAroundIntersection');

        const title = i18next.t('popup.step-title');
        const message = i18next.t('popup.step-body');
        popUpMessage.notify(title, message, () => {
            compass.stopBlinking();
            svl.minimap.stopBlinkingMinimap();
        });
        compass.blink();
        svl.minimap.blinkMinimap();
    };

    /**
     * Adds an instruction to make sure users know how to move. If they pan all the way around, show them.
     * @private
     */
    const _pollLookingAroundHasFinished = () => {
        // Check the panoId to make sure the user hasn't walked.
        if (svl.panoViewer.getPanoId() === initialPanoId) {
            // If the user has seen the entire panorama, show a notif explaining how to move.
            if (svl.observedArea.getFractionObserved() === 1) {
                clearInterval(lookingAroundInterval);
                _instructToFollowTheGuidance();
            }
        } else {
            // If they've already moved successfully, stop continuously checking for this.
            clearInterval(lookingAroundInterval);
        }
    };

    /**
     * Shows the starter notification when you begin your first mission.
     * @param {Neighborhood} neighborhood
     */
    this.start = (neighborhood) => {
        tracker.push('PopUpShow_LetsGetStarted');

        const title = i18next.t('popup.start-title');
        const message = i18next.t(
            'popup.start-body', { neighborhood: neighborhood.getProperty('name'), city: svl.cityNameShort }
        );
        popUpMessage.notify(title, message, () => {
            navigationService.bindPositionUpdate(_instructToCheckSidewalks);
            aiGuidance.showAiGuidanceMessage(); // Show AI guidance message for the current street.
        });

        // If the user looks nearly 360 degrees, show a notification explaining how to move.
        initialPanoId = svl.panoViewer.getPanoId();
        lookingAroundInterval = setInterval(_pollLookingAroundHasFinished, 50);
    };
}
