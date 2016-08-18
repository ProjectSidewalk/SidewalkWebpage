describe("StatusFieldMission module", function () {
    var statusModel;
    var statusFieldMission;
    var $statusFieldFixture;
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

        statusModel = _.clone(Backbone.Events);
        statusFieldMission = new StatusFieldMission(statusModel, uiStatusField);
    });

    describe("`ModalMissionComplete:close` event", function () {
        it("should update the text for the mission", function () {

        });
    });
});