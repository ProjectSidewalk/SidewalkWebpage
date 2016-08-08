describe("Keyboard module.", function () {
    var onboarding;



  describe("`getStatus` method", function() {
      var svl = {};
      var keyboard,
          contextMenuMock;
      beforeEach(function () {
          contextMenuMock = {
              _status: {
                  targetLabel: null
              },
              getTargetLabel: function () {
                  return this._status.targetLabel;
              },
              isOpen: function () { return false; }
          };
          keyboard = new Keyboard($, null, contextMenuMock, null, null, null);
      });

  	it("should get status that shiftDown should be true", function() {
  		keyboard.setStatus('shiftDown', true);
  		expect(keyboard.getStatus('shiftDown')).toBe(true);
  	});

  	it("should get status that focusOnTextField true", function() {
  		keyboard.setStatus('focusOnTextField', true);
  		expect(keyboard.getStatus('focusOnTextField')).toBe(true);
  	});

  	it("changes to focusOnTextField should not effect shiftDown", function() {
  		keyboard.setStatus('focusOnTextField', false);
  		expect(keyboard.getStatus('focusOnTextField')).toBe(false);
  		expect(keyboard.getStatus('shiftDown')).toBe(false);
  	});

  	it("should return undefined with an invalid key", function () {
  		expect(keyboard.getStatus('notValid')).toBe(undefined);
  	});
  });

  describe("The isShiftDown method", function() {
      var svl = {};
      var keyboard,
          contextMenuMock;

      beforeEach(function () {

          contextMenuMock = {
              _status: {
                  targetLabel: null
              },
              getTargetLabel: function () {
                  return this._status.targetLabel;
              },
              isOpen: function () { return false; }
          };
          keyboard = new Keyboard($, null, contextMenuMock, null, null, null);
      });

  	it("should return that shift is currently pressed", function() {
  		keyboard.setStatus('shiftDown', true);
  		expect(keyboard.getStatus('shiftDown')).toBe(true);
  	});
  	it("should return that shift is not pressed", function() {
  		keyboard.setStatus('shiftDown', false);
  		expect(keyboard.getStatus('shiftDown')).toBe(false);
  	});
  });

  describe("The setStatus method", function() {
      var svl = {};
      var keyboard,
          contextMenuMock;

      beforeEach(function () {

          contextMenuMock = {
              _status: {
                  targetLabel: null
              },
              getTargetLabel: function () {
                  return this._status.targetLabel;
              },
              isOpen: function () { return false; }
          };
          keyboard = new Keyboard($, null, contextMenuMock, null, null, null);
      });

  	it("should not change value of shiftDown if key is invalid", function() {
  		expect(keyboard.getStatus('shiftDown')).toBe(false);
  		keyboard.setStatus('notShiftDown', true);
  		expect(keyboard.getStatus('shiftDown')).not.toBe(true);
  	});

  	it("should not change value of focusOnTextField if key is invalid", function() {
  		expect(keyboard.getStatus('focusOnTextField')).toBe(false);
  		keyboard.setStatus('notfocusOnTextField', true);
  		expect(keyboard.getStatus('focusOnTextField')).not.toBe(true);
  	});

    it("should change the values of shiftDown and focusOnTextField to true", function() {
      keyboard.setStatus('shiftDown', true);
      expect(keyboard.getStatus('shiftDown')).toBe(true);
      keyboard.setStatus('focusOnTextField', true);
      expect(keyboard.getStatus('focusOnTextField')).toBe(true);
    });

    it("should change the values of shiftDown and focusOnTextField to true", function() {
      keyboard.setStatus('shiftDown', false);
      expect(keyboard.getStatus('shiftDown')).toBe(false);
      keyboard.setStatus('focusOnTextField', false);
      expect(keyboard.getStatus('focusOnTextField')).toBe(false);
    });
  });

	describe("`documentKeyUp`", function () {
        var svl = null;
        var labelMock;
        var keyboard,
            contextMenuMock;
	    describe("when the context menu is open", function () {
            beforeEach(function () {
                svl = {};
                labelMock = {
                    _status: {
                        severity: null
                    },
                    _properties: {
                          severity: null
                    },
                    getStatus: function (key) {
                        return this._status[key];
                    },
                    setStatus: function (key, value) {
                        this._status[key] = value;
                    },
                    getProperty: function (key) {
                        return this._properties[key];
                    },
                    setProperty: function (key, value) {
                        this._properties[key] = value;
                    }
                };

                contextMenuMock = {
                    _status: {
                        targetLabel: labelMock
                    },
                    checkRadioButton: function () {},
                    getTargetLabel: function () {
                        return this._status.targetLabel;
                    },
                    isOpen: function () { return true; }
                };

                keyboard = new Keyboard($, null, contextMenuMock, null, null, null, onboarding);
            });

            it('should set the problem severity', function () {
                triggerKeyUp($(document), 53);
                expect(labelMock.getProperty('severity')).toBe(5);
            });
        });
    });

    var triggerKeyUp = function (element, keyCode) {
        var e = $.Event("keyup");
        e.which = keyCode;
        e.keyCode = keyCode;
        element.trigger(e);
    };
});
