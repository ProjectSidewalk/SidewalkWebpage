describe("Specs for the Canvas module.", function () {
  var param = {};
  var canvas = Canvas($, param);

  // A fake label class.
  var FakeLabel = function (param) {
    var self = {};
    var status = {};
    status.deleted = false;
    status.visible = true;
    self.className = 'Label';
    self.name = ((typeof param == 'object') && ('name' in param)) ? param.name : null;
    self.isVisible = function () { return status.visible; };
    self.isDeleted = function () { return status.deleted; };
    return self;
  };

  beforeEach(function () {
    canvas.removeAllLabels();
  });

  describe("The method setStatus", function () {
    it("should not set invalid status", function () {
      expect(function () { canvas.setStatus('foo'); }).toThrow("Canvas: Illegal status name.");
    });
  });

  describe("The method cancelDrawing", function () {
    it("should set status.drawing to false", function () {
      canvas.setStatus('drawing', true);
      canvas.cancelDrawing();
      expect(canvas.getStatus('drawing')).toBeFalsy();
    });
  });

  describe("The methods that disable/enable actions", function () {
    it("disableLabelDelete should set status.disableLabelDelete to true", function () {
      canvas.disableLabelDelete();
      expect(canvas.getStatus('disableLabelDelete')).toBeTruthy();
    });

    it("enableLabelDelete should set status.disableLabelDelete to false", function () {
      canvas.enableLabelDelete();
      expect(canvas.getStatus('disableLabelDelete')).toBeFalsy();
    });

    it("disableLabelEdit should set status.disableLabelEdit to true", function () {
      canvas.disableLabelEdit();
      expect(canvas.getStatus('disableLabelEdit')).toBeTruthy();
    });

    it('enableLabelEdit should set status.disableLabelEdit to false', function () {
      canvas.enableLabelEdit();
      expect(canvas.getStatus('disableLabelEdit')).toBeFalsy();
    });

    it("disableLabeling should set status.disableLabeling to true", function () {
      canvas.disableLabeling();
      expect(canvas.getStatus('disableLabeling')).toBeTruthy();
    });

    it("enableLabeling should set status.disableLabeling to false", function () {
      canvas.enableLabeling();
      expect(canvas.getStatus('disableLabeling')).toBeFalsy();
    });
  });

  describe("The method getCurrentLabel", function () {
    var label = new FakeLabel();
    it("should return the current label", function () {
      canvas.setCurrentLabel(label);
      expect(canvas.getCurrentLabel()).toBe(label);
    });

    it("should return null if current label is not set", function () {
      canvas.setCurrentLabel(null);
      expect(canvas.getCurrentLabel()).toBeNull();
    });
  });

  describe("The method getStatus", function () {
    beforeEach(function() {
      spyOn(console, 'warn'); // To use toHaveBeenCalled()
    });

    it("should return currentLabel", function () {
      var label = new FakeLabel();
      canvas.setCurrentLabel(label);
      expect(canvas.getStatus('currentLabel')).toBe(label);
    });

    it("should return the status 'drawing'", function () {
      expect(canvas.getStatus('drawing')).toBeFalsy();

      canvas.setStatus('drawing', true);
      expect(canvas.getStatus('drawing')).toBeTruthy();
    });

    it("should warn if invalid key for status is passed", function () {
      // Testing console output with Jasmine
      // http://stackoverflow.com/questions/19825020/how-can-i-use-jasmine-js-to-test-for-console-output
      canvas.getStatus('foo');
      expect(console.warn).toHaveBeenCalled();
    });
  });


  describe("The method isDrawing", function () {
    it("should return the isDrawing status", function () {
      canvas.setStatus("drawing", true);
      expect(canvas.isDrawing()).toBeTruthy;
      canvas.setStatus("drawing", false);
      expect(canvas.isDrawing()).toBeFalsy();
    });
  });

  describe("The method lockCurrentLabel", function () {
    it("should set status.lockCurrentLabel to be true.", function () {
      canvas.lockCurrentLabel();
      expect(canvas.getStatus("lockCurrentLabel")).toBeTruthy();
    });
  });

  describe("The method lockDisableLabelDelete", function () {
    it("should set status.lockDisableLabelDelete to be true", function () {
      canvas.lockDisableLabelDelete();
      expect(canvas.getStatus("lockDisableLabelDelete")).toBeTruthy();
    });
  });

  describe("The method lockDisableLabelEdit", function () {
    it("should set status.lockDisableLabelDelete to be true", function () {
      canvas.lockDisableLabelEdit();
      expect(canvas.getStatus("lockDisableLabelEdit")).toBeTruthy();
    });
  });

  describe("The method lockDisableLabeling", function () {
    it("should set status.lockDisableLabeling to be true", function () {
      canvas.lockDisableLabeling();
      expect(canvas.getStatus("lockDisableLabeling")).toBeTruthy();
    });
  });

  describe("The method lockDisableLabeling", function () {
    it("should set status.lockDisableLabeling to be true", function () {
      canvas.lockShowLabelTag();
      expect(canvas.getLock("showLabelTag")).toBeTruthy();
    });
  });

  describe("The method lockShowLabelTag", function () {
    it("should set lock.lockShowLabelTag to be true", function () {
      canvas.lockDisableLabeling();
      expect(canvas.getStatus("lockDisableLabeling")).toBeTruthy();
    });
  });

  describe("The method pushLabel", function () {
    // Todo
  });

  describe("The method removeLabels", function () {
    // Todo
  });

  describe("setCurrentLabel", function () {
    // Todo
  });

  describe("The method unlockCurrentLabel", function () {
    it("should set status.lockCurrentLable to be false", function () {
      canvas.lockCurrentLabel();
      canvas.unlockCurrentLabel();
      expect(canvas.getStatus("lockCurrentLabel")).toBeFalsy();
    });
  });

  describe("The method unlockDisableLabelDelete", function () {
    it("should set status.unlockDisableLabelDelete to be false", function () {
      canvas.lockDisableLabelDelete();
      canvas.unlockDisableLabelDelete();
      expect(canvas.getStatus("lockDisableLabelDelete")).toBeFalsy();
    });
  });

  describe("The method unlockDisableLabelEdit", function () {
    it("should set status.unlockDisableLabelEdit to be false", function () {
      canvas.lockDisableLabelEdit();
      canvas.unlockDisableLabelEdit();
      expect(canvas.getStatus("lockDisableLabelEdit")).toBeFalsy();
    });
  });

  describe("The method unlockDisableLabeling", function () {
    it("should set status.unlockDisableLabelEdit to be false", function () {
      canvas.lockDisableLabeling();
      canvas.unlockDisableLabeling();
      expect(canvas.getStatus("lockDisableLabeling")).toBeFalsy();
    });
  });

  describe("The method unlockShowLabelTag", function () {
    it("should set status.unlockDisableLabelEdit to be false", function () {
      canvas.lockShowLabelTag();
      canvas.unlockShowLabelTag();
      expect(canvas.getLock("showLabelTag")).toBeFalsy();
    });
  });
});
