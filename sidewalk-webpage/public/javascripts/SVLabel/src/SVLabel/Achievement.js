//function Achievement () {
//    var self = { className: "Achievement"},
//        initialAchievement = "incomplete",
//        achievements = {
//            "area-coverage": {}
//        };
//
//
//    function _init() {
//        // Initialize achievements
//        if ("neighborhood" in svl && "mission" in svl) {
//            var ids = svl.neighborhood.getNeighborhoodIds(),
//                len = ids.length,
//                areaCoverageMission = svl.mission.getMission("area-coverage"),
//                i, j;
//            for (i = 0; i < len; i++) {
//                for (j = areaCoverageMission.levels.length - 1; j >= 0; j--) {
//                    achievements["area-coverage"][i] = {};
//                    achievements["area-coverage"][i][areaCoverageMission.levels[j]] = "incomplete";
//                }
//            }
//        } else {
//            console.error("Neighborhood not defined");
//        }
//    }
//
//    /**
//     * Get the status of the achievement
//     * @param parameters
//     */
//    function getAchievement (parameters) {
//        if ("missionId" in parameters) {
//            if (parameters.missionId == "initial-mission") {
//                return initialAchievement;
//            } else if (parameters.missionId == "area-coverage" && "areaId" in parameters) {
//                if (!(parameters.areaId in achievements["area-coverage"])) {
//                    throw "Unknown NeighborhoodId";
//                } else if (!(parameters.level in achievements["area-coverage"][parameters.areaId])) {
//                    throw "Unknown mission level";
//                } else {
//                    var level = parseInt(parameters.level, 10);
//                    return achievements["area-coverage"][parameters.areaId][level];
//                }
//            } else {
//                throw "Check the parameters";
//            }
//        }
//    }
//
//    /**
//     * Set the status of the achievement
//     * @param parameters An object of parameters, which may specify "missionId", "areaId", "status", "level"
//     */
//    function setAchievement (parameters) {
//        if ("missionId" in parameters && "status" in parameters) {
//            if (parameters.missionId == "initial-mission") {
//                // Set the achievement for the "initial-mission"
//                initialAchievement = parameters.status;
//            } else if (parameters.missionId == "area-coverage" && "areaId" in parameters && parameters.areaId &&
//                "level" in parameters && parameters.level in achievements["area-coverage"][parameters.areaId]) {
//                // Set the achievement for the "area-coverage" mission.
//                if (!(parameters.areaId in achievements["area-coverage"])) {
//                    throw "Unknown NeighborhoodId";
//                } else if (!(parameters.level in achievements["area-coverage"][parameters.areaId])) {
//                    throw "Unknown mission level";
//                } else {
//                    var level = parseInt(parameters.level, 10);
//                    achievements["area-coverage"][parameters.areaId][level] = parameters.status;
//                }
//            }
//        }
//    }
//
//    /**
//     * Check if the given mission is completed or not.
//     * @param parameters
//     * @returns {boolean}
//     */
//    function isCompleted (parameters) {
//        return getAchievement(parameters) == "complete";
//    }
//
//    self.getAchievement = getAchievement;
//    self.isCompleted = isCompleted;
//    self.setAchievement = setAchievement;
//
//    _init();
//    return self;
//}