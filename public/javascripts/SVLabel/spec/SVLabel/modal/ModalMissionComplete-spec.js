describe("ModalMissionComplete", function () {
    var modal;
    var uiModalMission;
    var $uiModalMissionFixture;

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
        $uiModalMissionFixture = $(' <div id="modal-mission-holder"> \
                                        <div id="modal-mission-background" class="modal-background"></div> \
                                        <div id="modal-mission-foreground" class="modal-foreground"> \
                                            <h1 id="modal-mission-header">Mission</h1> \
                                            <div id="modal-mission-instruction"></div> \
                                            <button class="button" id="modal-mission-close-button">OK</button> \
                                        </div> \
                                    </div>');
        uiModalMission = {};
        uiModalMission.holder = $uiModalMissionFixture;
        uiModalMission.foreground = uiModalMission.holder.find("#modal-mission-foreground");
        uiModalMission.background = uiModalMission.holder.find("#modal-mission-background");
        uiModalMission.missionTitle = uiModalMission.holder.find("#modal-mission-header");
        uiModalMission.instruction = uiModalMission.holder.find("#modal-mission-instruction");
        uiModalMission.closeButton = uiModalMission.holder.find("#modal-mission-close-button");

        modal = ModalMission($, uiModalMission);
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
