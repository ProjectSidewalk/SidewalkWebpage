/**
 * Compiles and submits Validate interaction and validation data to the back end.
 */
class Form {
    #dataStoreUrl;

    /**
     * @param {string} url - URL to send validation/interaction data to.
     */
    constructor(url) {
        this.#dataStoreUrl = url;

        // Flush any remaining logs when the page is being dismissed. `pagehide` is the reliable, bfcache-compatible
        // unload signal; `keepalive` lets the POST outlive the page while still routing through AppManager's fetch
        // wrapper, which attaches the `Csrf-Token` header Play's CSRF filter requires (#3935).
        window.addEventListener('pagehide', () => {
            svv.tracker.push('Unload');
            const data = this.compileSubmissionData(false);
            fetch(this.#dataStoreUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify(data),
                keepalive: true
            });
        });
    }

    /**
     * Returns the source label identifying which Validate UI produced the data.
     * @returns {string} One of 'ValidateMobile', 'ExpertValidate', or 'Validate'.
     */
    getSource() {
        if (isMobile()) {
            return 'ValidateMobile';
        } else if (svv.adminVersion) {
            return 'ExpertValidate';
        } else {
            return 'Validate';
        }
    }

    /**
     * Compiles data into a format that can be parsed by our back end.
     *
     * @param {boolean} missionComplete - Whether the mission is complete. Ensures we only send once per mission.
     * @returns {Object} The log data to submit.
     */
    compileSubmissionData(missionComplete) {
        let data = { timestamp: new Date(), source: this.getSource() };
        let missionContainer = svv.missionContainer;
        let mission = missionContainer ? missionContainer.getCurrentMission() : null;

        let labelContainer = svv.labelContainer;
        let labelList = labelContainer ? labelContainer.getLabelsToSubmit() : null;
        // Only submit mission progress if there is a mission when we're compiling submission data.
        if (mission) {
            // Add the current mission
            data.mission_progress = {
                mission_id: mission.getProperty('missionId'),
                mission_type: mission.getProperty('missionType'),
                labels_progress: mission.getProperty('labelsProgress'),
                labels_total: mission.getProperty('labelsValidated'),
                label_type_id: mission.getProperty('labelTypeId'),
                completed: missionComplete ? missionComplete : false,
                skipped: mission.getProperty('skipped')
            };
        }

        // Only include labels if there is a label list when we're compiling submission data.
        if (labelList) {
            data.validations = labelList;
            svv.labelContainer.refresh();
        } else {
            data.validations = [];
        }

        data.environment = {
            mission_id: mission ? mission.getProperty('missionId') : null,
            browser: util.getBrowser(),
            browser_version: util.getBrowserVersion(),
            browser_width: $(window).width(),
            browser_height: $(window).height(),
            screen_width: screen.width,
            screen_height: screen.height,
            avail_width: screen.availWidth,              // total width - interface (taskbar)
            avail_height: screen.availHeight,            // total height - interface ;
            operating_system: util.getOperatingSystem(),
            language: i18next.language,
            css_zoom: 100 // Sent for back-end compatibility; UI scaling is done via real layout sizes (--ui-scale).
        };

        data.validate_params = {
            admin_version: svv.adminVersion,
            label_type: svv.validateParams.labelTypeId,
            user_ids: svv.validateParams.userIds,
            neighborhood_ids: svv.validateParams.regionIds,
            unvalidated_only: svv.validateParams.unvalidatedOnly
        };

        data.interactions = svv.tracker.getActions();

        data.pano_histories = [];
        if (svv.panoManager) {
            const panoramas = svv.panoStore.getStagedPanoData();
            for (let i = 0; i < svv.panoStore.getStagedPanoData().length; i++) {
                const panoData = panoramas[i].getProperties();
                let panoHist = {
                    curr_pano_id: panoData.panoId,
                    pano_history_saved: new Date(),
                    history: panoData.history.map(function(prevPano) {
                        return {
                            pano_id: prevPano.panoId,
                            date: prevPano.captureDate.format('YYYY-MM')
                        }
                    })
                };

                data.pano_histories.push(panoHist);
                panoramas[i].setProperty('submitted', true);
            }
        }

        svv.tracker.refresh();
        return data;
    }

    /**
     * Submits all front-end data to the back end.
     *
     * @param {Object} data - Data object (containing interactions, missions, etc.).
     * @returns {Promise<void>}
     */
    submit(data) {
        return fetch(this.#dataStoreUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(data)
        })
            .then((response) => response.json())
            .then(async (result) => {
                // If a mission was returned after posting data, create a new mission.
                if (result.has_mission_available) {
                    if (result.mission) {
                        svv.missionContainer.createAMission(result.mission, result.progress);
                        svv.labelContainer.resetLabelList(result.labels);
                        await svv.labelContainer.renderCurrentLabel();
                        svv.modalMissionComplete.nextMissionLoaded();
                    }
                } else {
                    // Otherwise, display popup that says there are no more labels left.
                    svv.modalMissionComplete.hide();
                    svv.modalNoNewMission.show();
                }
            })
            .catch(error => {
                window.location.reload(); // Refresh the page in case the server has gone down.
            });
    }
}
