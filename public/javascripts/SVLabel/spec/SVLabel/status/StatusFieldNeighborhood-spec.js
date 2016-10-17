describe("StatusFieldNeighborhood module", function () {
    var statusFieldNeighborhood;
    var neighborhoodModel;
    var statusModel;
    var userModel;
    var uiStatus;
    var $uiStatus;


    describe("when the user is logged in", function () {
        beforeEach(function () {
            $uiStatus = prepareFixtureWithAUser();
            uiStatus = {};
            uiStatus.holder = $uiStatus;
            uiStatus.neighborhoodName = $uiStatus.find("#status-holder-neighborhood-name");
            uiStatus.neighborhoodLink = $uiStatus.find("#status-neighborhood-link");
            uiStatus.neighborhoodLabelCount = $uiStatus.find("#status-neighborhood-label-count");
            uiStatus.currentMissionDescription = $uiStatus.find("#current-mission-description");
            uiStatus.auditedDistance = $uiStatus.find("#status-audited-distance");

            statusModel = _.clone(Backbone.Events);
            statusModel.setNeighborhoodHref = function (href) {
                this.trigger("StatusFieldNeighborhood:setHref", href);
            };
            neighborhoodModel = _.clone(Backbone.Events);
            userModel = _.clone(Backbone.Events);

            statusFieldNeighborhood = new StatusFieldNeighborhood(neighborhoodModel, statusModel, userModel, uiStatus);
        });

        describe("`setAuditedDistance` method", function () {
            it("should set the distance audited", function () {
                statusFieldNeighborhood.setAuditedDistance(1);
                expect(uiStatus.auditedDistance.text()).toBe("1");
            });

        });

        describe("`setLabelCount` method", function () {
            it("should set the label count", function () {
                statusFieldNeighborhood.setLabelCount(10);
                expect(uiStatus.neighborhoodLabelCount.text()).toBe("10");
            });
        });

        describe('`setHref` method', function () {
            it("should set the href", function () {
                statusFieldNeighborhood.setHref("/test");
                expect(uiStatus.neighborhoodLink.attr("href")).toBe("/test");
            });
        });

        describe("`setNeighborhoodName` method", function () {
            it("should set the neighborhood name", function () {
                statusFieldNeighborhood.setNeighborhoodName("Test");
                expect(uiStatus.neighborhoodName.text()).toBe("Test, ");
            });
        });

        describe("triggering `StatusFieldNeighborhood:setHref` event", function () {
            beforeEach(function () {
                spyOn(statusFieldNeighborhood, 'setHref');
            });

            it("should call setHref", function () {
                var href = "/test";
                statusModel.setNeighborhoodHref(href);
                expect(statusFieldNeighborhood.setHref).toHaveBeenCalledWith(href);
            });
        })
    });


    function prepareFixtureWithAUser () {
        return $('<div id="status-holder"> \
                    <div class="status-box"> \
                        <h1 class="status-holder-header-1">Current Neighborhood</h1> \
                        <a href="" target="_blank" id="status-neighborhood-link"> \
                            <h2><span id="status-holder-neighborhood-name"></span>D.C.</h2> \
                        </a> \
                        <div class="status-row"> \
                            <span class="status-column-half"> \
                                <img src="" class="status-icon" alt="Map icon" align=""> \
                                <span><span class="bold" id="status-audited-distance">0.00</span> <small>miles</small></span> \
                            </span> \
                            <span class="status-column-half"> \
                            <img src="" class="status-icon" alt="Total label count" align=""> \
                            <span><span class="bold" id="status-neighborhood-label-count">0</span> <small>labels</small></span> \
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
    }

    function prepareFixtureWithoutAUser () {
        return $('<div id="status-holder"> \
                    <div class="status-box"> \
                        <h1 class="status-holder-header-1">Current Neighborhood</h1> \
                        <h2><span id="status-holder-neighborhood-name"></span>D.C.</h2> \
                        <div class="status-row"> \
                            <span class="status-column-half"> \
                                <img src="" class="status-icon" alt="Map icon" align=""> \
                                <span><span class="bold" id="status-audited-distance">0.00</span> <small>miles</small></span> \
                            </span> \
                            <span class="status-column-half"> \
                            <img src="" class="status-icon" alt="Total label count" align=""> \
                            <span><span class="bold" id="status-neighborhood-label-count">0</span> <small>labels</small></span> \
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
                </div>')
    }
});