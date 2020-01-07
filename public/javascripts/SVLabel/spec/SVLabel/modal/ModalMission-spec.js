describe("ModalMission", function () {
    var modalMission;
    var uiModalMission;
    var $uiModalMissionFixture;
    var modalModel;
    var onboardingModel;

    beforeEach(function () {
        $uiModalMissionFixture = $('<div id="modal-mission-holder"> \
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

        var missionContainer = new MissionContainerMock();
        var neighborhoodContainer = new NeighborhoodContainerMock();
        modalModel = _.clone(Backbone.Events);
        onboardingModel = _.clone(Backbone.Events);
        modalMission = new ModalMission(missionContainer, neighborhoodContainer, uiModalMission, modalModel, onboardingModel);
    });

    describe("`_handleBackgroundClick` method", function () {
        beforeEach(function () {
            spyOn(modalMission, 'hide');
        });

        it("should trigger the `hide` method", function () {
            modalMission._handleBackgroundClick();
            expect(modalMission.hide).toHaveBeenCalled();
        });
    });

    describe("`_handleCloseButtonClick` method", function () {
        beforeEach(function () {
            spyOn(modalMission, 'hide');
        });

        it("should trigger the `hide` method", function () {
            modalMission._handleCloseButtonClick();
            expect(modalMission.hide).toHaveBeenCalled();
        });
    });

    describe("`isOpen` method", function () {
        it("should check if the modal window is open", function () {
            modalMission._status.isOpen = false;
            expect(modalMission.isOpen()).toBe(false);
            modalMission._status.isOpen = true;
            expect(modalMission.isOpen()).toBe(true);
        });
    });

    describe("`hide` method", function () {
        beforeEach(function () {
            modalMission.show();
        });

        it("should set `isOpen` to false", function () {
            modalMission.hide();
            expect(modalMission._status.isOpen).toBe(false);
        });
        it("should set visibility of DOM elements to hidden", function () {
            modalMission.hide();
            expect(uiModalMission.holder.css('visibility')).toBe('hidden');
            expect(uiModalMission.foreground.css('visibility')).toBe('hidden');
            expect(uiModalMission.background.css('visibility')).toBe('hidden');
        });
    });

    describe("`setMissionMessage` method", function () {
        var mission_4000ft,
            mission_1mi,
            mission_2mi,
            neighborhood;

        beforeEach(function () {
            neighborhood = new NeighborhoodMock();
            neighborhood.properties.name = "Test Neighborhood";

            mission_4000ft = new MissionMock();
            mission_4000ft.properties.distance = 1219.2;
            mission_4000ft.properties.coverage = 0.07575;
            mission_4000ft.properties.label = "distance-mission";

            mission_1mi = new MissionMock();
            mission_1mi.properties.distance = 1600;
            mission_1mi.properties.coverage = 0.1;
            mission_1mi.properties.label = "distance-mission";

            mission_2mi = new MissionMock();
            mission_2mi.properties.distance = 3200;
            mission_2mi.properties.coverage = 0.2;
            mission_2mi.properties.label = "distance-mission";
        });

        it("should set the title", function () {
            modalMission.setMissionMessage(mission_4000ft, neighborhood, null, null);
            expect(uiModalMission.missionTitle.text()).toBe("Explore ½mi of Test Neighborhood");

            modalMission.setMissionMessage(mission_1mi, neighborhood, null, null);
            expect(uiModalMission.missionTitle.text()).toBe("Explore ¼mi of Test Neighborhood");

            modalMission.setMissionMessage(mission_2mi, neighborhood, null, null);
            expect(uiModalMission.missionTitle.text()).toBe("Explore ½mi of Test Neighborhood");
        });

        it("should set the body text", function () {
            modalMission.setMissionMessage(mission_4000ft, neighborhood, null, null);
            expect(uiModalMission.instruction.text().trim()).toBe("Your mission is to explore ½mi of Test Neighborhood and find all the accessibility features that affect mobility impaired travelers!");

            modalMission.setMissionMessage(mission_1mi, neighborhood, null, null);
            expect(uiModalMission.instruction.text().trim()).toBe("Your mission is to explore ¼mi of Test Neighborhood and find all the accessibility features that affect mobility impaired travelers!");

            modalMission.setMissionMessage(mission_2mi, neighborhood, null, null);
            expect(uiModalMission.instruction.text().trim()).toBe("Your mission is to explore ½mi of Test Neighborhood and find all the accessibility features that affect mobility impaired travelers!");
        })
    });

    describe("`show` method", function () {
        it("should open a modal window", function () {
            modalMission.hide();
            expect(uiModalMission.holder.css('visibility')).toBe('hidden');
            expect(uiModalMission.foreground.css('visibility')).toBe('hidden');
            expect(uiModalMission.background.css('visibility')).toBe('hidden');

            modalMission.show();
            expect(uiModalMission.holder.css('visibility')).toBe('visible');
            expect(uiModalMission.foreground.css('visibility')).toBe('visible');
            expect(uiModalMission.background.css('visibility')).toBe('visible');
        });
    });

    describe("Event trigger", function () {
        describe("`ModalMission:setMissionMessage`", function () {
            beforeEach(function () {
                var parameters = {};
                parameters.mission = new MissionMock();
                parameters.neighborhood = {};
                parameters.parameters = {};
                parameters.callback = function () {};
                modalModel.trigger("ModalMission:setMissionMessage", parameters);
            });

            it("should open the modal window", function (done) {
                expect(modalMission.isOpen()).toBe(true);
                done();
            });
        });

        describe("`ModalMissionComplete:closed`", function () {
            beforeEach(function () {
                modalModel.trigger("ModalMissionComplete:closed");
            });

            it ("should open the modal window", function (done) {
                expect(modalMission.isOpen()).toBe(true);
                done();
            });

        });
    });

    describe("In response to the `Onboarding:startOnboarding` event", function () {
        it("should call the `hide` method", function () {
            spyOn(modalMission, 'hide');
            onboardingModel.trigger("Onboarding:startOnboarding");
            expect(modalMission.hide).toHaveBeenCalled();
        });
    });

    // Mocks
    function MissionMock () {
        this.properties = {
            coverage: null,
            label: null,
            distance: null
        };
    }
    MissionMock.prototype.getProperty = function (key) {
        return this.properties[key];
    };

    function MissionContainerMock() {
        this.getCurrentMission = function () { return new MissionMock(); }
    }

    function NeighborhoodMock() {
        this.properties = {
            name: null,
            regionId: null
        };
    }

    NeighborhoodMock.prototype.getProperty = function (key) {
        return this.properties[key];
    };

    function NeighborhoodContainerMock () {
        this.getCurrentNeighborhood = function () { return new NeighborhoodMock(); };
    }
});
