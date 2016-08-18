describe("StatusField module", function () {
    var statusField;
    var uiStatusField;
    var $statusFieldFixture;

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

        statusField = new StatusField(uiStatusField);
    });

    describe("`blink` method", function () {
        beforeEach(function () {
            spyOn(statusField, 'stopBlinking');
        });

        it("should call `stopBlinking` method", function () {
            statusField.blink();
            expect(statusField.stopBlinking).toHaveBeenCalled();
        });
    });

});