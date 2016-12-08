describe("Keyboard module", function () {
    var keyboard;
    var svl;
    var contextMenuMock;
    var googleMap;
    var labelMock;
    var ribbonMock;
    var zoomControlMock;

    beforeEach(function () {
        svl = {
            isOnboarding: function () { return false; }
        };

        contextMenuMock = new ContextMenuMock();
        ribbonMock = null;
        zoomControlMock = null;
        googleMap = new MapServiceMock();
        keyboard = new Keyboard(svl, null, contextMenuMock, googleMap, ribbonMock, zoomControlMock);
    });

    describe("`getStatus` method", function() {
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

	    describe("when the context menu is open", function () {
            beforeEach(function () {
                spyOn(contextMenuMock, 'updateRadioButtonImages');

                labelMock = new LabelMock();
                labelMock.setProperty('severity', 5);
                contextMenuMock.isOpen = function () { return true; }
            });

            it('should set the problem severity', function () {
                triggerKeyUp($(document), 53);
                expect(labelMock.getProperty('severity')).toBe(5);
            });

            it('should call `ContextMenu.updateRadioButtonImages` method', function () {
                triggerKeyUp($(document), 53);
                expect(contextMenuMock.updateRadioButtonImages).toHaveBeenCalled();
            });
        });
    });

    var triggerKeyUp = function (element, keyCode) {
        var e = $.Event("keyup");
        e.which = keyCode;
        e.keyCode = keyCode;
        element.trigger(e);
    };

    function ContextMenuMock ( ) {
        this._status = {
            targetLabel: null,
            isOpen: false
        }
    }

    ContextMenuMock.prototype.getTargetLabel = function () {
        return this._status.targetLabel;
    };

    ContextMenuMock.prototype.isOpen = function () {
        return this._status.isOpen;
    };

    ContextMenuMock.prototype.updateRadioButtonImages = function () {};

    ContextMenuMock.prototype.checkRadioButton = function () { };

    function LabelMock () {
        this._properties = { severity: null };
        this.getProperty = function (key) {
            return this._properties[key];
        };
        this.setProperty = function (key, value) {
            this._properties[key] = value;
        };
    }

    function MapServiceMock () {
        this.status = { disableWalking: false };

    }
});
