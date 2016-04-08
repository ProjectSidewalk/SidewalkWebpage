describe("Tests for the ZoomControl.", function () {
    Main($, d3, {});

	var zoom = new ZoomControl(jQuery);
	describe("The method getStatus", function () {
		it("should warn when an illegal key is passed.", function () {
			expect(function() {zoom.getStatus('invalid');} ).toThrow();
		});
		it("should get the status of valid key", function() {
			expect(zoom.getStatus('disableZoomIn')).toBe(false);
		});
	});

	describe("The method disableZoomIn", function() {
		it("should not allow it to zoom in", function() {
			zoom.disableZoomIn();
			expect(zoom.getStatus('disableZoomIn')).toBe(true);
			expect(zoom.zoomIn(1,1)).toBe(false);
		});
	});

	describe("The method disableZoomOut", function() {
		it("should not allow it to zoom out", function() {
			zoom.disableZoomOut();
			expect(zoom.getStatus('disableZoomOut')).toBe(true);
			expect(zoom.zoomOut(2,2)).toBe(false);
		});
	});

	describe("The method enableZoomIn", function() {
		it("should allow you to zoom in", function() {
			zoom.enableZoomIn();
			expect(zoom.getStatus('disableZoomIn')).toBe(false);
		});
	});

	describe("The method enableZoomOut", function() {
		it("should allow you to zoom Out", function() {
			zoom.enableZoomOut();
			expect(zoom.getStatus('disableZoomOut')).toBe(false);
		});
	});

	describe("The method getLock", function() {
		it("should warn when illegal key is passed.", function() {
			expect(function() {zoom.getLock('invalid');} ).toThrow();

		});
		it("should get valid lock status for valid key", function() {
			expect(zoom.getLock('disableZoomIn')).toBe(false);
		});
	});

	describe("The method lockDisableZoomIn", function() {
		it("should not allow user to enable zoom in", function() {
			zoom.disableZoomIn();
			expect(zoom.getStatus('disableZoomIn')).toBe(true);
			zoom.lockDisableZoomIn();
			expect(zoom.getLock('disableZoomIn')).toBe(true);
			zoom.enableZoomIn();
			expect(zoom.getStatus('disableZoomIn')).toBe(true);
			//reset lock status
			zoom.unlockDisableZoomIn();
		});
		it("should not allow user to disable zoom in", function() {
			zoom.enableZoomIn();
			expect(zoom.getStatus('disableZoomIn')).toBe(false);
			zoom.lockDisableZoomIn();
			expect(zoom.getLock('disableZoomIn')).toBe(true);
			zoom.disableZoomIn();
			expect(zoom.getStatus('disableZoomIn')).toBe(false);
			//reset lock status
			zoom.unlockDisableZoomIn();
		});
	});

	describe("The method lockDisableZoomOut", function() {
		it("should not allow user to enable zoom out", function() {
			zoom.disableZoomOut();
			expect(zoom.getStatus('disableZoomOut')).toBe(true);
			zoom.lockDisableZoomOut();
			expect(zoom.getLock('disableZoomOut')).toBe(true);
			zoom.enableZoomOut();
			expect(zoom.getStatus('disableZoomOut')).toBe(true);
			//reset lock status
			zoom.unlockDisableZoomOut();
		});
		it("should not allow user to disable zoom Out", function() {
			zoom.enableZoomOut();
			expect(zoom.getStatus('disableZoomOut')).toBe(false);
			zoom.lockDisableZoomOut();
			expect(zoom.getLock('disableZoomOut')).toBe(true);
			zoom.disableZoomOut();
			expect(zoom.getStatus('disableZoomOut')).toBe(false);
			//reset lock status
			zoom.unlockDisableZoomOut();
		});
	});

	describe("The method getProperties", function() {
		it("should warn when illegal key is passed.", function() {
			expect(function() {zoom.getProperties('invalid');} ).toThrow();

		});
		it("should get valid properties status for valid key", function() {
			zoom.setMaxZoomLevel(4)
			expect(zoom.getProperties('maxZoomLevel')).toBe(4);
		});
	});

	describe("The method setMaxZoomLevel", function() {
		it("should set the MaxZoomLevel", function() {
			zoom.setMaxZoomLevel(100);
			expect(zoom.getProperties('maxZoomLevel')).toBe(100);
		});
	});

	describe("The method setMinZoomLevel", function() {
		it("should set the MinZoomLevel", function() {
			zoom.setMinZoomLevel(-100);
			expect(zoom.getProperties('minZoomLevel')).toBe(-100);
		});
	});

	describe("The method unlockDisableZoomIn", function() {
		it("should allow user to enable zoom in", function() {
			zoom.disableZoomIn();
			expect(zoom.getStatus('disableZoomIn')).toBe(true);
			zoom.unlockDisableZoomIn();
			expect(zoom.getLock('disableZoomIn')).toBe(false);
			zoom.enableZoomIn();
			expect(zoom.getStatus('disableZoomIn')).toBe(false);
		});
		it("should allow user to disable zoom in", function() {
			zoom.enableZoomIn();
			expect(zoom.getStatus('disableZoomIn')).toBe(false);
			zoom.unlockDisableZoomIn();
			expect(zoom.getLock('disableZoomIn')).toBe(false);
			zoom.disableZoomIn();
			expect(zoom.getStatus('disableZoomIn')).toBe(true);
		});
	});

	describe("The method unlockDisableZoomOut", function() {
		it("should allow user to enable zoom out", function() {
			zoom.disableZoomOut();
			expect(zoom.getStatus('disableZoomOut')).toBe(true);
			zoom.unlockDisableZoomOut();
			expect(zoom.getLock('disableZoomOut')).toBe(false);
			zoom.enableZoomOut();
			expect(zoom.getStatus('disableZoomOut')).toBe(false);
		});
		it("should allow user to disable zoom in", function() {
			zoom.enableZoomOut();
			expect(zoom.getStatus('disableZoomOut')).toBe(false);
			zoom.unlockDisableZoomOut();
			expect(zoom.getLock('disableZoomOut')).toBe(false);
			zoom.disableZoomOut();
			expect(zoom.getStatus('disableZoomOut')).toBe(true);
		});
	});

	describe("The method pointZoomIn", function() {
		it("should return false if disableZoomIn is true", function() {
			zoom.disableZoomIn();
			expect(zoom.getStatus('disableZoomIn')).toBe(true);
			expect(zoom.pointZoomIn()).toBe(false);
		});
	});

	describe("The method zoomIn", function() {
		it("should return false if disableZoomIn is true", function() {
			zoom.disableZoomIn();
			expect(zoom.getStatus('disableZoomIn')).toBe(true);
			expect(zoom.zoomIn()).toBe(false);
		});
	});

	describe("The method zoomOut", function() {
		it("should return flase if disableZoomOut is true", function() {
			zoom.disableZoomOut();
			expect(zoom.getStatus('disableZoomOut')).toBe(true);
			expect(zoom.zoomOut()).toBe(false);
		});
	});
});
