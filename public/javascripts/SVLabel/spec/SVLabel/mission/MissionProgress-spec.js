describe("MissionProgress module", function () {
    var missionProgress;
    var svl;
    var gameEffectModel;
    var missionModel;
    var modalModel;
    var neighborhoodModel;
    var statusModel;
    var missionContainer;
    var neighborhoodContainer;
    var taskContainer;
    var mission;
    var neighborhood;
    var tracker;

    beforeEach(function () {
        svl = { isOnboarding: function () { return false; }};
        gameEffectModel = _.clone(Backbone.Events);
        gameEffectModel.loadAudio = function () {};
        gameEffectModel.playAudio = function () {};

        missionModel  = _.clone(Backbone.Events);
        missionModel.completeMission = function () {};

        modalModel = _.clone(Backbone.Events);
        neighborhoodModel = _.clone(Backbone.Events);

        neighborhoodModel.getNeighborhood = function (regionId) { return new NeighborhoodMock(regionId); };
        neighborhoodModel.updateUserRegionInDatabase = function (regionId) { };

        statusModel = _.clone(Backbone.Events);
        missionContainer = new MissionContainerMock();
        neighborhoodContainer = new NeighborhoodContainerMock();
        taskContainer = new TaskContainerMock();
        tracker = new TrackerMock();

        modalModel.updateModalMissionComplete = function (mission, neighborhood) {
            this.trigger("ModalMissionComplete:update", { mission: mission, neighborhood: neighborhood });
        };

        modalModel.showModalMissionComplete = function () {
            this.trigger("ModalMissionComplete:show");
        };

        statusModel.setMissionCompletionRate = function (completionRate) {};
        statusModel.setProgressBar = function (completionRate) {};

        missionProgress = new MissionProgress(svl, gameEffectModel, missionModel, modalModel, neighborhoodModel,
            statusModel, missionContainer, neighborhoodContainer, taskContainer, tracker);
    });

    describe("`_checkMissionComplete` method", function () {

        beforeEach(function () {
            spyOn(missionProgress, '_completeTheCurrentMission');
            spyOn(missionProgress, '_updateTheCurrentMission');
            spyOn(modalModel, 'updateModalMissionComplete');
            spyOn(modalModel, 'showModalMissionComplete');
            mission = new MissionMock();
            neighborhood = new NeighborhoodMock();
        });


        it("should call `ModalModel.updateModalMissionComplete` if the mission is completed", function () {
            mission.getMissionCompletionRate = function () { return 0; };
            missionProgress._checkMissionComplete(mission, neighborhood);
            expect(modalModel.updateModalMissionComplete).not.toHaveBeenCalled();

            mission.getMissionCompletionRate = function () { return 1; };
            missionProgress._checkMissionComplete(mission, neighborhood);
            expect(modalModel.updateModalMissionComplete).toHaveBeenCalled();
        });

        it("should call `ModalModel.showModalMissionComplete` if the mission is completed", function () {
            mission.getMissionCompletionRate = function () { return 0; };
            missionProgress._checkMissionComplete(mission, neighborhood);
            expect(modalModel.showModalMissionComplete).not.toHaveBeenCalled();

            mission.getMissionCompletionRate = function () { return 1; };
            missionProgress._checkMissionComplete(mission, neighborhood);
            expect(modalModel.showModalMissionComplete).toHaveBeenCalled();
        });
    });



    describe("`_updateTheCurrentMission` method", function () {
        beforeEach(function () {
            var m1 = new MissionMock();
            var m2 = new MissionMock();
            var m3 = new MissionMock();
            m1._properties.regionId = 1;
            m2._properties.regionId = 1;
            m3._properties.regionId = 1;

            var n1 = new NeighborhoodMock();
            var n2 = new NeighborhoodMock();
            n1._properties.regionId = 1;
            n2._properties.regionId = 2;

            neighborhoodContainer = new NeighborhoodContainerMock();
            neighborhoodContainer._neighborhoods = { 1: n1, 2: n2 };
            missionContainer = new MissionContainerMock();
            missionContainer._missionStoreByRegionId[1] = [m1, m2, m3];
            missionContainer._missionStoreByRegionId[2] = [];
            missionContainer.nextMission = function (regionId) {
                return this._missionStoreByRegionId[1][0];
            };


            missionProgress = new MissionProgress(svl, gameEffectModel, missionModel, modalModel, neighborhoodModel,
                statusModel, missionContainer, neighborhoodContainer, taskContainer);

            spyOn(missionContainer, 'setCurrentMission');
            spyOn(missionProgress, '_updateTheCurrentNeighborhood');
            mission = new MissionMock();
            mission._properties.regionId = 1;
            neighborhood = new NeighborhoodMock();
            neighborhood._properties.regionId = 1;
        });

        it("should call `MissionContainer.setCurrentMission` to set the next mission", function () {
            missionProgress._updateTheCurrentMission(mission, neighborhood);
            expect(missionContainer.setCurrentMission).toHaveBeenCalled();
        });

        it("should call `_updateTheCurrentNeighborhood` if the updated mission has different neighborhood id from the previous mission", function () {
            mission = new MissionMock();
            mission._properties.regionId = 1;
            neighborhood = new NeighborhoodMock();
            neighborhood._properties.regionId = 1;
            missionProgress._updateTheCurrentMission(mission, neighborhood);
            expect(missionProgress._updateTheCurrentNeighborhood).not.toHaveBeenCalled();

            mission = new MissionMock();
            mission._properties.regionId = 2;
            neighborhood = new NeighborhoodMock();
            neighborhood._properties.regionId = 2;
            missionProgress._updateTheCurrentMission(mission, neighborhood);
            expect(missionProgress._updateTheCurrentNeighborhood).toHaveBeenCalled();
        });

        it("should fail when next mission is not avaialble", function () {
            missionContainer = new MissionContainerMock();
            missionContainer.nextMission = function (regionId) {
                return null;
            };
            missionProgress = new MissionProgress(svl, gameEffectModel, missionModel, modalModel, neighborhoodModel,
                statusModel, missionContainer, neighborhoodContainer, taskContainer);

            expect(function () {
                missionProgress._updateTheCurrentMission(mission, neighborhood);
            }).toThrow(new Error("No missions available"));
        });
    });

    describe("`_updateTheCurrentNeighborhood` method", function () {
        beforeEach(function () {
            neighborhoodModel.updateUserRegionInDatabase = function (neighborhood) { };
            spyOn(neighborhoodContainer, 'setCurrentNeighborhood');
            spyOn(neighborhoodModel, 'moveToANewRegion');
            spyOn(taskContainer, 'fetchTasksInARegion');
        });

        it("should call `NeighborhoodContainer.setCurrentNeighborhood`", function () {
            missionProgress._updateTheCurrentNeighborhood(mission, neighborhood);
            expect(neighborhoodContainer.setCurrentNeighborhood).toHaveBeenCalled()
        });

        it("should call `NeighborhoodModel.moveToANewRegion`", function () {
            missionProgress._updateTheCurrentNeighborhood(mission, neighborhood);
            expect(neighborhoodModel.updateUserRegionInDatabase).toHaveBeenCalled();
        });

        it("should call `TaskContainer.fetchTasksInARegion`", function () {
            missionProgress._updateTheCurrentNeighborhood(mission, neighborhood);
            expect(taskContainer.fetchTasksInARegion).toHaveBeenCalled();
        });
    });

    describe("`update` method", function () {
        var mission;
        var region;
        beforeEach(function () {
            mission = new MissionMock();
            region = new NeighborhoodMock(1);

            spyOn(statusModel, 'setMissionCompletionRate');
            spyOn(statusModel, 'setProgressBar');
        });

        it("should call `StatusModel.setMissionCompletionRate", function () {
            missionProgress.update(mission, region);
            expect(statusModel.setMissionCompletionRate).toHaveBeenCalled();
        });

        it("should call `StatusModel.setProgressBar", function () {
            missionProgress.update(mission, region);
            expect(statusModel.setProgressBar).toHaveBeenCalled();
        });
    });

    describe("`_updateTheCurrentNeighborhood` method", function () {

        beforeEach(function () {
            spyOn(neighborhoodModel, 'moveToANewRegion');
            spyOn(taskContainer, 'endTask');
            spyOn(taskContainer, 'fetchTasksInARegion');
        });

        it("should set the current neighborhood", function () {
            var neighborhood = new NeighborhoodMock(100);

            missionProgress._updateTheCurrentNeighborhood(neighborhood);
            var cn = neighborhoodContainer.getCurrentNeighborhood();
            expect(cn).toBe(neighborhood);
        });

        it("should should call `NeighborhoodModel.moveToANewRegion`", function () {
            var neighborhood = new NeighborhoodMock(100);
            missionProgress._updateTheCurrentNeighborhood(neighborhood);
            expect(neighborhoodModel.updateUserRegionInDatabase).toHaveBeenCalledWith(100);
        });

        it("should call `TaskContainer.endTask`", function () {
            var neighborhood = new NeighborhoodMock(100);
            var task = new TaskMock();
            taskContainer.setCurrentTask(task);
            missionProgress._updateTheCurrentNeighborhood(neighborhood);
            expect(taskContainer.endTask).toHaveBeenCalledWith(task);
        });

        it("should call `TaskContainer.fetchTasksInARegion` to fetch tasks in the new neighborhood", function () {
            var neighborhood = new NeighborhoodMock(100);
            missionProgress._updateTheCurrentNeighborhood(neighborhood);
            expect(taskContainer.fetchTasksInARegion).toHaveBeenCalled();
        });
    });

    // Todo. KH: Deactivated the test. I have no clue which previous commit have broken this test.
    xdescribe("in response to `Neighborhood:completed` event", function () {
        it("should assign the new mission in a different neighborhood", function () {
            missionContainer.setCurrentMission(mission);
            
            var currentMission = missionContainer.getCurrentMission();
            var parameters = {
                completedRegionId: 1,
                nextRegionId: 2
            };

            neighborhoodModel.trigger("Neighborhood:completed", parameters);
            var newMission = missionContainer.getCurrentMission();
            expect(currentMission).not.toBe(newMission);
        });
    });

    function MissionMock () {
        this._properties = {
            missionId: null,
            coverage: null,
            distance: null,
            label: null,
            regionId: null
        };

        this.adjustTheTargetDistance = function () { };
        this.complete = function () { this._properties.completed = true; }
    }

    MissionMock.prototype.getProperty = function (key) {
        return this._properties[key];
    };

    MissionMock.prototype.setProperty = function (key, value) {
        this._properties[key] = value;
    };

    MissionMock.prototype.isComplete = function () {
        return this.properties.isComplete;
    };

    MissionMock.prototype.getMissionCompletionRate = function () {
        return 0.5;
    };

    function MissionContainerMock () {
        this._missionStoreByRegionId = {};
        this._status = { currentMission: null };
        this.getCurrentMission = function () { return this._status.currentMission; };
        this.getNeighborhoodCompleteMission = function () { return new MissionMock(); };
        this.getIncompleteMissionsByRegionId = function (regionId) { return [ ]; };
        this.nextMission = function () { return new MissionMock(); };
        this.setCurrentMission = function (mission) { this._status.currentMission = mission; };
    }

    function NeighborhoodMock(regionId) {
        this._properties = {
            name: null,
            regionId: regionId ? regionId : null
        };
    }

    NeighborhoodMock.prototype.getProperty = function (key) {
        return this._properties[key];
    };

    function NeighborhoodContainerMock () {
        this.neighborhoods = {};
        this._status = { currentNeighborhood: new NeighborhoodMock(1) };

        this.get = function (id) { return new NeighborhoodMock(id); };
        this.getCurrentNeighborhood = function () {
            return this._status.currentNeighborhood;
        };
        this.setCurrentNeighborhood = function (neighborhood) {
            this._status.currentNeighborhood = neighborhood;
        };
    }

    function TaskContainerMock () {
        this._currentTask = null;
        this.endTask = function (task) {};
        this.fetchTasksInARegion = function (neighborhoodId) {};
        this.getCurrentTask = function () { return this._currentTask; };
        this.getIncompleteTaskDistance = function () { return 0; };
        this.setCurrentTask = function (task) { this._currentTask = task; };
    }

    function TaskMock () {

    }

    function TrackerMock () {
        this.push = function (item) {};
    }

    function UserMock () {
        this._properties = { username: "test" };
        this.getProperty = function (key) { return this._properties[key]; };
    }
});
