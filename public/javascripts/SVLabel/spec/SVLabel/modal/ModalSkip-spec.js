describe("ModalSkip module", function () {
    var modalSkip;
    var modalModel;

    var form;
    var navigationModel;
    var ribbonMenu;
    var taskContainer;
    var tracker;
    var uiLeftColumn;
    var uiModalSkip;

    var $leftColumn;
    var $modalSkip;

    beforeEach(function () {
        modalModel = _.clone(Backbone.Events);

        form = new FormMock();
        navigationModel = _.clone(Backbone.Events);
        ribbonMenu = new RibbonMenuMock();
        taskContainer = new TaskContainerMock();
        tracker = new TrackerMock();

        $leftColumn = prepareLeftColumnFixture();
        $modalSkip = prepareModalSkip();

        uiLeftColumn = {};
        uiLeftColumn.holder = $leftColumn;
        uiLeftColumn.sound = $leftColumn.find("#left-column-sound-button");
        uiLeftColumn.muteIcon = $leftColumn.find("#left-column-mute-icon");
        uiLeftColumn.soundIcon = $leftColumn.find("#left-column-sound-icon");
        uiLeftColumn.jump = $leftColumn.find("#left-column-jump-button");
        uiLeftColumn.feedback = $leftColumn.find("#left-column-feedback-button");

        uiModalSkip = {};
        uiModalSkip.holder = $modalSkip;
        uiModalSkip.ok = $modalSkip.find("#modal-skip-ok-button");
        uiModalSkip.cancel = $modalSkip.find("#modal-skip-cancel-button");
        uiModalSkip.radioButtons = $modalSkip.find(".modal-skip-radio-buttons");

        modalSkip = new ModalSkip(form, modalModel, navigationModel, ribbonMenu, taskContainer, tracker, uiLeftColumn, uiModalSkip);
    });

    describe("`_handleClickOK` method", function () {
        beforeEach(function () {
            spyOn(modalSkip, 'hideSkipMenu');
            spyOn(form, 'skip');
            spyOn(ribbonMenu, 'backToWalk');
            spyOn(tracker, 'push');
        });

        it('should call the `hideSkipMenu` method', function () {
            modalSkip._handleClickOK();
            expect(modalSkip.hideSkipMenu).toHaveBeenCalled();
        });

        it('should call the `skip` method', function () {
            modalSkip._handleClickOK();
            expect(form.skip).toHaveBeenCalled();
        });

        it('should call the `Tracker.push` method', function () {
            modalSkip._handleClickOK();
            expect(tracker.push).toHaveBeenCalledWith("ModalSkip_ClickOK");
        });

        it('should call the `RibbonMenu.backToWalk` method', function () {
            modalSkip._handleClickOK();
            expect(ribbonMenu.backToWalk).toHaveBeenCalled();
        });
    });

    function FormMock () {
        this.skip = function (task, radioValue) {};
    }
    function RibbonMenuMock () {
        this.backToWalk = function () {};
    }
    function TaskContainerMock () {
        this.getCurrentTask = function () { return new TaskMock(); }
    }
    function TaskMock() {}
    function TrackerMock () {
        this.push = function (item) {};
    }

    function prepareLeftColumnFixture () {
        return $('<div id="left-column-control-pane"> \
                        <div id="left-column-button-holder"> \
                            <div id="left-column-sound-button" class="button"> \
                                <img src="" id="left-column-sound-icon" class="visible" alt="Sound icon" align=""> \
                                <img src="" id="left-column-mute-icon" class="hidden" alt="Mute icon" align=""> \
                                Sound \
                            </div> \
                            <div class="spacer10"></div> \
                            <div id="left-column-jump-button" class="button"> \
                                <img src="" alt="Jump icon" align=""> \
                                Jump \
                            </div> \
                            <div class="spacer10"></div> \
                            <div id="left-column-feedback-button" class="button"> \
                                <img src="" alt="Comment icon" align=""> \
                                Feedback \
                            </div> \
                        </div> \
                    </div>');
    }

    function prepareModalSkip () {
        return $('<div id="modal-skip-holder" class="hidden"> \
                        <div id="modal-skip-background"></div> \
                        <div id="modal-skip-box"> \
                            <div id="modal-skip-title" class="bold"> \
                                <p>Jump to another location because:</p> \
                            </div> \
                            <div id="modal-skip-content"> \
                                <div class="radio"> \
                                    <label> \
                                        <input class="modal-skip-radio-buttons" type="radio" \
                                            value="IWantToExplore" name="modal-skip-radio"> \
                                        I want to explore another area! \
                                    </label> \
                                </div> \
                                <div class="radio"> \
                                    <label> \
                                        <input class="modal-skip-radio-buttons" type="radio" \
                                            value="GSVNotAvailable" name="modal-skip-radio"> \
                                        I cannot go the direction that you want me to walk. \
                                    </label> \
                                </div> \
                                <div> \
                                    <button class="button" id="modal-skip-ok-button">OK</button>&nbsp; \
                                    <button class="button" id="modal-skip-cancel-button">Cancel</button> \
                                </div> \
                            </div> \
                        </div> \
                    </div>');
    }

});