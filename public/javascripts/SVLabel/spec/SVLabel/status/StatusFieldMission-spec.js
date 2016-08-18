describe("StatusFieldMission module", function () {
    var modalModel;
    var statusFieldMission;
    var $statusFieldFixture;
    var $missionMessage;
    var uiStatusField;

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
    });

    describe("`setMessage` method", function () {
        var mission;

        beforeEach(function () {
            mission = new MissionMock();
            mission.properties.label = "distance-mission";
        });

        it("should set the description", function () {
            statusFieldMission.setMessage(mission);

            expect($missionMessage.text()).toBe("Audit 1000ft of this neighborhood.");
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
            auditDistance: null,
            auditDistanceFt: null,
            auditDistanceMi: null,
            coverrage: null,
            distance: null,
            distanceFt: null,
            distanceMi: null,
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
});