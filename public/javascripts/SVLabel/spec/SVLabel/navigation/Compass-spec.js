describe("Compass module", function () {
    var compass;
    var $compassFixture;
    var svl;
    var taskContainerMock;
    var mapServiceMock;
    var uiCompass;

    beforeEach(function () {
        $compassFixture = $('   <div id="compass-holder" class=""> \
                                    <div id="compass-message-holder" class="animated white-background-75"> \
                                        <span id="compass-message"></span> \
                                        <div id="compass-message-connector"></div> \
                                    </div> \
                                </div>');

        uiCompass = {};
        uiCompass.messageHolder = $compassFixture.find("#compass-message-holder");
        uiCompass.message = $compassFixture.find("#compass-message");

        svl = {
            rootDirectory: '/',
            isOnboarding: function () { return false; }
        };
        svl = { rootDirectory: '/' };
        svl.isOnboarding = function () { return false; };

        taskContainerMock = new TaskContainerMock();
        mapServiceMock = new MapServiceMock();
        compass = new Compass(svl, mapServiceMock, taskContainerMock, uiCompass);
    });

    describe("`_checkEnRoute` method", function () {
        it ("should check if a user is on the specified route");
    });

    describe("`update` method", function () {
        beforeEach(function () {
            spyOn(compass, '_checkEnRoute');
        });

        it("should call `_checkEnRoute` method", function () {
            compass.update();
            expect(compass._checkEnRoute).toHaveBeenCalled();
        });

        describe('if the user is on the route', function () {
            beforeEach(function () {
                compass = new Compass(svl, mapServiceMock, taskContainerMock, uiCompass);
                compass._checkEnRoute = function () { return true; };

                spyOn(compass, 'stopBlinking');
                spyOn(compass, '_makeTheMessageBoxUnclickable');
            });

            it("should call `stopBlinking` method", function () {
                compass.update();
                expect(compass.stopBlinking).toHaveBeenCalled();
            });

            it("should call `_makeTheMessageBoxUnclickable` method", function () {
                compass.update();
                expect(compass._makeTheMessageBoxUnclickable).toHaveBeenCalled();
            });
        });

        describe("if the user is not on the route", function () {
            beforeEach(function () {
                compass = new Compass(svl, mapServiceMock, taskContainerMock, uiCompass);
                compass._checkEnRoute = function () { return false; };

                spyOn(compass, 'blink');
                spyOn(compass, '_makeTheMessageBoxClickable');
            });

            it("should call the `blink` method", function () {
                compass.update();
                expect(compass.blink).toHaveBeenCalled()
            });

            it("should call the `_makeTheMessageBoxClickable` method", function () {
                compass.update();
                expect(compass._makeTheMessageBoxClickable).toHaveBeenCalled();
            });
        });
    });

    function MapServiceMock () {
        this.getPosition = function () {
            return { lat: 0, lng: 0 };
        };

        this.getPov = function () { return { heading: 0, pitch: 0, zoom: 1 }; }
    }

    function TaskContainerMock () {
        this.getCurrentTask = function () { return new TaskMock(); };
    }

    function TaskMock () {
        this.getGeometry = function () { return {
            coordinates: [ [0, 0], [1, 1] ]
        } };
    }
});