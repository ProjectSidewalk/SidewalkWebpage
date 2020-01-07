describe("StatusFieldMission module", function () {
    var modalModel;
    var statusFieldMission;
    var $statusFieldFixture;
    var $missionMessage;
    var uiStatusField;
    var mission1, mission2, mission3, mission4;

    beforeEach(function () {
        $statusFieldFixture = $('      <div id="status-holder">  \
                                    <div class="status-box"> \
                                        <h1 class="status-holder-header-1">Current Neighborhood</h1> \
                                        <h2><span id="status-holder-neighborhood-name" style="display: inline;"></span>D.C.</h2> \
                                        <div class="status-row"> \
                                            <span class="status-column-half"> \
                                                <img src="" class="status-icon" alt="Map icon" align=""> \
                                                <span>\
                                                    <span class="bold" id="status-audited-distance">0.00</span>\
                                                    <small>miles</small>\
                                                </span> \
                                            </span> \
                                            <span class="status-column-half"> \
                                                <img src="" class="status-icon" alt="Total label count" align=""> \
                                                <span>\
                                                    <span class="bold" id="status-neighborhood-label-count">0</span>\
                                                    <small>labels</small>\
                                                </span> \
                                            </span> \
                                        </div> \
                                    </div> \
                                    <div class="status-box"> \
                                        <h1>Current Mission</h1> \
                                        <h2 id="current-mission-description">Let\'s make this neighborhood accessible</h2> \
                                        <div id="status-current-mission-completion-bar"> \
                                            <div id="status-current-mission-completion-bar-filler"> \
                                                <div id="status-current-mission-completion-rate"></div> \
                                            </div> \
                                        </div> \
                                        <br class="clear"> \
                                    </div> \
                                    <div class="status-box"> \
                                        <div id="label-counter"></div> \
                                    </div> \
                                </div>');
        uiStatusField = {};
        uiStatusField.holder = $statusFieldFixture;

        $missionMessage = $statusFieldFixture.find("#current-mission-description");

        modalModel = _.clone(Backbone.Events);
        modalModel.triggerMissionCompleteClosed = function (parameters) {
            this.trigger("ModalMissionComplete:closed", parameters);
        };

        statusFieldMission = new StatusFieldMission(modalModel, uiStatusField);

        mission1 = new MissionMock();
        mission1.properties.label = "distance-mission";
        mission1.properties.distance = 304.8;

        mission2 = new MissionMock();
        mission2.properties.label = "distance-mission";
        mission2.properties.distance = 609.6;


        mission3 = new MissionMock();
        mission3.properties.label = "distance-mission";
        mission3.properties.distance = 1219.2;

        mission4 = new MissionMock();
        mission4.properties.label = "distance-mission";
        mission4.properties.distance = 1609.344;
    });

    describe("`setMessage` method", function () {
        it("should set the mission instruction", function () {
            statusFieldMission.setMessage(mission1);
            expect($missionMessage.text()).toBe("Explore 1000ft of this neighborhood");

            statusFieldMission.setMessage(mission2);
            expect($missionMessage.text()).toBe("Explore 1000ft of this neighborhood");

            statusFieldMission.setMessage(mission3);
            expect($missionMessage.text()).toBe("Explore ½mi of this neighborhood");

            statusFieldMission.setMessage(mission4);
            expect($missionMessage.text()).toBe("Explore ¼mi of this neighborhood");
        });
    });

    describe("`ModalMissionComplete:closed` event", function () {
        var mission;
        beforeEach(function () {
            spyOn(statusFieldMission, 'setMessage');
            mission = new MissionMock();
            modalModel.triggerMissionCompleteClosed({ nextMission: mission });
        });

        it("should call the `setMessage` method", function () {
            expect(statusFieldMission.setMessage).toHaveBeenCalled();

            expect(statusFieldMission.setMessage).toHaveBeenCalledWith(mission);
        });
    });


    function MissionMock () {
        this.properties = {
            coverage: null,
            distance: null,
            isComplete: false,
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

    MissionMock.prototype.isComplete = function () {
        return this.properties.isComplete;
    };
});