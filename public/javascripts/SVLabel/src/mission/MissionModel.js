/**
 * Holds and triggers mission-related pub/sub events. The `EventMixin` emitter is mixed onto the prototype below,
 * providing `trigger`/`on`/etc. shared across the model modules.
 */
class MissionModel {
    fetchCompletedMissionsInNeighborhood(callback) {
        const _onFetch = (missions) => {
            for (let i = 0, len = missions.length; i < len; i++) {
                this.createAMission(missions[0]);
            }
        };

        if (callback) {
            $.when($.ajax(`/neighborhoodMissions?regionId=${svl.regionId}`)).done(_onFetch).done(callback);
        } else {
            $.when($.ajax(`/neighborhoodMissions?regionId=${svl.regionId}`)).done(_onFetch);
        }
    }

    addAMission(mission) {
        this.trigger('MissionContainer:addAMission', mission);
    }

    completeMission(mission) {
        this.trigger('MissionProgress:complete', { mission });
    }

    createAMission(parameters) {
        this.trigger('MissionFactory:create', parameters);
    }

    /**
     * Notify the mission modules with MissionProgress:update
     */
    updateMissionProgress(mission, neighborhood) {
        this.trigger('MissionProgress:update', { mission, neighborhood });
    }
}
Object.assign(MissionModel.prototype, EventMixin);
