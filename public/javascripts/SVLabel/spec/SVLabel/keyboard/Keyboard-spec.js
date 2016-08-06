describe("Tests for the Keyboard module.", function () {
  var keyboard = new Keyboard($);

  describe("The getStatus method", function() {
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
  		expect(keyboard.getStatus('shiftDown')).not.toBe(false);
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

});
