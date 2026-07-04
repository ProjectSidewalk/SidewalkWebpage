class AchievementTracker {
    constructor() {
        this.mapBadges = {};
        for (const badgeType of Object.values(BadgeTypes)) {
            const mapLevelsToBadge = {};
            BadgeAchievements.THRESHOLDS[badgeType].forEach((threshold, index) => {
                const level = index + 1;
                mapLevelsToBadge[level] = new Badge(badgeType, level, threshold);
            });
            this.mapBadges[badgeType] = mapLevelsToBadge;
        }
    }

    /**
     * Gets the current badge given the user's progress for the given badge type.
     * @param badgeType One of four BadgeTypes: "missions", "distance", "labels", or "validations".
     * @param value Number to display for the corresponding badgeType.
     * @returns {null} null if no badge earned or if no badge found for the passed badgeType. Otherwise, the Badge
     *          corresponding to the highest level earned
     */
    getBadgeEarned(badgeType, value) {
        if (badgeType in this.mapBadges) {
            const mapLevelsToBadge = this.mapBadges[badgeType];
            let prevBadge = null;
            for (const level of Object.keys(mapLevelsToBadge)) {
                const badge = mapLevelsToBadge[level];
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
     * @param curMissionCnt current mission count
     * @param curDistanceInMiles current completed distance amount (in miles)
     * @param curLabelsCnt current label count
     * @param curValidationsCnt current validation count
     */
    updateBadgeAchievementGrid(curMissionCnt, curDistanceInMiles, curLabelsCnt, curValidationsCnt) {
        const BADGE_NOT_YET_EARNED_CLASS_NAME = 'badge-not-yet-earned';
        const mapBadgeTypesToCurrentValues = {};
        mapBadgeTypesToCurrentValues[BadgeTypes.Missions] = curMissionCnt;
        mapBadgeTypesToCurrentValues[BadgeTypes.Distance] = curDistanceInMiles;
        mapBadgeTypesToCurrentValues[BadgeTypes.Labels] = curLabelsCnt;
        mapBadgeTypesToCurrentValues[BadgeTypes.Validations] = curValidationsCnt;

        for (const badgeType of Object.keys(this.mapBadges)) {
            const mapLevelsToBadge = this.mapBadges[badgeType];
            const curValue = mapBadgeTypesToCurrentValues[badgeType];

            for (const level of Object.keys(mapLevelsToBadge)) {
                const badge = mapLevelsToBadge[level];
                const badgeHtmlId = `${badge.type}-badge${badge.level}`;
                const badgeHtmlElement = document.getElementById(badgeHtmlId);

                if (badge.threshold > curValue) {
                    badgeHtmlElement.className = BADGE_NOT_YET_EARNED_CLASS_NAME;
                } else {
                    badgeHtmlElement.classList.remove(BADGE_NOT_YET_EARNED_CLASS_NAME);
                }

                // The parent element 'achievements-badge-grid' starts out invisible to make initial rendering cleaner.
                badgeHtmlElement.parentElement.style.visibility = 'visible';
            }

            const badgeEncouragementHtmlId = `${badgeType}-badge-encouragement`;
            document.getElementById(badgeEncouragementHtmlId).innerHTML = this.getBadgeEncouragementHtml(badgeType, curValue);
        }
    }

    /**
     * Get a dynamic encouragement statement for the given badge type with the current value.
     * @param badgeType is one of four BadgeTypes: "missions", "distance", "labels", or "validations"
     * @param curValue value corresponds to the current number of completed missions, total distance, num of labels, etc.
     *               corresponding to the passed badgeType
     */
    getBadgeEncouragementHtml(badgeType, curValue) {
        // Find next badge to unlock.
        const mapLevelsToBadge = this.mapBadges[badgeType];
        let nextBadgeToUnlock = null;
        if (badgeType in this.mapBadges) {
            for (const level of Object.keys(mapLevelsToBadge)) {
                const badge = mapLevelsToBadge[level];
                if (badge.threshold > curValue) {
                    nextBadgeToUnlock = badge;
                    break;
                }
            }
        }

        let htmlStatement = '';

        if (nextBadgeToUnlock !== null) {
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
                htmlStatement += `${i18next.t('dashboard:so-close')} ${i18next.t('dashboard:just')} `;
            } else if (fractionComplete > 0.85) {
                htmlStatement += `${i18next.t('dashboard:wow-almost-there')} ${i18next.t('dashboard:just')} `;
            } else if (fractionComplete > 0.1 || curBadgeLevel > 0) {
                const randStatement = encouragingStatements[Math.floor(Math.random() * encouragingStatements.length)];
                htmlStatement += `${i18next.t(randStatement)} `;
            }

            // Convert to from miles to kilometers if using metric system.
            const measurementSystem = i18next.t('common:measurement-system');
            if (badgeType === BadgeTypes.Distance && measurementSystem === 'metric') {
                diffValue = util.math.milesToKms(diffValue);
            }

            // Get the appropriate distance unit, e.g., mission/misión, missions/misiones, labels/etiquetas.
            let unitTranslation;
            if (diffValue === 1) unitTranslation = `dashboard:badge-${badgeType}-singular`;
            else unitTranslation = `dashboard:badge-${badgeType}-plural`;

            const firstOrNextTranslation = curBadgeLevel === 0 ? 'dashboard:first' : 'dashboard:next';

            // Add translation for how much is left before the next achievement. For example, "1 misión más hasta tu
            // próximo logro." or "1.3 more miles until your next achievement."
            htmlStatement += i18next.t('dashboard:more-unit-until-achievement', {
                n: parseFloat(diffValue.toFixed(2)),
                unit: unitTranslation,
                firstOrNext: firstOrNextTranslation,
            });
        } else {
            htmlStatement = i18next.t(`dashboard:badge-${badgeType}-earned-all`);
        }

        return htmlStatement;
    }
}

const BadgeTypes = Object.freeze({
    Missions: 'missions',
    Distance: 'distance',
    Labels: 'labels',
    Validations: 'validations',
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
    'dashboard:great-job',
];

class Badge {
    /**
     *
     * @param type
     * @param level
     * @param badgeAwardThreshold
     */
    constructor(type, level, badgeAwardThreshold) {
        const imagePath = 'images/badges';

        this.type = type;
        this.level = level;
        this.threshold = badgeAwardThreshold;
        this.imagePath = `${imagePath}/badge_${type}_badge${level}.png`;
    }
}
