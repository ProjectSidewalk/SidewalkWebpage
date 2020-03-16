/**
 * Stores string descriptions for each examples and counterexample image for each label type that
 * appears on the validation interface.
 * @returns {StatusPopupDescriptions}
 * @constructor
 */
function StatusPopupDescriptions () {
    let self = this;

    function getCurbRampDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui-curb-ramp-example-1-to-4');
            case "example-image-2":
                return i18next.t('right-ui-curb-ramp-example-1-to-4');
            case "example-image-3":
                return i18next.t('right-ui-curb-ramp-example-1-to-4');
            case "example-image-4":
                return i18next.t('right-ui-curb-ramp-example-1-to-4');
            case "counterexample-image-1":
                return i18next.t('right-ui-curb-ramp-counterexample-1-to-2');
            case "counterexample-image-2":
                return i18next.t('right-ui-curb-ramp-counterexample-1-to-2');
            case "counterexample-image-3":
                return i18next.t('right-ui-curb-ramp-counterexample-3-to-4');
            case "counterexample-image-4":
                return i18next.t('right-ui-curb-ramp-counterexample-3-to-4');
        }
    }

    function getMissingCurbRampDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui-missing-ramp-example-1-to-3');
            case "example-image-2":
                return i18next.t('right-ui-missing-ramp-example-1-to-3');
            case "example-image-3":
                return i18next.t('right-ui-missing-ramp-example-1-to-3');
            case "example-image-4":
                return i18next.t('right-ui-missing-ramp-example-4');
            case "counterexample-image-1":
                return i18next.t('right-ui-missing-ramp-counterexample-1');
            case "counterexample-image-2":
                return i18next.t('right-ui-missing-ramp-counterexample-2-and-4');
            case "counterexample-image-3":
                return i18next.t('right-ui-missing-ramp-counterexample-1');
            case "counterexample-image-4":
                return i18next.t('right-ui-missing-ramp-counterexample-2-and-4');
        }
    }

    function getObstacleDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui-obstacle-example-1');
            case "example-image-2":
                return i18next.t('right-ui-obstacle-example-2');
            case "example-image-3":
                return i18next.t('right-ui-obstacle-example-3');
            case "example-image-4":
                return i18next.t('right-ui-obstacle-example-4');
            case "counterexample-image-1":
                return i18next.t('right-ui-obstacle-counterexample-1');
            case "counterexample-image-2":
                return i18next.t('right-ui-obstacle-counterexample-2');
            case "counterexample-image-3":
                return i18next.t('right-ui-obstacle-counterexample-3');
            case "counterexample-image-4":
                return i18next.t('right-ui-obstacle-counterexample-4');
        }
    }

    function getSurfaceProblemDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui-surface-problem-example-1');
            case "example-image-2":
                return i18next.t('right-ui-surface-problem-example-2');
            case "example-image-3":
                return i18next.t('right-ui-surface-problem-example-3');
            case "example-image-4":
                return i18next.t('right-ui-surface-problem-example-4');
            case "counterexample-image-1":
                return i18next.t('right-ui-surface-problem-counterexample-1');
            case "counterexample-image-2":
                return i18next.t('right-ui-surface-problem-counterexample-2');
            case "counterexample-image-3":
                return i18next.t('right-ui-surface-problem-counterexample-3');
            case "counterexample-image-4":
                return i18next.t('right-ui-surface-problem-counterexample-4');
        }
    }

    function getNoSidewalkDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui-no-sidewalk-example-1-to-2');
            case "example-image-2":
                return i18next.t('right-ui-no-sidewalk-example-1-to-2');
            case "example-image-3":
                return i18next.t('right-ui-no-sidewalk-example-3');
            case "example-image-4":
                return i18next.t('right-ui-no-sidewalk-example-4');
            case "counterexample-image-1":
                return i18next.t('right-ui-no-sidewalk-counterexample-1');
            case "counterexample-image-2":
                return i18next.t('right-ui-no-sidewalk-counterexample-2');
            case "counterexample-image-3":
                return i18next.t('right-ui-no-sidewalk-counterexample-3');
            case "counterexample-image-4":
                return i18next.t('right-ui-no-sidewalk-counterexample-4');
        }
    }

    self.getCurbRampDescription = getCurbRampDescription;
    self.getMissingCurbRampDescription = getMissingCurbRampDescription;
    self.getObstacleDescription = getObstacleDescription;
    self.getSurfaceProblemDescription = getSurfaceProblemDescription;
    self.getNoSidewalkDescription = getNoSidewalkDescription;

    return this;
}
