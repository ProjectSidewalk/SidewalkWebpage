describe("Onboarding module", function () {
    var onboarding;
    var statusModelMock;
    var svl;
    var actionStack;
    var audioEffect;
    var compass;
    var form;
    var handAnimation;
    var mapService;
    var missionContainer;
    var modalComment;
    var modalMission;
    var modalSkip;
    var neighborhoodContainer;
    var onboardingStates;
    var ribbon;
    var statusField;
    var statusModel;
    var storage;
    var taskContainer;
    var tracker;
    var uiCanvas;
    var uiContextMenu;
    var uiMap;
    var uiOnboarding;
    var uiRibbon;
    var user;
    var zoomControl;
    var $uiOnboardingFixture;


    beforeEach(function () {
        statusModelMock = _.clone(Backbone.Events);
        svl = { rootDirectory: "/" };

        compass = new CompassMock();
        form = new FormMock();
        handAnimation = new HandAnimationMock();
        mapService = new MapServiceMock();
        missionContainer = new MissionContainerMock();
        modalMission = new ModalMissionMock();
        neighborhoodContainer = new NeighborhoodContainerMock();
        onboardingStates = new OnboardingStatesMock();
        storage = new StorageMock();
        taskContainer = new TaskContainerMock();
        tracker = new TrackerMock();
        user = new UserMock();
        zoomControl = new ZoomControlMock();

        $uiOnboardingFixture = $('  <div id="onboarding-holder" class="Window_StreetView"> \
                                        <canvas id="onboarding-canvas"  class="Window_StreetView" width="720px" height="480px" style="cursor: default, move;"></canvas> \
                                        <div id="hand-gesture-holder"></div> \
                                        <div id="onboarding-background"></div> \
                                        <div id="onboarding-message-holder" class="white-background"> \
                                            <p></p> \
                                        </div> \
                                        <div style="display:none;"> \
                                            <img src="" id="double-click-icon" width="200" alt="Double click icon"/> \
                                        </div> \
                                    </div>');
        uiOnboarding = {};
        uiOnboarding.holder = $uiOnboardingFixture;
        uiOnboarding.messageHolder = $uiOnboardingFixture.find("#onboarding-message-holder");
        uiOnboarding.background = $uiOnboardingFixture.find("#onboarding-background");
        uiOnboarding.foreground = $uiOnboardingFixture.find("#onboarding-foreground");
        uiOnboarding.canvas = $uiOnboardingFixture.find("#onboarding-canvas");
        uiOnboarding.handGestureHolder = $uiOnboardingFixture.find("#hand-gesture-holder");

        onboarding = Onboarding(svl, actionStack, audioEffect, compass, form, handAnimation, mapService, missionContainer,
            modalComment, modalMission, modalSkip, neighborhoodContainer, onboardingStates, ribbon, statusField, statusModel,
            storage, taskContainer, tracker, uiCanvas, uiContextMenu, uiMap, uiOnboarding, uiRibbon, user, zoomControl)
    });

    describe("`_visit` method", function () {
        describe("when called with a `null` parameter", function () {
            beforeEach(function () {
                spyOn(modalMission, 'setMissionMessage');
                spyOn(modalMission, 'show');
            });

            it("should call `ModalMisison.setMissionMessage` method", function () {
                onboarding._visit(null);
                expect(modalMission.setMissionMessage).toHaveBeenCalled();
            });

            it("should call `ModalMission.show` method", function () {
                onboarding._visit(null);
                expect(modalMission.show).toHaveBeenCalled();
            });
        });

    });

    function CompassMock () {
        this.hideMessage = function () {};
    }

    function FormMock () {
        this.compileSubmissionData = function () { return {} };
        this.submit = function (data, task) { };
    }

    function HandAnimationMock () {
        this.initializeHandAnimation = function () {};
    }

    function MapServiceMock () {
        this.disableWalking = function () {};
        this.enableWalking = function () {};
        this.lockDisableWalking = function () {};
        this.unlockDisableWalking = function () {};
    }

    function MissionContainerMock () {
        this._currentMission = null;
        this.getMissionsByRegionId = function (regionId) { return new MissionMock(); };
        this.setCurrentMission = function (mission) { this._currentMission = mission; };
    }

    function MissionMock () {
        this._isCompleted = false;
        this.isCompleted = function () { return this._isCompleted; }
    }

    function ModalMissionMock () {
        this.setMissionMessage = function (mission, neighborhood, parameters, callback) {};
        this.show = function () {};
    }

    function NeighborhoodContainerMock () {
        this._status = { currentNeighborhood: new NeighborhoodMock() };
        this.getStatus = function (key) { return this._status[key] };
    }

    function NeighborhoodMock () {
        this._properties = { regionId: 0 };
        this.getProperty = function (key) { return this._properties[key]; };
    }

    function OnboardingStatesMock () {
        this.get = function () { return {}; };
    }

    function StorageMock () {
        this.set = function (key, value) {};
    }

    function TaskMock () {

    }

    function TaskContainerMock () {
        this.getCurrentTask = function () { return new TaskMock(); }
        this.initNextTask = function () { };
    }

    function TrackerMock () {
        this.push = function (item) { };
    }

    function UserMock () {
        this._properties = { username: "anonymous" };
        this.getProperty = function (key) {
            return this._properties[key];
        }
    }

    function ZoomControlMock () {
        this.disableZoomIn = function () {};
        this.disableZoomOut = function () {};
        this.enableZoomIn = function () {};
        this.enableZoomOut = function () {};
        this.lockDisableZoomIn = function () {};
        this.lockDisableZoomOut = function () {};
        this.unlockDisableZoomIn = function () {};
        this.unlockDisableZoomOut = function () {};
    }

});
