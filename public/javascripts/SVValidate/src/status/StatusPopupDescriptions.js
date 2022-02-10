/**
 * Stores string descriptions for each example and counterexample image for each label type that on the validation page.
 * @returns {StatusPopupDescriptions}
 * @constructor
 */
function StatusPopupDescriptions () {
    let self = this;

    function getCurbRampDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui.correct.curb-ramp.example-1-to-4');
            case "example-image-2":
                return i18next.t('right-ui.correct.curb-ramp.example-1-to-4');
            case "example-image-3":
                return i18next.t('right-ui.correct.curb-ramp.example-1-to-4');
            case "example-image-4":
                return i18next.t('right-ui.correct.curb-ramp.example-1-to-4');
            case "counterexample-image-1":
                return i18next.t('right-ui.incorrect.curb-ramp.example-1-to-2');
            case "counterexample-image-2":
                return i18next.t('right-ui.incorrect.curb-ramp.example-1-to-2');
            case "counterexample-image-3":
                return i18next.t('right-ui.incorrect.curb-ramp.example-3-to-4');
            case "counterexample-image-4":
                return i18next.t('right-ui.incorrect.curb-ramp.example-3-to-4');
        }
    }

    function getMissingCurbRampDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui.correct.no-curb-ramp.example-1-to-3');
            case "example-image-2":
                return i18next.t('right-ui.correct.no-curb-ramp.example-1-to-3');
            case "example-image-3":
                return i18next.t('right-ui.correct.no-curb-ramp.example-1-to-3');
            case "example-image-4":
                return i18next.t('right-ui.correct.no-curb-ramp.example-4');
            case "counterexample-image-1":
                return i18next.t('right-ui.incorrect.no-curb-ramp.example-1');
            case "counterexample-image-2":
                return i18next.t('right-ui.incorrect.no-curb-ramp.example-2-and-4');
            case "counterexample-image-3":
                return i18next.t('right-ui.incorrect.no-curb-ramp.example-3');
            case "counterexample-image-4":
                return i18next.t('right-ui.incorrect.no-curb-ramp.example-2-and-4');
        }
    }

    function getObstacleDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui.correct.obstacle.example-1');
            case "example-image-2":
                return i18next.t('right-ui.correct.obstacle.example-2');
            case "example-image-3":
                return i18next.t('right-ui.correct.obstacle.example-3');
            case "example-image-4":
                return i18next.t('right-ui.correct.obstacle.example-4');
            case "counterexample-image-1":
                return i18next.t('right-ui.incorrect.obstacle.example-1');
            case "counterexample-image-2":
                return i18next.t('right-ui.incorrect.obstacle.example-2');
            case "counterexample-image-3":
                return i18next.t('right-ui.incorrect.obstacle.example-3');
            case "counterexample-image-4":
                return i18next.t('right-ui.incorrect.obstacle.example-4');
        }
    }

    function getSurfaceProblemDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui.correct.surface-problem.example-1');
            case "example-image-2":
                return i18next.t('right-ui.correct.surface-problem.example-2');
            case "example-image-3":
                return i18next.t('right-ui.correct.surface-problem.example-3');
            case "example-image-4":
                return i18next.t('right-ui.correct.surface-problem.example-4');
            case "counterexample-image-1":
                return i18next.t('right-ui.incorrect.surface-problem.example-1');
            case "counterexample-image-2":
                return i18next.t('right-ui.incorrect.surface-problem.example-2');
            case "counterexample-image-3":
                return i18next.t('right-ui.incorrect.surface-problem.example-3');
            case "counterexample-image-4":
                return i18next.t('right-ui.incorrect.surface-problem.example-4');
        }
    }

    function getNoSidewalkDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui.correct.no-sidewalk.example-1-to-2');
            case "example-image-2":
                return i18next.t('right-ui.correct.no-sidewalk.example-1-to-2');
            case "example-image-3":
                return i18next.t('right-ui.correct.no-sidewalk.example-3');
            case "example-image-4":
                return i18next.t('right-ui.correct.no-sidewalk.example-4');
            case "counterexample-image-1":
                return i18next.t('right-ui.incorrect.no-sidewalk.example-1');
            case "counterexample-image-2":
                return i18next.t('right-ui.incorrect.no-sidewalk.example-2');
            case "counterexample-image-3":
                return i18next.t('right-ui.incorrect.no-sidewalk.example-3');
            case "counterexample-image-4":
                return i18next.t('right-ui.incorrect.no-sidewalk.example-4');
        }
    }

    self.getCurbRampDescription = getCurbRampDescription;
    self.getMissingCurbRampDescription = getMissingCurbRampDescription;
    self.getObstacleDescription = getObstacleDescription;
    self.getSurfaceProblemDescription = getSurfaceProblemDescription;
    self.getNoSidewalkDescription = getNoSidewalkDescription;

    return this;
}
