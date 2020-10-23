class AchievementTracker {
    constructor() {
        this.mapBadges = {};
        this.mapBadges[BadgeTypes.Missions] = {
            1: new Badge(BadgeTypes.Missions, 1, 5),
            2: new Badge(BadgeTypes.Missions, 2, 10),
            3: new Badge(BadgeTypes.Missions, 3, 20),
            4: new Badge(BadgeTypes.Missions, 4, 50),
            5: new Badge(BadgeTypes.Missions, 5, 100)
        };

        this.mapBadges[BadgeTypes.Distance] = {
            // All distances currently in miles.
            1: new Badge(BadgeTypes.Distance, 1, 0.09), // approximately 500 ft
            2: new Badge(BadgeTypes.Distance, 2, 0.25),
            3: new Badge(BadgeTypes.Distance, 3, 0.5),
            4: new Badge(BadgeTypes.Distance, 4, 1),
            5: new Badge(BadgeTypes.Distance, 5, 5)
        };

        this.mapBadges[BadgeTypes.Labels] = {
            1: new Badge(BadgeTypes.Labels, 1, 50),
            2: new Badge(BadgeTypes.Labels, 2, 250),
            3: new Badge(BadgeTypes.Labels, 3, 500),
            4: new Badge(BadgeTypes.Labels, 4, 1000),
            5: new Badge(BadgeTypes.Labels, 5, 5000)
        };

        this.mapBadges[BadgeTypes.Validations] = {
            1: new Badge(BadgeTypes.Validations, 1, 100),
            2: new Badge(BadgeTypes.Validations, 2, 250),
            3: new Badge(BadgeTypes.Validations, 3, 500),
            4: new Badge(BadgeTypes.Validations, 4, 1000),
            5: new Badge(BadgeTypes.Validations, 5, 5000)
        };
    }

    /**
     * Gets the current badge given the user's progress for the given badge type.
     *
     * @param badgeType: is one of four BadgeTypes: "missions", "distance", "labels", or "validations"
     * @param value: value corresponds to the current number of completed missions, total distance, num of labels, etc.
     *               corresponding to the passed badgeType
     * @returns {null} null if no badge earned or if no badge found for the passed badgeType. Otherwise, the Badge
     *          corresponding to the highest level earned
     */
    getBadgeEarned(badgeType, value) {
        if (badgeType in this.mapBadges) {
            let mapLevelsToBadge = this.mapBadges[badgeType]
            let prevBadge = null;
            for (let level of Object.keys(mapLevelsToBadge)) {
                let badge = mapLevelsToBadge[level];
                if (badge.threshold > value) {
                    return prevBadge;
                }
                prevBadge = badge;
            }
        }
        return null;
    }

    /**
     * Updates the badge achievement grid given the user's current stats.
     *
     * @param curMissionCnt: current mission count
     * @param curDistanceInMiles: current completed distance amount (in miles)
     * @param curLabelsCnt: current label count
     * @param curValidationsCnt: current validation count
     * @param measurementSystem: either IS or metric
     */
    updateBadgeAchievementGrid(curMissionCnt, curDistanceInMiles, curLabelsCnt, curValidationsCnt, measurementSystem) {
        const BADGE_NOT_YET_EARNED_CLASS_NAME = "badge-not-yet-earned";
        let mapBadgeTypesToCurrentValues = {};
        mapBadgeTypesToCurrentValues[BadgeTypes.Missions] = curMissionCnt;
        mapBadgeTypesToCurrentValues[BadgeTypes.Distance] = curDistanceInMiles;
        mapBadgeTypesToCurrentValues[BadgeTypes.Labels] = curLabelsCnt;
        mapBadgeTypesToCurrentValues[BadgeTypes.Validations] = curValidationsCnt;

        for (let badgeType of Object.keys(this.mapBadges)) {
            let mapLevelsToBadge = this.mapBadges[badgeType]
            let curValue = mapBadgeTypesToCurrentValues[badgeType];

            for (let level of Object.keys(mapLevelsToBadge)) {
                let badge = mapLevelsToBadge[level];
                let badgeHtmlId = badge.type + "-badge" + badge.level;
                let badgeHtmlElement = document.getElementById(badgeHtmlId);

                if (badge.threshold > curValue) {
                    badgeHtmlElement.className = BADGE_NOT_YET_EARNED_CLASS_NAME;
                } else {
                    badgeHtmlElement.classList.remove(BADGE_NOT_YET_EARNED_CLASS_NAME);
                }

                // The parent element 'achievements-badge-grid' starts out invisible to make initial rendering cleaner.
                badgeHtmlElement.parentElement.style.visibility = 'visible';
            }

            let badgeEncouragementHtmlId = badgeType + "-badge-encouragement";
            document.getElementById(badgeEncouragementHtmlId).innerHTML = this.getBadgeEncouragementHtml(badgeType, curValue, measurementSystem);
        }
    }

    /**
     * Get a dynamic encouragement statement for the given badge type with the current value.
     *
     * @param badgeType: is one of four BadgeTypes: "missions", "distance", "labels", or "validations"
     * @param curValue: value corresponds to the current number of completed missions, total distance, num of labels, etc.
     *               corresponding to the passed badgeType
     * @param measurementSystem: "IS" or "metric" determines whether to use miles or kilometers
     */
    getBadgeEncouragementHtml(badgeType, curValue, measurementSystem) {
        // Find next badge to unlock.
        let mapLevelsToBadge = this.mapBadges[badgeType]
        let nextBadgeToUnlock = null;
        if (badgeType in this.mapBadges) {
            let mapLevelsToBadge = this.mapBadges[badgeType]

            for (let level of Object.keys(mapLevelsToBadge)) {
                let badge = mapLevelsToBadge[level];
                if (badge.threshold > curValue) {
                    nextBadgeToUnlock = badge;
                    break;
                }
            }
        }

        let htmlStatement = "";

        if (nextBadgeToUnlock != null) {
            let diffValue = nextBadgeToUnlock.threshold - curValue;
            let curBadge = null;
            const curBadgeLevel = nextBadgeToUnlock.level - 1;
            let fractionComplete = 0;

            // Figure out how close they are to the next badge.
            if (curBadgeLevel in mapLevelsToBadge) {
                curBadge = mapLevelsToBadge[curBadgeLevel];
                const badgeValueRange = nextBadgeToUnlock.threshold - curBadge.threshold;
                fractionComplete = (curValue - curBadge.threshold) / badgeValueRange;
            } else {
                fractionComplete = curValue / nextBadgeToUnlock.threshold;
            }

            // Add an encouraging statement based on how close they are to the next badge level.
            if (fractionComplete > 0.95) {
                htmlStatement += i18next.t('dashboard:so-close') + " " + i18next.t('dashboard:just') + " ";
            } else if (fractionComplete > 0.85) {
                htmlStatement += i18next.t('dashboard:wow-almost-there') + " " + i18next.t('dashboard:just') + " ";
            } else if (fractionComplete > 0.1 || curBadgeLevel > 0) {
                let randStatement = encouragingStatements[Math.floor(Math.random() * encouragingStatements.length)];
                htmlStatement += i18next.t(randStatement) + ' ';
            }

            // Convert to from miles to kilometers if using metric system.
            if (badgeType === BadgeTypes.Distance && measurementSystem === 'metric') diffValue *= 1.60934;

            // Get the appropriate distance unit, e.g., mission/misión, missions/misiones, labels/etiquetas.
            let unitTranslation;
            if (diffValue === 1) unitTranslation = 'dashboard:badge-' + badgeType + '-singular';
            else unitTranslation = 'dashboard:badge-' + badgeType + '-plural';

            const firstOrNextTranslation = curBadgeLevel === 0 ? 'dashboard:first' : 'dashboard:next';

            // Add translation for how much is left before the next achievement. For example, "1 misión más hasta tu
            // próximo logro." or "1.3 more miles until your next achievement."
            htmlStatement += i18next.t('dashboard:more-unit-until-achievement', {
                n: parseFloat(diffValue.toFixed(2)),
                unit: unitTranslation,
                firstOrNext: firstOrNextTranslation
            });
        } else {
            htmlStatement = i18next.t('dashboard:' + "badge-" + badgeType + "-earned-all");
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

const encouragingStatements = [
    'dashboard:awesome',
    'dashboard:woohoo',
    'dashboard:you-can-do-it',
    'dashboard:amazing-work',
    'dashboard:nice-job',
    'dashboard:keep-it-up',
    'dashboard:now-were-rolling',
    'dashboard:thanks-for-helping',
    'dashboard:making-great-progress',
    'dashboard:great-job'
];

class Badge {

    /**
     *
     * @param type
     * @param level
     * @param badgeAwardThreshold
     */
    constructor(type, level, badgeAwardThreshold) {
        const imagePath = "images/badges";

        this.type = type;
        this.level = level;
        this.threshold = badgeAwardThreshold;
        this.imagePath = imagePath + "/" + "badge_" + type + "_badge" + level + ".png";
    }
}
