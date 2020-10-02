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
     *
     * @param badgeType: is one of four BadgeTypes: "missions", "distance", "labels", or "validations"
     * @param value:
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

                console.log(badgeHtmlId, badgeHtmlElement, curValue);
                if (badge.threshold > curValue){
                    badgeHtmlElement.className = BADGE_NOT_YET_EARNED_CLASS_NAME;
                }else{
                    badgeHtmlElement.classList.remove(BADGE_NOT_YET_EARNED_CLASS_NAME);
                }
            }

            this.updateBadgeEncouragementHtml(badgeType, curValue);
        }
    }

    updateBadgeEncouragementHtml(badgeType, curValue){
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
        if (nextBadgeToUnlock != null){
            let diffValue = nextBadgeToUnlock.threshold - curValue;

            let moreNoun = badgeType;
            if(badgeType == BadgeTypes.Distance){
                moreNoun = "miles";
            }

            if(diffValue == 1){
                moreNoun = moreNoun.slice(0, -1); // remove the 's' as non-plural
            }
            htmlStatement = "Just " + diffValue + " more " + moreNoun + " until your next achievement."
        }else{
            let badgeName = badgeType;
            if(badgeName != BadgeTypes.Distance){
                badgeName = badgeName.slice(0, -1); // remove the 's' from missions, labels, and validations
            }
            htmlStatement = "Congratulations, you've earned all " + badgeName + " badges!";
        }

        let badgeEncouragementHtmlId = badgeType + "-badge-encouragement";
        document.getElementById(badgeEncouragementHtmlId).innerHTML = htmlStatement;
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