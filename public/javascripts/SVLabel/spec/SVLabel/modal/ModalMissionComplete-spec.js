describe("ModalMissionComplete", function () {
    var modal;
    var uiModalMissionComplete;
    var $uiModalMissionCompleteFixture;
    var missionContainerMock;
    var modalMissionCompleteMapMock;
    var neighborhood;
    var mission;

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

        modalMissionCompleteMapMock = {
            hide: function () {},
            show: function () {}
        };
        modal = new ModalMissionComplete($, d3, L, missionContainerMock, modalMissionCompleteMapMock, uiModalMissionComplete, Backbone.Events);

        mission = new MissionMock();
        mission.properties.distanceMi = 0.7575;
        mission.properties.distance = 1219.2;
        mission.properties.distanceFt = 4000;
        mission.properties.coverage = 0.07575;
        mission.properties.auditDistanceFt = 2000;
        mission.properties.auditDistanceMi = 0.3788;
        mission.properties.auditDistance = 609;
        mission.properties.label = "distance-mission";
        neighborhood = new NeighborhoodMock();
        neighborhood.properties.name = "Test Neighborhood";
    });

    describe("`show` method", function () {
        it("should open a modal window", function () {
            modal.hide();
            expect(uiModalMissionComplete.holder.css('visibility')).toBe('hidden');
            expect(uiModalMissionComplete.foreground.css('visibility')).toBe('hidden');
            expect(uiModalMissionComplete.background.css('visibility')).toBe('hidden');

            modal.show(mission, neighborhood);
            expect(uiModalMissionComplete.holder.css('visibility')).toBe('visible');
            expect(uiModalMissionComplete.foreground.css('visibility')).toBe('visible');
            expect(uiModalMissionComplete.background.css('visibility')).toBe('visible');
        });
    });

    describe("`_updateMissionProgressStatistics` method", function () {
        it("should set the distance traveled in the current mission", function () {
            modal._updateMissionProgressStatistics(0.38, 0.76, 9.24, "miles");
            expect(uiModalMissionComplete.missionDistance.text()).toBe("0.4 miles");
        });

        it("should set the cumulative distance traveled in the current neighborhood", function () {
            modal._updateMissionProgressStatistics(0.38, 0.76, 9.24, "miles");
            expect(uiModalMissionComplete.totalAuditedDistance.text()).toBe("0.8 miles");
        });

        it("should set the remaining distance to audit in the current neighborhodo", function () {
            modal._updateMissionProgressStatistics(0.38, 0.76, 9.24, "miles");
            expect(uiModalMissionComplete.remainingDistance.text()).toBe("9.2 miles");

            modal._updateMissionProgressStatistics(1.1, 10.1, -0.1, "miles");
            expect(uiModalMissionComplete.remainingDistance.text()).toBe("0.0 miles");
        });
    });

    describe("clicking the 'Continue' button", function () {
        it("should open the modal window for the next mission", function (done) {
            done();
        });
    });
});
