describe("MissionContainer module.", function () {
    var missionContainer;
    var missionFactory;
    var statusFieldMission;
    var missionModel;
    var taskModel;
    var m1_n1, m2_n1, m1_n2, m2_n2;

    beforeEach(function () {
        statusFieldMission = {};
        statusFieldMission.setMessage = function (mission) {};

        missionModel = _.clone(Backbone.Events);
        missionModel.submitMissions = function (missions) { };

        taskModel = _.clone(Backbone.Events);
        taskModel.tasksAreAvailableInARegion = function (regionId) { return true; };

        missionFactory = new MissionFactoryMock(missionModel);
        missionContainer = new MissionContainer(statusFieldMission, missionModel, taskModel);
        missionContainer.refresh();

        m1_n1 = missionFactory.create(1, 1, "distance-mission", 1, 1000, 1000, 1, 0.1, false);
        m2_n1 = missionFactory.create(1, 2, "distance-mission", 2, 2000, 2000, 2, 0.2, false);
        m1_n2 = missionFactory.create(2, 3, "distance-mission", 1, 1000, 1000, 1, 0.1, false);
        m2_n2 = missionFactory.create(2, 4, "distance-mission", 2, 2000, 2000, 2, 0.2, false);

        // missionContainer.add(1, m1_n1);
        // missionContainer.add(1, m2_n1);
        // missionContainer.add(2, m1_n2);
        // missionContainer.add(2, m2_n2);
    });

    describe("in response to events", function () {
        var missionMock;
        beforeEach(function () {
            missionContainer.refresh();
        });

        it("should add the completed mission to `completedMissions`", function (done) {
            missionModel.trigger("MissionProgress:complete", { mission: m1_n1 });

            var missions = missionContainer.getCompletedMissions();
            expect(missions).toEqual([m1_n1]);

            expect(missions.length).toBe(1);
            done();
        });

        it("should add completed missions to `completedMissions`", function () {
            var missions;
            m1_n1.setProperty('isCompleted', true);
            missionModel.trigger("MissionContainer:addAMission", m1_n1);

            missions = missionContainer.getCompletedMissions();
            expect(missions.length).toBe(1);

            m2_n1.setProperty('isCompleted', true);
            missionModel.trigger("MissionContainer:addAMission", m2_n1);

            missions = missionContainer.getCompletedMissions();
            expect(missions.length).toBe(2);

            missionModel.trigger("MissionContainer:addAMission", m2_n1);

            missions = missionContainer.getCompletedMissions();
            expect(missions.length).toBe(2);

        });
    });

    describe("`add` method", function(){
        beforeEach(function () {
            missionContainer.refresh();
        });

        it("should be able to add a new mission to the container", function() {
            var m1 = missionFactory.create(1, 1, "distance-mission", 1, 1000, 1000, 1, 0.1, false);
            var m2 = missionFactory.create(1, 2, "distance-mission", 2, 2000, 2000, 2, 0.2, false);
            missionContainer.add(1, m1);
            missionContainer.add(1, m2);
            var missions = missionContainer.getMissionsByRegionId(1);
            expect(missions.length).toBe(2);

            var m3 = missionFactory.create(0, 3, "test1", 1, 1000, 1000, 1, 0.1, false);
            missionContainer.add(0, m3);
            missions = missionContainer.getMissionsByRegionId(0);
            expect(missions.length).toBe(1);
        });

        it("should check duplicate", function () {
            var m1 = missionFactory.create(1, 1, "distance-mission", 1, 1000, 1000, 1, 0.1, false);
            var m2 = missionFactory.create(1, 1, "distance-mission", 1, 1000, 1000, 1, 0.1, false);
            missionContainer.add(1, m1);
            missionContainer.add(1, m2);
            var missions = missionContainer.getMissionsByRegionId(1);
            expect(missions.length).toBe(1);
        });
    });

    describe("`getCompletedMissions` method", function () {
        beforeEach(function () {
            missionContainer.refresh();

            m1_n1.properties.isCompleted = true;
            m1_n2.properties.isCompleted = true;
            missionContainer.add(1, m1_n1);
            missionContainer.add(1, m2_n1);
            missionContainer.add(2, m1_n2);
            missionContainer.add(2, m2_n2);
            missionContainer.addToCompletedMissions(m1_n1);
            missionContainer.addToCompletedMissions(m1_n2);
        });

        it("should return the completed missions", function () {
            var completedMissions = missionContainer.getCompletedMissions();
            expect(completedMissions).toEqual([m1_n1, m1_n2]);
        });
    });

    describe("`getIncompleteMissionsByRegionId` method", function () {
        beforeEach(function () {
            m1_n1.properties.isCompleted = true;
            m1_n2.properties.isCompleted = true;
            missionContainer.add(1, m1_n1);
            missionContainer.add(1, m2_n1);
            missionContainer.addToCompletedMissions(m1_n1);
        });

        it("should return the incomplete missions in the specified neighborhood", function () {
            var missions = missionContainer.getIncompleteMissionsByRegionId(1);
            expect(missions.length).toBe(1);
        });
    });

    describe("`getNeighborhoodCompleteMission` method", function () {
        var m_100percent;
        beforeEach(function () {
            missionContainer.add(1, m1_n1);
            missionContainer.add(1, m2_n1);
            m_100percent = missionFactory.create(1, 100, "area-coverage-mission", 1, 1000, 1000, 1, 1.0, false);

            missionContainer.add(1, m_100percent);
        });

        it("should find the area-coverage-mission", function () {
            var m = missionContainer.getNeighborhoodCompleteMission(1);
            expect(m).toBe(m_100percent);
        });
    });

    describe("`nextMission` method", function () {
        beforeEach(function () {
            missionContainer.refresh();

            missionContainer.add(1, m1_n1);
            missionContainer.add(1, m2_n1);
            missionContainer.add(2, m1_n2);
            missionContainer.add(2, m2_n2);
        });

        it("should return the first mission of a neighborhood if no missions are completed", function () {
            var nextMission = missionContainer.nextMission(1);
            expect(nextMission).toEqual(m1_n1);
        });

        it("should return the second mission of a neighborhood if the first mission has been completed", function () {
            m1_n1.properties.isCompleted = true;
            missionContainer.addToCompletedMissions(m1_n1);

            var nextMission = missionContainer.nextMission(1);
            expect(nextMission).toEqual(m2_n1);
        });

        it("should return the first mission of the next neighborhood if no missions are available in the current neighborhood", function () {
            m1_n1.properties.isCompleted = true;
            m2_n1.properties.isCompleted = true;
            missionContainer.addToCompletedMissions(m1_n1);
            missionContainer.addToCompletedMissions(m2_n1);

            var nextMission = missionContainer.nextMission(1);
            expect(nextMission).toEqual(m1_n2);
        });

        describe("`TaskModel.tasksAreAvailableInARegion` in the method", function () {
            beforeEach(function () {
                spyOn(taskModel, 'tasksAreAvailableInARegion');
            });

            it("should check if the tasks are available in the neighborhood when assigning a new mission", function () {
                var nextMission = missionContainer.nextMission(1);
                expect(taskModel.tasksAreAvailableInARegion).toHaveBeenCalledWith(1);
            });
        });

        it("should return the first mission of the next neighborhood if no tasks are available in the current neighborhood", function () {
            taskModel.tasksAreAvailableInARegion = function (regionId) { return false; };
            var nextMission = missionContainer.nextMission(1);
            expect(nextMission).toEqual(m1_n2);
        });

    });

    describe("`refresh` method", function () {
        it("should reset `missionStoreByRegionId`", function () {
            missionContainer.refresh();
            expect(missionContainer._missionStoreByRegionId).toEqual({ "noRegionId" : [] })
        });
    });

    describe("`setCurrentMission` method", function () {
        beforeEach(function () {
            spyOn(statusFieldMission, 'setMessage');
        });

        it("should call StatusFieldMission.setMessage", function () {
            missionContainer.setCurrentMission(m1_n1);
            expect(statusFieldMission.setMessage).toHaveBeenCalled();
        });
    });



/*
    describe("`_onLoadComplete` method", function () {
        var m1, m2, m3;
        beforeEach(function () {
            m1 = new MissionMock();
            m1.properties.missionId = 1;
            m1.properties.coverage = 0.25;
            m1.properties.distance = 4023.36;
            m1.properties.label = 'distance-mission';

            m2 = new MissionMock();
            m2.properties.missionId = 2;
            m2.properties.coverage = 0.50;
            m2.properties.distance = 8046.72;
            m2.properties.label = 'distance-mission';

            m3 = new MissionMock();
            m3.properties.missionId = 3;
            m3.properties.coverage = 1.0;
            m3.properties.distance = 16093.4;
            m3.properties.label = 'coverage-mission';
        });
    });
    */

    function MissionMock () {
        this.properties = {
            coverage: null,
            distance: null,
            isCompleted: false,
            label: null,
            missionId: null
        };
    }

    MissionMock.prototype.getProperty = function (key) {
        return this.properties[key];
    };

    MissionMock.prototype.setProperty = function (key, value) {
        this.properties[key] = value;
    };

    MissionMock.prototype.isCompleted = function () {
        return this.properties.isCompleted;
    };

    function MissionFactoryMock () {
        this.create = function (regionId, missionId, label, level, distance, coverage, isCompleted) {
            var mission = new MissionMock();
            mission.properties.regionId = regionId;
            mission.properties.missionId = missionId;
            mission.properties.label = label;
            mission.properties.level = level;
            mission.properties.distance = distance;
            mission.properties.coverage = coverage;
            mission.properties.isCompleted = isCompleted;
            return mission;
        };
    }
});
