describe("ModalMissionComplete", function () {
    var modalMissionComplete;
    var uiModalMissionComplete;
    var $uiModalMissionCompleteFixture;
    var missionContainerMock;
    var modalMissionCompleteMapMock;
    var modalMissionCompleteBarMock;
    var taskContainerMock;
    var neighborhood;
    var mission;
    var statusModel;
    var modalModel;
    var onboardingModel;

    beforeEach(function () {
        $uiModalMissionCompleteFixture = $('<div id="modal-mission-complete-holder"> \
        <div id="modal-mission-complete-background" class="modal-background"></div> \
        <div id="modal-mission-complete-foreground" class="modal-foreground"> \
        <h1>Mission Complete! <span class="normal" id="modal-mission-complete-title"></span></h1> \
        <div class="row"> \
            <div class="mapbox col-sm-7"> \
                <div id="modal-mission-complete-map"></div> \
                <div id="map-legend"> \
                    <span><svg class="legend-label" width="15" height="10"><rect width="15" height="10" id="green-square"></svg> This Mission</span><br> \
                    <span><svg class="legend-label" width="15" height="10"><rect width="15" height="10" id="blue-square"></svg> Previous Missions</span> \
                </div> \
            </div> \
            <div class="col-sm-5"> \
                <p><span id="modal-mission-complete-message"></span></p> \
                <h3>Mission Labels</h3> \
                <table class="table"> \
                    <tr> \
                        <th class="width-50-percent">Curb Ramp</th> \
                        <td id="modal-mission-complete-curb-ramp-count" class="col-right"></td> \
                    </tr> \
                    <tr> \
                        <th>Missing Curb Ramp</th> \
                        <td id="modal-mission-complete-no-curb-ramp-count" class="col-right"></td> \
                    </tr> \
                    <tr> \
                        <th>Obstacle in Path</th> \
                        <td id="modal-mission-complete-obstacle-count" class="col-right"></td> \
                    </tr> \
                    <tr> \
                        <th>Surface Problem</th> \
                        <td id="modal-mission-complete-surface-problem-count" class="col-right"></td> \
                    </tr> \
                    <tr> \
                        <th>No Sidewalk</th>\
                        <td id="modal-mission-complete-no-sidewalk-count" class="col-right"></td></th>\
                    </tr>\
                    <tr> \
                        <th>Other</th> \
                        <td id="modal-mission-complete-other-count" class="col-right"></td> \
                    </tr> \
                </table> \
                <h3>Neighborhood Progress</h3> \
                <div id="modal-mission-complete-complete-bar"></div> \
                <table class="table"> \
                <tr> \
                    <th>Explored in this mission</th> \
                    <td id="modal-mission-complete-mission-distance" class="col-right"></td> \
                </tr> \
                <tr> \
                    <th>Explored in this neighborhood</th> \
                    <td id="modal-mission-complete-total-audited-distance" class="col-right"></td> \
                </tr> \
                <tr> \
                    <th>Remaining in this neighborhood</th> \
                    <td id="modal-mission-complete-remaining-distance" class="col-right"></td> \
                </tr> \
            </table> \
            <button class="btn btn-primary" id="modal-mission-complete-close-button-primary">Continue</button> \
            </div> \
        </div> \
        </div> \
        </div>');

        uiModalMissionComplete = {};
        uiModalMissionComplete.holder = $uiModalMissionCompleteFixture;
        uiModalMissionComplete.foreground = $uiModalMissionCompleteFixture.find("#modal-mission-complete-foreground");
        uiModalMissionComplete.background = $uiModalMissionCompleteFixture.find("#modal-mission-complete-background");
        uiModalMissionComplete.missionTitle = $uiModalMissionCompleteFixture.find("#modal-mission-complete-title");
        uiModalMissionComplete.message = $uiModalMissionCompleteFixture.find("#modal-mission-complete-message");
        uiModalMissionComplete.map = $uiModalMissionCompleteFixture.find("#modal-mission-complete-map");
        uiModalMissionComplete.completeBar = $uiModalMissionCompleteFixture.find("#modal-mission-complete-complete-bar");
        uiModalMissionComplete.closeButton = $uiModalMissionCompleteFixture.find("#modal-mission-complete-close-button");
        uiModalMissionComplete.totalAuditedDistance = $uiModalMissionCompleteFixture.find("#modal-mission-complete-total-audited-distance");
        uiModalMissionComplete.missionDistance = $uiModalMissionCompleteFixture.find("#modal-mission-complete-mission-distance");
        uiModalMissionComplete.remainingDistance = $uiModalMissionCompleteFixture.find("#modal-mission-complete-remaining-distance");
        uiModalMissionComplete.curbRampCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-curb-ramp-count");
        uiModalMissionComplete.noCurbRampCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-no-curb-ramp-count");
        uiModalMissionComplete.obstacleCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-obstacle-count");
        uiModalMissionComplete.surfaceProblemCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-surface-problem-count");
        uiModalMissionComplete.noSidewalkCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-no-sidewalk-count");
        uiModalMissionComplete.otherCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-other-count");
        this.uiModalMissionComplete = uiModalMissionComplete;


        modalModel = _.clone(Backbone.Events);
        modalModel.triggerMissionCompleteClosed = function () {
            this.trigger("ModalMissionComplete:closed");
        };

        statusModel = _.clone(Backbone.Events);
        statusModel.setProgressBar = function (completionRate) {
            this.trigger("StatusFieldMissionProgressBar:setBar", completionRate);
        };
        statusModel.setMissionCompletionRate = function (completionRate) {
            this.trigger("StatusFieldMissionProgressBar:setCompletionRate", completionRate);
        };
        onboardingModel = _.clone(Backbone.Events);

        modalMissionCompleteBarMock = {
            update: function () {}
        };

        modalMissionCompleteMapMock = {
            hide: function () {},
            show: function () {},
            update: function () {},
            updateStreetSegments: function (a, b) {}
        };
        taskContainerMock = new TaskContainerMock();
        missionContainerMock = new MissionContainerMock();
        modalMissionComplete = new ModalMissionComplete( {}, missionContainerMock, taskContainerMock,
            modalMissionCompleteMapMock, modalMissionCompleteBarMock, uiModalMissionComplete,
            modalModel, statusModel, onboardingModel);

        mission = new MissionMock();
        mission.properties.distance = 1219.2;
        mission.properties.coverage = 0.07575;
        mission.properties.label = "distance-mission";
        neighborhood = new NeighborhoodMock();
        neighborhood.properties.name = "Test Neighborhood";

    });

    describe("`show` method", function () {
        it("should show a modal window", function () {
            modalMissionComplete.show(mission, neighborhood);
            expect(uiModalMissionComplete.holder.css('visibility')).toBe('visible');
            expect(uiModalMissionComplete.foreground.css('visibility')).toBe('visible');
            expect(uiModalMissionComplete.background.css('visibility')).toBe('visible');
        });
    });

    describe("`hide` method", function (){
        beforeEach(function () {
            spyOn(statusModel, 'setProgressBar');
            spyOn(statusModel, 'setMissionCompletionRate');
        });

        it("should hide a modal window", function () {
            modalMissionComplete.hide();
            expect(uiModalMissionComplete.holder.css('visibility')).toBe('hidden');
            expect(uiModalMissionComplete.foreground.css('visibility')).toBe('hidden');
            expect(uiModalMissionComplete.background.css('visibility')).toBe('hidden');
        });

        it("should call `StatusModel.setProgressBar` to clear the progress bar in the status field", function () {
            // KH: Should the hide responsible for clearing the progress bar?
            modalMissionComplete.hide();
            expect(statusModel.setProgressBar).toHaveBeenCalledWith(0);
        });

        it("should call `StatusModel.setMissionCompletionRate` to set the completion rate to 0%", function () {
            modalMissionComplete.hide();
            expect(statusModel.setMissionCompletionRate).toHaveBeenCalledWith(0);
        });
    });

    describe("`_updateMissionProgressStatistics` method", function () {
        it("should set the distance traveled in the current mission", function () {
            modalMissionComplete._updateMissionProgressStatistics(0.38, 0.76, 9.24, "miles");
            expect(uiModalMissionComplete.missionDistance.text()).toBe("0.4 miles");
        });

        it("should set the cumulative distance traveled in the current neighborhood", function () {
            modalMissionComplete._updateMissionProgressStatistics(0.38, 0.76, 9.24, "miles");
            expect(uiModalMissionComplete.totalAuditedDistance.text()).toBe("0.8 miles");
        });

        it("should set the remaining distance to audit in the current neighborhood", function () {
            modalMissionComplete._updateMissionProgressStatistics(0.38, 0.76, 9.24, "miles");
            expect(uiModalMissionComplete.remainingDistance.text()).toBe("9.2 miles");

            modalMissionComplete._updateMissionProgressStatistics(1.1, 10.1, -0.1, "miles");
            expect(uiModalMissionComplete.remainingDistance.text()).toBe("0.0 miles");
        });
    });

    describe("setMissionTitle method", function () {
        it("should change the text in the title html", function(){
            expect(uiModalMissionComplete.missionTitle.html()).toBe('');
            modalMissionComplete.setMissionTitle("Test Title");
            expect(uiModalMissionComplete.missionTitle.html()).toBe("Test Title");
            });
    });

    describe("_updateMissionLabelStatisitcs method ", function(){
        it("label counts should be empty initially", function(){
            modalMissionComplete.show();
            expect(uiModalMissionComplete.curbRampCount.html()).toBe('');
            expect(uiModalMissionComplete.noCurbRampCount.html()).toBe('');
            expect(uiModalMissionComplete.obstacleCount.html()).toBe('');
            expect(uiModalMissionComplete.surfaceProblemCount.html()).toBe('');
            expect(uiModalMissionComplete.otherCount.html()).toBe('');
            modalMissionComplete.hide();
        });

        it("should populate label counts", function () {
            var labelCounts = {
                "CurbRamp": '10',
                "NoCurbRamp": '3',
                "Obstacle": '1',
                "SurfaceProblem": '4',
                "Other": '2'
            };
            modalMissionComplete.show();
            // label counts when set explicitly
            modalMissionComplete._updateMissionLabelStatistics(labelCounts.CurbRamp, labelCounts.NoCurbRamp, labelCounts.Obstacle, labelCounts.SurfaceProblem, labelCounts.Other);
            expect(uiModalMissionComplete.curbRampCount.html()).toBe('10');
            expect(uiModalMissionComplete.noCurbRampCount.html()).toBe('3');
            expect(uiModalMissionComplete.obstacleCount.html()).toBe('1');
            expect(uiModalMissionComplete.surfaceProblemCount.html()).toBe('4');
            expect(uiModalMissionComplete.otherCount.html()).toBe('2');
            modalMissionComplete.hide();
        });   
    });

    describe("update method", function (){
        beforeEach( function () {
            modalMissionComplete.show();
            neighborhood.properties.completedLineDistance = 0;
            neighborhood.properties.totalLineDistance = 0;
        });

        afterEach( function () {
            modalMissionComplete.hide();
        });

        it("should update mission distance statistics", function () {
            neighborhood.properties.completedLineDistance = 0.3;
            neighborhood.properties.totalLineDistance = 0.7;
            modalMissionComplete.update(mission, neighborhood);
            expect(uiModalMissionComplete.missionDistance.html()).toBe('0.1 miles');
            expect(uiModalMissionComplete.totalAuditedDistance.html()).toBe('0.3 miles');
            expect(uiModalMissionComplete.remainingDistance.html()).toBe('0.4 miles');
        });

        it("should update label counts", function () {
            modalMissionComplete.update(mission, neighborhood);
            expect(uiModalMissionComplete.curbRampCount.html()).toBe('0');
            expect(uiModalMissionComplete.noCurbRampCount.html()).toBe('0');
            expect(uiModalMissionComplete.obstacleCount.html()).toBe('0');
            expect(uiModalMissionComplete.surfaceProblemCount.html()).toBe('0');
            expect(uiModalMissionComplete.otherCount.html()).toBe('0');

            mission.properties.labelCount = {
                "CurbRamp": '10',
                "NoCurbRamp": '3',
                "Obstacle": '1',
                "SurfaceProblem": '4',
                "Other": '2'
            };
            modalMissionComplete.update(mission, neighborhood);
            expect(uiModalMissionComplete.curbRampCount.html()).toBe('10');
            expect(uiModalMissionComplete.noCurbRampCount.html()).toBe('3');
            expect(uiModalMissionComplete.obstacleCount.html()).toBe('1');
            expect(uiModalMissionComplete.surfaceProblemCount.html()).toBe('4');
            expect(uiModalMissionComplete.otherCount.html()).toBe('2');
        });

        it("should set the mission title", function () {
            modalMissionComplete.update(mission, neighborhood);
            expect(uiModalMissionComplete.missionTitle.html()).toBe('Test Neighborhood');
        });
    });

    describe("In response to the `Onboarding:startOnboarding` event", function () {
        it("should call the `hide` method", function () {
            spyOn(modalMissionComplete, 'hide');
            onboardingModel.trigger("Onboarding:startOnboarding");
            expect(modalMissionComplete.hide).toHaveBeenCalled();
        });
    });

    // Mocks
    function MissionMock () {
        this.properties = {
            coverage: null,
            label: null,
            distance: null,
            route: [],
            labelCount: null
        };
    }

    MissionMock.prototype.getProperty = function (key) {
        return this.properties[key];
    };

    MissionMock.prototype.getRoute = function () {
        return this.properties.route;
    };

    MissionMock.prototype.getLabelCount = function () {
        return this.properties.labelCount;
    };

    function NeighborhoodMock() {
        this.properties = {
            name: null,
            regionId: null,
            completedLineDistance: null,
            totalLineDistance: null
        };
    }

    NeighborhoodMock.prototype.getProperty = function (key) {
        return this.properties[key];
    };

    NeighborhoodMock.prototype.completedLineDistance = function (units) {
        return this.properties.completedLineDistance;
    };

    NeighborhoodMock.prototype.totalLineDistance = function (units) {
        return this.properties.totalLineDistance;
    };

    function TaskContainerMock(){
        this.properties = {
            completedTasks: [],
            totalLineDistanceInARegion: null
        };
    }

    TaskContainerMock.prototype.getCompletedTasks = function () {
        return this.properties.completedTasks;
    };

    TaskContainerMock.prototype.totalLineDistanceInARegion = function (regionId, units) {
        return this.properties.totalLineDistanceInARegion;
    };

    function MissionContainerMock(){
        this.properties = {
            completedMissions: []
        };
    }

    MissionContainerMock.prototype.getCompletedMissions = function (){
        return this.properties.completedMissions;
    };
});

