class AchievementTracker{
    /**
     *
     * @param curMissionCnt
     * @param curDistance
     * @param curLabelsCnt
     * @param curValidationsCnt
     * @param curAccuracy
     */
    // constructor(curMissionCnt, curDistance, curLabelsCnt, curValidationsCnt, curAccuracy){
    constructor(){
        this.mapBadges = {};
        this.mapBadges[BadgeTypes.Missions] = {
            1 : new Badge(BadgeTypes.Missions, 1, 5),
            2 : new Badge(BadgeTypes.Missions, 2, 10),
            3 : new Badge(BadgeTypes.Missions, 3, 20),
            4 : new Badge(BadgeTypes.Missions, 4, 50),
            5 : new Badge(BadgeTypes.Missions, 5, 100)
        };

        this.mapBadges[BadgeTypes.Distance] = {
            // All distances currently in miles
            1 : new Badge(BadgeTypes.Distance, 1, 0.094697), // 500 ft
            2 : new Badge(BadgeTypes.Distance, 2, 0.25),
            3 : new Badge(BadgeTypes.Distance, 3, 0.5),
            4 : new Badge(BadgeTypes.Distance, 4, 1),
            5 : new Badge(BadgeTypes.Distance, 5, 5)
        };

        this.mapBadges[BadgeTypes.Labels] = {
            1 : new Badge(BadgeTypes.Labels, 1, 50),
            2 : new Badge(BadgeTypes.Labels, 2, 250),
            3 : new Badge(BadgeTypes.Labels, 3, 500),
            4 : new Badge(BadgeTypes.Labels, 4, 1000),
            5 : new Badge(BadgeTypes.Labels, 5, 5000)
        };

        this.mapBadges[BadgeTypes.Validations] = {
            // All distances currently in miles
            1 : new Badge(BadgeTypes.Validations, 1, 100),
            2 : new Badge(BadgeTypes.Validations, 2, 250),
            3 : new Badge(BadgeTypes.Validations, 3, 500),
            4 : new Badge(BadgeTypes.Validations, 4, 1000),
            5 : new Badge(BadgeTypes.Validations, 5, 5000)
        };
    }

    /**
     * Gets the current badge for the given badgeType and value (where value corresponds to the current number
     * of completed missions, total distance, num of labels, etc. for that user)
     *
     * @param badgeType: is one of four BadgeTypes: "missions", "distance", "labels", or "validations"
     * @param value: value corresponds to the current number of completed missions, total distance, num of labels, etc.
     *               corresponding to the passed badgeType
     * @returns {null} null if no badge earned or if no badge found for the passed badgeType. Otherwise, the Badge
     *          corresponding to the highest level earned
     */
    getBadgeEarned(badgeType, value){
        if (badgeType in this.mapBadges){
            let mapLevelsToBadge = this.mapBadges[badgeType]
            let prevBadge = null;
            for (let level in mapLevelsToBadge){
                let badge = mapLevelsToBadge[level];
                if (badge.threshold > value){
                    return prevBadge;
                }
                prevBadge = badge;
            }
        }
        return null;
    }

    /**
     * Updates the badge achievement grid based on the current number of missions, current distance (in miles),
     * current label count, and current validation count
     *
     * @param curMissionCnt: current mission count
     * @param curDistance: current completed distance amount (in miles)
     * @param curLabelsCnt: current label count
     * @param curValidationsCnt: current validation count
     */
    updateBadgeAchievementGrid(curMissionCnt, curDistance, curLabelsCnt, curValidationsCnt){
        const BADGE_NOT_YET_EARNED_CLASS_NAME = "badge-not-yet-earned";
        let mapBadgeTypesToCurrentValues = {};
        mapBadgeTypesToCurrentValues[BadgeTypes.Missions] = curMissionCnt;
        mapBadgeTypesToCurrentValues[BadgeTypes.Distance] = curDistance;
        mapBadgeTypesToCurrentValues[BadgeTypes.Labels] = curLabelsCnt;
        mapBadgeTypesToCurrentValues[BadgeTypes.Validations] = curValidationsCnt;

        for(let badgeType in this.mapBadges){
            let mapLevelsToBadge = this.mapBadges[badgeType]
            let curValue = mapBadgeTypesToCurrentValues[badgeType];

            for (let level in mapLevelsToBadge){
                let badge = mapLevelsToBadge[level];
                let badgeHtmlId = badge.type + "-badge" + badge.level;
                let badgeHtmlElement = document.getElementById(badgeHtmlId);

                if (badge.threshold > curValue){
                    badgeHtmlElement.className = BADGE_NOT_YET_EARNED_CLASS_NAME;
                }else{
                    badgeHtmlElement.classList.remove(BADGE_NOT_YET_EARNED_CLASS_NAME);
                }
            }

            let badgeEncouragementHtmlId = badgeType + "-badge-encouragement";
            document.getElementById(badgeEncouragementHtmlId).innerHTML = this.getBadgeEncouragementHtml(badgeType, curValue);
        }
    }

    /**
     * Get a dynamic encouragement statement for the given badge type with the current value
     *
     * @param badgeType: is one of four BadgeTypes: "missions", "distance", "labels", or "validations"
     * @param curValue: value corresponds to the current number of completed missions, total distance, num of labels, etc.
     *               corresponding to the passed badgeType
     */
    getBadgeEncouragementHtml(badgeType, curValue){
        let mapLevelsToBadge = this.mapBadges[badgeType]
        let nextBadgeToUnlock = null;
        if (badgeType in this.mapBadges){
            let mapLevelsToBadge = this.mapBadges[badgeType]

            for (let level in mapLevelsToBadge){
                let badge = mapLevelsToBadge[level];
                if (badge.threshold > curValue && nextBadgeToUnlock == null){
                    nextBadgeToUnlock = badge;
                    break;
                }
            }
        }

        let htmlStatement = "";

        let badgeName = badgeType;
        if(badgeName != BadgeTypes.Distance){
            badgeName = badgeName.slice(0, -1); // remove the 's' from missions, labels, and validations
        }

        if (nextBadgeToUnlock != null){
            let diffValue = nextBadgeToUnlock.threshold - curValue;

            let curBadge = null;
            const curBadgeLevel = nextBadgeToUnlock.level - 1;
            let fractionComplete = 0;
            if(curBadgeLevel in mapLevelsToBadge){
                curBadge = mapLevelsToBadge[curBadgeLevel];
                let badgeValueRange = nextBadgeToUnlock.threshold - curBadge.threshold;
                fractionComplete = (curValue - curBadge.threshold) / badgeValueRange;
            }else{
                fractionComplete = curValue / nextBadgeToUnlock.threshold;
            }

            let moreNoun = badgeType;
            if(badgeType == BadgeTypes.Distance){
                moreNoun = "miles";
                diffValue = diffValue.toFixed(1); // yes, makes diffValue into a String
            }

            if(diffValue == 1){
                moreNoun = moreNoun.slice(0, -1); // remove the 's' as non-plural
            }

            console.log(badgeType, "fractionComplete", fractionComplete, "curBadgeLevel", curBadgeLevel, "curValue", curValue, "diffValue", diffValue);
            if(fractionComplete > 0.95){
                htmlStatement += "So close! Just ";
            }else if(fractionComplete > 0.85){
                htmlStatement += "Wow, almost there! Just ";
            }else if(fractionComplete > 0.1 || curBadgeLevel > 0){
                let randVal = Math.random();
                if(randVal >= 0.9){
                    htmlStatement += "Awesome! ";
                }else if(randVal >= 0.8){
                    htmlStatement += "Woohoo! ";
                }else if(randVal >= 0.7){
                    htmlStatement += "You can do it! ";
                }else if(randVal >= 0.6){
                    htmlStatement += "Amazing work! ";
                }else if(randVal >= 0.5){
                    htmlStatement += "Nice job! ";
                }else if(randVal >= 0.4){
                    htmlStatement += "Keep it up! ";
                }else if(randVal >= 0.3){
                    htmlStatement += "Now we're rolling! ";
                }else if(randVal >= 0.2){
                    htmlStatement += "Thanks for helping! ";
                }else if(randVal >= 0.1){
                    if(fractionComplete > 0.5){
                        htmlStatement += "You're more than halfway! ";
                    }else {
                        htmlStatement += "Making great progress! ";
                    }
                }else{
                    htmlStatement += "Great job! ";
                }
            }

            htmlStatement += "<strong>" + diffValue + " more " + moreNoun + "</strong> until your";
            if(curBadgeLevel == 0){
                htmlStatement += " first "
            }else{
                htmlStatement += " next "
            }

            htmlStatement += badgeName + " achievement.";
        }else{
            htmlStatement = "Congratulations, you've earned all " + badgeName + " badges!";
        }

        return htmlStatement;
    }
}

const BadgeTypes = Object.freeze({
    Missions: "missions",
    Distance: "distance",
    Labels: "labels",
    Validations: "validations"
});


class Badge{

    /**
     *
     * @param type
     * @param level
     * @param badgeAwardThreshold
     */
    constructor(type, level, badgeAwardThreshold){
        const imagePath = "images/badges";

        this.type = type;
        this.level = level;
        this.threshold = badgeAwardThreshold;
        this.imagePath = imagePath + "/" + "badge_" + type + "_badge" + level + ".png";
    }
}