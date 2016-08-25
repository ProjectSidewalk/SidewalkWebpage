describe("RibbonMenu module.", function () {
    var ribbon;
    var overlayMessageBoxMock;
    var $fixture;
    var svl = {};

    svl.map = {};
    svl.map.modeSwitchLabelClick = function () { return this; }; // mock function
    svl.map.modeSwitchWalkClick = function () { return this; };

    beforeEach(function () {

        $fixture = prepareAFixture();

        var mockTracker = {
            push: function (item) { }
        };
        overlayMessageBoxMock = new OverlayMessageBoxMock();

        svl.ui = {};
        svl.ui.ribbonMenu = {};
        svl.map = {};
        svl.map.modeSwitchLabelClick = function () { return this; };
        svl.map.modeSwitchWalkClick = function () { return this; };


        svl.ui.ribbonMenu.holder = $fixture; // .find("#ribbon-menu-landmark-button-holder");
        svl.ui.ribbonMenu.streetViewHolder = $fixture.find("#street-view-holder");
        svl.ui.ribbonMenu.buttons = $fixture.find('span.modeSwitch');
        svl.ui.ribbonMenu.bottonBottomBorders = $fixture.find(".ribbon-menu-mode-switch-horizontal-line");
        svl.ui.ribbonMenu.connector = $fixture.find("#ribbon-street-view-connector");
        svl.ui.ribbonMenu.subcategoryHolder = $fixture.find("#ribbon-menu-other-subcategory-holder");
        svl.ui.ribbonMenu.subcategories = $fixture.find(".ribbon-menu-other-subcategories");
        svl.ui.ribbonMenu.informationButtons = $fixture.find(".ribbon-mode-switch-info-buttons");

        ribbon = new RibbonMenu(overlayMessageBoxMock, mockTracker, svl.ui.ribbonMenu);
        ribbon.unlockDisableModeSwitch();
        ribbon.enableModeSwitch();
    });

    describe("The backToWalk method", function () {
        it("should switch the mode to Walk", function () {
            ribbon.backToWalk();
            expect(ribbon.getStatus('mode')).toBe('Walk');
        });
    });

    describe("The disableModeSwitch method", function() {
        it("should disable mode switch", function() {
            ribbon.disableModeSwitch();
            expect(ribbon.getStatus('disableModeSwitch')).toBe(true);
        });
    });

    describe("The enableModeSwitch method", function() {
        it("should enable mode switch", function() {
            ribbon.enableModeSwitch();
            expect(ribbon.getStatus('disableModeSwitch')).toBe(false);
        });
    });

    describe("The disableLandmarkLabels", function() {
        it("should set disableLandmarkLabels to true", function() {
            ribbon.disableLandmarkLabels();
            expect(ribbon.getStatus('disableLandmarkLabels')).toBe(true);
        });
    });

    describe("The enableLandmarkLabels", function() {
        it("should set disableLandmarkLabels to false", function() {
            ribbon.enableLandmarkLabels();
            expect(ribbon.getStatus('disableLandmarkLabels')).toBe(false);
        });
    });

    describe("The lockDisableModeSwitch", function() {
        it("should not allow you to disable mode switch", function() {
            ribbon.enableModeSwitch();
            ribbon.lockDisableModeSwitch();
            ribbon.disableModeSwitch();
            ribbon.unlockDisableModeSwitch();
            expect(ribbon.getStatus("disableModeSwitch")).toBeFalsy();
        });

        it("should not allow ribbon to enable mode switch", function() {
            ribbon.disableModeSwitch()
            ribbon.lockDisableModeSwitch();
            ribbon.enableModeSwitch();
            expect(ribbon.getStatus("disableModeSwitch")).toBe(true);
        });
    });

    describe("The unlockDisableModeSwitch", function() {

        it("should allow ribbon to disable mode switch", function() {
            ribbon.lockDisableModeSwitch();
            ribbon.disableModeSwitch();
            expect(ribbon.getStatus("disableModeSwitch")).toBeFalsy();

            ribbon.unlockDisableModeSwitch();
            ribbon.disableModeSwitch();
            expect(ribbon.getStatus("disableModeSwitch")).toBeTruthy();
        });

        it("should allow ribbon to enable mode switch", function() {
            ribbon.disableModeSwitch();
            ribbon.lockDisableModeSwitch();
            ribbon.enableModeSwitch();
            expect(ribbon.getStatus("disableModeSwitch")).toBeTruthy();

            ribbon.unlockDisableModeSwitch();
            ribbon.enableModeSwitch();
            expect(ribbon.getStatus("disableModeSwitch")).toBeFalsy();
        });
    });

    describe("The getStatus method", function () {
        it("should warn when an illegal key is passed.", function () {
            expect(ribbon.getStatus('invalid')).toBe(undefined);
        });
        it("should get the status of valid key", function() {
            expect(ribbon.getStatus('disableModeSwitch')).toBe(false);
        });
    });

    describe("The modeSwitch method", function() {
        it("should switch the mode", function () {
            ribbon.modeSwitch('CurbRamp');
            expect(ribbon.getStatus('mode')).toBe('CurbRamp');
        });
    });

    describe("The setAllowedMode method", function() {
        it("should set allowedMode to mode", function() {
            ribbon.setAllowedMode('valid');
            expect(ribbon.getStatus('allowedMode')).toBe('valid');
        });

    });

    function prepareAFixture () {
        return $(" <div id='ribbon-menu-holder'> \
                  <span id=ribbon-menu-left-column-holder'> \
                    <div id='ribbon-menu-left-column-title'></div> \
                    <div id='ribbon-menu-left-column-button-holder'> \
                      <span class='modeSwitch' val='Walk' id='modeSwitchWalk' style=''> \
                        <span class='modeSwitch_Icon'> \
                          <img src=''  id='icon-explore' class='icon-ribbon-menu-large' alt='Mode switch: Walk'> \
                        </span> \
                        <span class='modeSwitch_Name' style='position:absolute; left: 0px;'><u>E</u>xplore</span> \
                          <div id='ribbon-mode-switch-horizontal-line-walk' class='ribbon-menu-mode-switch-horizontal-line' val='Walk'></div> \
                      </span> \
                    </div> \
                  </span> \
                  <span id='landmark-holder'> \
                    <div id='ribbon-menu-landmark-title'> \
                      Find and label the following \
                    </div> \
                    <div id='ribbon-menu-landmark-button-holder'> \
                      <span id='ModeSwitchButton_CurbRamp' class='modeSwitch' val='CurbRamp'>\
                        <span class='modeSwitch_Icon'>\
                          <img src='' class='icon-ribbon-menu-large' alt='Mode switch:' align=''>\
                        </span>\
                        <div class='modeSwitch_Name'><u>C</u>urb Ramp</div>\
                        <div class='ribbon-menu-mode-switch-horizontal-line' val='CurbRamp'></div>\
                        <svg class='ribbon-mode-switch-info-buttons' val='CurbRamp'>\
                          <polygon points='0,0, 0,20, 20,20' class='curb-ramp' />\
                          <text x='3' y='20' fill='white'>?</text>\
                        </svg> \
                      </span> \
                      <span id='ModeSwitchButton_NoCurbRamp' class='modeSwitch' val='NoCurbRamp'> \
                          <span class='modeSwitch_Icon'> \
                          <img src='' class='icon-ribbon-menu-large' alt='Mode switch:' align=''> \
                          </span> \
                          <span class='modeSwitch_Name'><u>M</u>issing Curb Ramp</span> \
                          <div class='ribbon-menu-mode-switch-horizontal-line' val='NoCurbRamp'></div> \
                          <svg class='ribbon-mode-switch-info-buttons' val='NoCurbRamp'> \
                            <polygon points='0,0, 0,20, 20,20' class='no-curb-ramp'></polygon> \
                            <text x='3' y='20' fill='white'>?</text> \
                          </svg> \
                      </span> \
                      <span id='ModeSwitchButton_Obstacle' class='modeSwitch' val='Obstacle'> \
                        <span class='modeSwitch_Icon'> \
                          <img src='' class='icon-ribbon-menu-large' alt='Mode switch:' align=''> \
                        </span> \
                        <span class='modeSwitch_Name'>\
                          <span class='underline'>O</span>bstacle in <br /> Path\
                        </span> \
                        <div class='ribbon-menu-mode-switch-horizontal-line' val='Obstacle'></div> \
                        <svg class='ribbon-mode-switch-info-buttons' val='Obstacle'> \
                          <polygon points='0,0, 0,20, 20,20' class='obstacle'></polygon> \
                          <text x='3' y='20' fill='white'>?</text> \
                        </svg> \
                      </span> \
                      <span id='ModeSwitchButton_SurfaceProblem' class='modeSwitch' val='SurfaceProblem'> \
                        <span class='modeSwitch_Icon'> \
                          <img src='' class='icon-ribbon-menu-large' alt='Mode switch:' align=''>  \
                        </span> \
                        <span class='modeSwitch_Name'><span class='underline'>S</span>urface Problem</span> \
                        <div class='ribbon-menu-mode-switch-horizontal-line' val='SurfaceProblem'></div> \
                        <svg class='ribbon-mode-switch-info-buttons' val='SurfaceProblem'> \
                          <polygon points='0,0, 0,20, 20,20' class='surface-problem' /> \
                          <text x='3' y='20' fill='white'>?</text> \
                        </svg> \
                      </span> \
                      <span id='ModeSwitchButton_Other' class='modeSwitch' val='Other'> \
                        <span class='modeSwitch_Icon'> \
                          <img src='' class='icon-ribbon-menu-large' alt='Mode switch:' align=''> \
                        </span> \
                        <span class='modeSwitch_Name'> \
                          Other \
                        </span> \
                        <div class='ribbon-menu-mode-switch-horizontal-line' val='Other'></div> \
                        <div id='ribbon-menu-other-subcategory-holder'> \
                          <div class='ribbon-menu-other-subcategories' val='Occlusion'> \
                            <img src='' class='icon-ribbon-menu-medium' alt='Occluded sidewalk icon'> \
                            Can't see the sidewalk (<span class='underline'>B</span>) \
                          </div> \
                          <hr> \
                          <div class='ribbon-menu-other-subcategories' val='NoSidewalk'> \
                              <img src='' class='icon-ribbon-menu-medium' alt='No sidewalk icon'> \
                              <span class='underline'>N</span>o sidewalk \
                          </div> \
                          <hr> \
                          <div class='ribbon-menu-other-subcategories' val='Other'> \
                              <img src='' class='icon-ribbon-menu-medium' alt='Other icon'> \
                              Other \
                          </div> \
                        </div> \
                      </span> \
                    </div> \
                  </span> \
                </div>");
    }

    function OverlayMessageBoxMock () {
        this.setHelpLink = function () {};
        this.setMessage = function () {};
    }

});
