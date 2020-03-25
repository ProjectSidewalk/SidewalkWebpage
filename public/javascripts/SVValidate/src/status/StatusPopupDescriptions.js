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
                return i18next.t('right-ui.correct.CurbRamp.example-1-to-4');
            case "example-image-2":
                return i18next.t('right-ui.correct.CurbRamp.example-1-to-4');
            case "example-image-3":
                return i18next.t('right-ui.correct.CurbRamp.example-1-to-4');
            case "example-image-4":
                return i18next.t('right-ui.correct.CurbRamp.example-1-to-4');
            case "counterexample-image-1":
                return i18next.t('right-ui.incorrect.CurbRamp.example-1-to-2');
            case "counterexample-image-2":
                return i18next.t('right-ui.incorrect.CurbRamp.example-1-to-2');
            case "counterexample-image-3":
                return i18next.t('right-ui.incorrect.CurbRamp.example-3-to-4');
            case "counterexample-image-4":
                return i18next.t('right-ui.incorrect.CurbRamp.example-3-to-4');
        }
    }

    function getMissingCurbRampDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui.correct.NoCurbRamp.example-1-to-3');
            case "example-image-2":
                return i18next.t('right-ui.correct.NoCurbRamp.example-1-to-3');
            case "example-image-3":
                return i18next.t('right-ui.correct.NoCurbRamp.example-1-to-3');
            case "example-image-4":
                return i18next.t('right-ui.correct.NoCurbRamp.example-4');
            case "counterexample-image-1":
                return i18next.t('right-ui.incorrect.NoCurbRamp.example-1');
            case "counterexample-image-2":
                return i18next.t('right-ui.incorrect.NoCurbRamp.example-2-and-4');
            case "counterexample-image-3":
                return i18next.t('right-ui.incorrect.NoCurbRamp.example-3');
            case "counterexample-image-4":
                return i18next.t('right-ui.incorrect.NoCurbRamp.example-2-and-4');
        }
    }

    function getObstacleDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui.correct.Obstacle.example-1');
            case "example-image-2":
                return i18next.t('right-ui.correct.Obstacle.example-2');
            case "example-image-3":
                return i18next.t('right-ui.correct.Obstacle.example-3');
            case "example-image-4":
                return i18next.t('right-ui.correct.Obstacle.example-4');
            case "counterexample-image-1":
                return i18next.t('right-ui.incorrect.Obstacle.example-1');
            case "counterexample-image-2":
                return i18next.t('right-ui.incorrect.Obstacle.example-2');
            case "counterexample-image-3":
                return i18next.t('right-ui.incorrect.Obstacle.example-3');
            case "counterexample-image-4":
                return i18next.t('right-ui.incorrect.Obstacle.example-4');
        }
    }

    function getSurfaceProblemDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui.correct.SurfaceProblem.example-1');
            case "example-image-2":
                return i18next.t('right-ui.correct.SurfaceProblem.example-2');
            case "example-image-3":
                return i18next.t('right-ui.correct.SurfaceProblem.example-3');
            case "example-image-4":
                return i18next.t('right-ui.correct.SurfaceProblem.example-4');
            case "counterexample-image-1":
                return i18next.t('right-ui.incorrect.SurfaceProblem.example-1');
            case "counterexample-image-2":
                return i18next.t('right-ui.incorrect.SurfaceProblem.example-2');
            case "counterexample-image-3":
                return i18next.t('right-ui.incorrect.SurfaceProblem.example-3');
            case "counterexample-image-4":
                return i18next.t('right-ui.incorrect.SurfaceProblem.example-4');
        }
    }

    function getNoSidewalkDescription (id) {
        switch (id) {
            case "example-image-1":
                return i18next.t('right-ui.correct.NoSidewalk.example-1-to-2');
            case "example-image-2":
                return i18next.t('right-ui.correct.NoSidewalk.example-1-to-2');
            case "example-image-3":
                return i18next.t('right-ui.correct.NoSidewalk.example-3');
            case "example-image-4":
                return i18next.t('right-ui.correct.NoSidewalk.example-4');
            case "counterexample-image-1":
                return i18next.t('right-ui.incorrect.NoSidewalk.example-1');
            case "counterexample-image-2":
                return i18next.t('right-ui.incorrect.NoSidewalk.example-2');
            case "counterexample-image-3":
                return i18next.t('right-ui.incorrect.NoSidewalk.example-3');
            case "counterexample-image-4":
                return i18next.t('right-ui.incorrect.NoSidewalk.example-4');
        }
    }

    self.getCurbRampDescription = getCurbRampDescription;
    self.getMissingCurbRampDescription = getMissingCurbRampDescription;
    self.getObstacleDescription = getObstacleDescription;
    self.getSurfaceProblemDescription = getSurfaceProblemDescription;
    self.getNoSidewalkDescription = getNoSidewalkDescription;

    return this;
}
