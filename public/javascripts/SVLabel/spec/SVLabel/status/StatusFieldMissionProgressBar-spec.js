describe("StatusFieldMissionProgressBar module", function () {
    var statusFieldMissionProgressBar;
    var uiStatusField;
    var $statusFieldFixture;
    var $completionRate;

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

        $completionRate = $statusFieldFixture.find("#status-current-mission-completion-rate");

        statusFieldMissionProgressBar = new StatusFieldMissionProgressBar(uiStatusField);
    });

    describe("`setCompletionRate` method", function () {
        it("should set the value of the div element", function () {
            statusFieldMissionProgressBar.setCompletionRate("0");
            expect($completionRate.text()).toBe("0% complete");

            statusFieldMissionProgressBar.setCompletionRate(0);
            expect($completionRate.text()).toBe("0% complete");

            statusFieldMissionProgressBar.setCompletionRate(1);
            expect($completionRate.text()).toBe("100% complete");

            statusFieldMissionProgressBar.setCompletionRate("1");
            expect($completionRate.text()).toBe("100% complete");

            statusFieldMissionProgressBar.setCompletionRate(0.51);
            expect($completionRate.text()).toBe("51% complete");


            statusFieldMissionProgressBar.setCompletionRate(0.51432423);
            expect($completionRate.text()).toBe("51% complete");
        });
    });

});