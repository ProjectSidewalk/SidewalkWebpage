/**
 * Mission objects, stores data from mission table, as well as label counts and associated tasks.
 */
class Mission {
    #properties = {
        missionId: null,
        missionType: null,
        regionId: null,
        isComplete: false,
        distance: null,
        distanceProgress: null,
        skipped: false
    };
    #tasksForTheMission = [];
    #labelCountsAtCompletion;

    /**
     * Fills in the #properties object with the data for the mission table.
     * @param {object} params
     * @param {number} params.missionId
     * @param {string} params.missionType
     * @param {number} params.regionId
     * @param {boolean} params.isComplete
     * @param {number} params.distance
     * @param {number} params.distanceProgress
     * @param {boolean} params.skipped
     * @constructor
     */
    constructor(params) {
        this.setProperty('missionId', params.missionId);
        this.setProperty('missionType', params.missionType);
        this.setProperty('regionId', params.regionId);
        this.setProperty('isComplete', params.isComplete);
        this.setProperty('distance', params.distance);
        this.setProperty('distanceProgress', params.distanceProgress);
        this.setProperty('skipped', params.skipped);
    }

    /**
     * Set the isComplete property to true.
     * @returns {void}
     */
    complete = () => {
        this.setProperty('isComplete', true);

        // Set distanceProgress to be at most the distance for the mission, subtract the difference from the offset.
        if (this.getProperty('missionType') === 'audit') {
            const distanceOver = this.getProperty('distanceProgress') - this.getProperty('distance');
            const oldOffset = svl.missionContainer.getTasksMissionsOffset();
            const newOffset = oldOffset - distanceOver;
            svl.missionContainer.setTasksMissionsOffset(newOffset);
        }

        // Reset the label counter
        if ('labelCounter' in svl) {
            this.#labelCountsAtCompletion = {
                'CurbRamp': svl.labelCounter.countLabel('CurbRamp'),
                'NoCurbRamp': svl.labelCounter.countLabel('NoCurbRamp'),
                'Obstacle': svl.labelCounter.countLabel('Obstacle'),
                'SurfaceProblem': svl.labelCounter.countLabel('SurfaceProblem'),
                'NoSidewalk': svl.labelCounter.countLabel('NoSidewalk'),
                'Other': svl.labelCounter.countLabel('Other')
            };
            svl.labelCounter.reset();
        }

        if (!svl.isOnboarding()) {
            svl.storage.set('completedFirstMission', true);
        }
    };

    /**
     * This method returns the label count object
     * @returns {object}
     */
    getLabelCount = () => {
        return this.#labelCountsAtCompletion;
    };

    /**
     * Compute and return the mission completion rate
     * @returns {number} The completion rate of the mission between 0 and 1
     */
    getMissionCompletionRate = () => {
        this.updateDistanceProgress();
        if ('taskContainer' in svl && this.getProperty('missionType') !== 'auditOnboarding') {
            const distanceProgress = this.getProperty('distanceProgress');
            const targetDistance = this.getDistance('meters');
            return Math.min(Math.max(distanceProgress / targetDistance, 0), 1);
        } else {
            return 0;
        }
    };

    /**
     * Updates the distanceProgress for this audit mission.
     * @returns {void}
     */
    updateDistanceProgress = () => {
        if ('taskContainer' in svl
            && this.getProperty('missionType') !== 'auditOnboarding'
            && svl.missionContainer.getTasksMissionsOffset() !== null) {

            let currentMissionCompletedDistance;
            if (this.isComplete()) {
                currentMissionCompletedDistance = this.getDistance('meters');
            } else {
                const taskDistance = util.math.kmsToMeters(svl.taskContainer.getCompletedTaskDistance({units: 'kilometers'}));
                const offset = svl.missionContainer.getTasksMissionsOffset() || 0;

                const missionDistance = svl.missionContainer.getCompletedMissionDistance();
                currentMissionCompletedDistance = taskDistance - missionDistance + offset;
                // Hotfix for an issue where the mission completion distance was negative. Need to find root cause.
                // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2120
                if (currentMissionCompletedDistance < 0) {
                    svl.missionContainer.setTasksMissionsOffset(offset - currentMissionCompletedDistance);
                    console.error(`Mission progress was set to ${currentMissionCompletedDistance}, resetting to 0.`);
                    currentMissionCompletedDistance = 0;
                }
            }
            this.setProperty('distanceProgress', currentMissionCompletedDistance);
        }
    };

    /**
     * Returns a property
     * @param {string} key The property being requested
     * @returns {*|null} The value of the property, or null if no property found with that ID
     */
    getProperty = (key) => {
        return key in this.#properties ? this.#properties[key] : null;
    };

    /**
     * Get an array of tasks for this mission
     * @returns {Array<Task>}
     */
    getRoute = () => {
        return this.#tasksForTheMission;
    };

    /**
     * Sets a property
     * @param {string} key The property being set
     * @param {*} value The value to set that property to
     * @returns {void}
     */
    setProperty = (key, value) => {
        this.#properties[key] = value;
    };

    /**
     * Check if the mission is completed or not.
     * @returns {boolean}
     */
    isComplete = () => {
        return this.getProperty('isComplete');
    };

    /**
     * Push a completed task into `this.#tasksForTheMission`.
     * @param {Task} task
     */
    pushATaskToTheRoute = (task) => {
        const streetEdgeIds = this.#tasksForTheMission.map((task) => task.getStreetEdgeId());
        if (streetEdgeIds.indexOf(task.getStreetEdgeId()) < 0) {
            this.#tasksForTheMission.push(task);
        }
    };

    /**
     * Total line distance in this mission.
     * @param {string} [unit='meters'] One of 'meters', 'miles', 'feet', 'kilometers', or 'meters'
     */
    getDistance = (unit = 'meters') => {
        if (unit === 'miles')           return util.math.metersToMiles(this.getProperty('distance'));
        else if (unit === 'feet')       return util.math.metersToFeet(this.getProperty('distance'));
        else if (unit === 'kilometers') return util.math.metersToKms(this.getProperty('distance'));
        else if (unit === 'meters')     return this.getProperty('distance');
        else {
            console.error('Unit must be miles, feet, kilometers, or meters. Given: ' + unit);
            return this.getProperty('distance');
        }
    };
}
