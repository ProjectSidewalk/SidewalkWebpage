describe("Tests for the RibbonMenu module.", function () {
  var ribbon = new RibbonMenu(jQuery);
  svl.map = {};
  svl.map.modeSwitchLabelClick = function () { return this; } // mock function
  svl.map.modeSwitchWalkClick = function () { return this; }

  beforeEach(function () {
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

});
