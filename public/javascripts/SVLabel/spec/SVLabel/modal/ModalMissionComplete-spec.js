describe("ModalMissionComplete", function () {
    var modal;
    var uiModalMissionComplete;
    var $uiModalMissionCompleteFixture;

    // Mocks
    function MissionMock () {
        this.properties = {
            coverage: null,
            label: null,
            distance: null,
            distanceFt: null,
            distanceMi: null
        };
    }
    MissionMock.prototype.getProperty = function (key) {
        return this.properties[key];
    };

    function NeighborhoodMock() {
        this.properties = {
            name: null,
            regionId: null
        };
    }
    NeighborhoodMock.prototype.getProperty = function (key) {
        return this.properties[key];
    };

    beforeEach(function () {
        $uiModalMissionCompleteFixture = $('    <div id="modal-mission-complete-holder"> \
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
                                                                        <th>Other</th> \
                                                                        <td id="modal-mission-complete-other-count" class="col-right"></td> \
                                                                    </tr> \
                                                                </table> \
                                                                <h3>Neighborhood Progress</h3> \
                                                                <div id="modal-mission-complete-complete-bar"></div> \
                                                                <table class="table"> \
                                                                <tr> \
                                                                    <th>Audited in this mission</th> \
                                                                    <td id="modal-mission-complete-mission-distance" class="col-right"></td> \
                                                                </tr> \
                                                                <tr> \
                                                                    <th>Audited in this neighborhood</th> \
                                                                    <td id="modal-mission-complete-total-audited-distance" class="col-right"></td> \
                                                                </tr> \
                                                                <tr> \
                                                                    <th>Remaining in this neighborhood</th> \
                                                                    <td id="modal-mission-complete-remaining-distance" class="col-right"></td> \
                                                                </tr> \
                                                            </table> \
                                                            <button class="btn blue-btn" id="modal-mission-complete-close-button">Continue</button> \
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
        uiModalMissionComplete.closeButton = $uiModalMissionCompleteFixture.find("#modal-mission-complete-close-button");
        uiModalMissionComplete.totalAuditedDistance = $uiModalMissionCompleteFixture.find("#modal-mission-complete-total-audited-distance");
        uiModalMissionComplete.missionDistance = $uiModalMissionCompleteFixture.find("#modal-mission-complete-mission-distance");
        uiModalMissionComplete.remainingDistance = $uiModalMissionCompleteFixture.find("#modal-mission-complete-remaining-distance");
        uiModalMissionComplete.curbRampCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-curb-ramp-count");
        uiModalMissionComplete.noCurbRampCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-no-curb-ramp-count");
        uiModalMissionComplete.obstacleCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-obstacle-count");
        uiModalMissionComplete.surfaceProblemCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-surface-problem-count");
        uiModalMissionComplete.otherCount = $uiModalMissionCompleteFixture.find("#modal-mission-complete-other-count");

        modal = new ModalMissionComplete($, d3, L, uiModalMissionComplete);
    });

    describe("`show` method", function () {
        it("should open a modal window", function () {
            modal.hide();
            expect(uiModalMission.holder.css('visibility')).toBe('hidden');
            expect(uiModalMission.foreground.css('visibility')).toBe('hidden');
            expect(uiModalMission.background.css('visibility')).toBe('hidden');

            modal.show();
            expect(uiModalMission.holder.css('visibility')).toBe('visible');
            expect(uiModalMission.foreground.css('visibility')).toBe('visible');
            expect(uiModalMission.background.css('visibility')).toBe('visible');
        });
    });

    describe("`setMission` method", function () {
        var mission_4000ft,
            mission_1mi,
            mission_2mi,
            neighborhood;

        beforeEach(function () {
            neighborhood = new NeighborhoodMock();
            neighborhood.properties.name = "Test Neighborhood";


            mission_4000ft = new MissionMock();
            mission_4000ft.properties.distanceMi = 0.7575;
            mission_4000ft.properties.distance = 1219.2;
            mission_4000ft.properties.distanceFt = 4000;
            mission_4000ft.properties.coverage = 0.07575;
            mission_4000ft.properties.auditDistanceFt = 2000;
            mission_4000ft.properties.auditDistanceMi = 0.3788;
            mission_4000ft.properties.auditDistance = 609;
            mission_4000ft.properties.label = "distance-mission";

            mission_1mi = new MissionMock();
            mission_1mi.properties.distanceMi = 1;
            mission_1mi.properties.distance = 1600;
            mission_1mi.properties.distanceFt = 5280;
            mission_1mi.properties.coverage = 0.1;
            mission_1mi.properties.auditDistanceFt = 1280;
            mission_1mi.properties.auditDistanceMi = 0.2424;
            mission_1mi.properties.auditDistance = 390;
            mission_1mi.properties.label = "distance-mission";

            mission_2mi = new MissionMock();
            mission_2mi.properties.distanceMi = 2;
            mission_2mi.properties.distance = 3200;
            mission_2mi.properties.distanceFt = 105600;
            mission_2mi.properties.coverage = 0.2;
            mission_2mi.properties.auditDistanceFt = 2640;
            mission_2mi.properties.auditDistanceMi = 0.5;
            mission_2mi.properties.auditDistance = 804.7;
            mission_2mi.properties.label = "distance-mission";
        });

        it("should set the title", function () {
            modal.setMission(mission_4000ft, neighborhood, null, null);
            expect(uiModalMission.missionTitle.text()).toBe("Audit ½mi of Test Neighborhood");

            modal.setMission(mission_1mi, neighborhood, null, null);
            expect(uiModalMission.missionTitle.text()).toBe("Audit ¼mi of Test Neighborhood");

            modal.setMission(mission_2mi, neighborhood, null, null);
            expect(uiModalMission.missionTitle.text()).toBe("Audit ½mi of Test Neighborhood");
        });

        it("should set the body text", function () {
            modal.setMission(mission_4000ft, neighborhood, null, null);
            expect(uiModalMission.instruction.text().trim()).toBe("Your mission is to audit ½mi of Test Neighborhood and find all the accessibility features that affect mobility impaired travelers!");

            modal.setMission(mission_1mi, neighborhood, null, null);
            expect(uiModalMission.instruction.text().trim()).toBe("Your mission is to audit ¼mi of Test Neighborhood and find all the accessibility features that affect mobility impaired travelers!");

            modal.setMission(mission_2mi, neighborhood, null, null);
            expect(uiModalMission.instruction.text().trim()).toBe("Your mission is to audit ½mi of Test Neighborhood and find all the accessibility features that affect mobility impaired travelers!");

        })
    });

});
