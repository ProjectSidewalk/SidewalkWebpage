describe("ZoomControl Module", function () {
	var canvas;
	var mapService;
	var tracker;
	var zoomControl;
	var svl;
	var $fixture;


	beforeEach(function () {
		$fixture = $("<div id='zoom-control-holder'></div>");

		svl = {};
		svl.ui = {};
		svl.ui.zoomControl = {};
		svl.ui.zoomControl.holder = $fixture.find("#zoom-control-holder");
		svl.ui.zoomControl.holder.append('<button id="zoom-in-button" class="button zoom-control-button"><img src="' + svl.rootDirectory + 'img/icons/ZoomIn.svg" class="zoom-button-icon" alt="Zoom in"><br /><u>Z</u>oom In</button>');
		svl.ui.zoomControl.holder.append('<button id="zoom-out-button" class="button zoom-control-button"><img src="' + svl.rootDirectory + 'img/icons/ZoomOut.svg" class="zoom-button-icon" alt="Zoom out"><br />Zoom Out</button>');
		svl.ui.zoomControl.zoomIn = $fixture.find("#zoom-in-button");
		svl.ui.zoomControl.zoomOut = $fixture.find("#zoom-out-button");

		canvas = new CanvasMock();
		mapService = new MapServiceMock();
		tracker = new TrackerMock();
		zoomControl = new ZoomControl(canvas, mapService, tracker, svl.ui.zoomControl);
	});

	describe("The method getStatus", function () {
		it("should warn when an illegal key is passed.", function () {
			expect(function() {zoomControl.getStatus('invalid');} ).toThrow();
		});
		it("should get the status of valid key", function() {
			expect(zoomControl.getStatus('disableZoomIn')).toBe(false);
		});
	});

	describe("The method disableZoomIn", function() {
		it("should not allow it to zoom in", function() {
			zoomControl.disableZoomIn();
			expect(zoomControl.getStatus('disableZoomIn')).toBe(true);
			expect(zoomControl.zoomIn(1,1)).toBe(false);
		});
	});

	describe("The method disableZoomOut", function() {
		it("should not allow it to zoom out", function() {
			zoomControl.disableZoomOut();
			expect(zoomControl.getStatus('disableZoomOut')).toBe(true);
			expect(zoomControl.zoomOut(2,2)).toBe(false);
		});
	});

	describe("The method enableZoomIn", function() {
		it("should allow you to zoom in", function() {
			zoomControl.enableZoomIn();
			expect(zoomControl.getStatus('disableZoomIn')).toBe(false);
		});
	});

	describe("The method enableZoomOut", function() {
		it("should allow you to zoom Out", function() {
			zoomControl.enableZoomOut();
			expect(zoomControl.getStatus('disableZoomOut')).toBe(false);
		});
	});

	describe("The method getLock", function() {
		it("should warn when illegal key is passed.", function() {
			expect(function() {zoomControl.getLock('invalid');} ).toThrow();

		});
		it("should get valid lock status for valid key", function() {
			expect(zoomControl.getLock('disableZoomIn')).toBe(false);
		});
	});

	describe("The method lockDisableZoomIn", function() {
		it("should not allow user to enable zoom in", function() {
			zoomControl.disableZoomIn();
			expect(zoomControl.getStatus('disableZoomIn')).toBe(true);
			zoomControl.lockDisableZoomIn();
			expect(zoomControl.getLock('disableZoomIn')).toBe(true);
			zoomControl.enableZoomIn();
			expect(zoomControl.getStatus('disableZoomIn')).toBe(true);
			//reset lock status
			zoomControl.unlockDisableZoomIn();
		});
		it("should not allow user to disable zoom in", function() {
			zoomControl.enableZoomIn();
			expect(zoomControl.getStatus('disableZoomIn')).toBe(false);
			zoomControl.lockDisableZoomIn();
			expect(zoomControl.getLock('disableZoomIn')).toBe(true);
			zoomControl.disableZoomIn();
			expect(zoomControl.getStatus('disableZoomIn')).toBe(false);
			//reset lock status
			zoomControl.unlockDisableZoomIn();
		});
	});

	describe("The method lockDisableZoomOut", function() {
		it("should not allow user to enable zoom out", function() {
			zoomControl.disableZoomOut();
			expect(zoomControl.getStatus('disableZoomOut')).toBe(true);
			zoomControl.lockDisableZoomOut();
			expect(zoomControl.getLock('disableZoomOut')).toBe(true);
			zoomControl.enableZoomOut();
			expect(zoomControl.getStatus('disableZoomOut')).toBe(true);
			//reset lock status
			zoomControl.unlockDisableZoomOut();
		});
		it("should not allow user to disable zoom Out", function() {
			zoomControl.enableZoomOut();
			expect(zoomControl.getStatus('disableZoomOut')).toBe(false);
			zoomControl.lockDisableZoomOut();
			expect(zoomControl.getLock('disableZoomOut')).toBe(true);
			zoomControl.disableZoomOut();
			expect(zoomControl.getStatus('disableZoomOut')).toBe(false);
			//reset lock status
			zoomControl.unlockDisableZoomOut();
		});
	});

	describe("The method getProperties", function() {
		it("should warn when illegal key is passed.", function() {
			expect(function() {zoomControl.getProperties('invalid');} ).toThrow();

		});
		it("should get valid properties status for valid key", function() {
			zoomControl.setMaxZoomLevel(4)
			expect(zoomControl.getProperties('maxZoomLevel')).toBe(4);
		});
	});

	describe("The method setMaxZoomLevel", function() {
		it("should set the MaxZoomLevel", function() {
			zoomControl.setMaxZoomLevel(100);
			expect(zoomControl.getProperties('maxZoomLevel')).toBe(100);
		});
	});

	describe("The method setMinZoomLevel", function() {
		it("should set the MinZoomLevel", function() {
			zoomControl.setMinZoomLevel(-100);
			expect(zoomControl.getProperties('minZoomLevel')).toBe(-100);
		});
	});

	describe("The method unlockDisableZoomIn", function() {
		it("should allow user to enable zoom in", function() {
			zoomControl.disableZoomIn();
			expect(zoomControl.getStatus('disableZoomIn')).toBe(true);
			zoomControl.unlockDisableZoomIn();
			expect(zoomControl.getLock('disableZoomIn')).toBe(false);
			zoomControl.enableZoomIn();
			expect(zoomControl.getStatus('disableZoomIn')).toBe(false);
		});
		it("should allow user to disable zoom in", function() {
			zoomControl.enableZoomIn();
			expect(zoomControl.getStatus('disableZoomIn')).toBe(false);
			zoomControl.unlockDisableZoomIn();
			expect(zoomControl.getLock('disableZoomIn')).toBe(false);
			zoomControl.disableZoomIn();
			expect(zoomControl.getStatus('disableZoomIn')).toBe(true);
		});
	});

	describe("The method unlockDisableZoomOut", function() {
		it("should allow user to enable zoom out", function() {
			zoomControl.disableZoomOut();
			expect(zoomControl.getStatus('disableZoomOut')).toBe(true);
			zoomControl.unlockDisableZoomOut();
			expect(zoomControl.getLock('disableZoomOut')).toBe(false);
			zoomControl.enableZoomOut();
			expect(zoomControl.getStatus('disableZoomOut')).toBe(false);
		});
		it("should allow user to disable zoom in", function() {
			zoomControl.enableZoomOut();
			expect(zoomControl.getStatus('disableZoomOut')).toBe(false);
			zoomControl.unlockDisableZoomOut();
			expect(zoomControl.getLock('disableZoomOut')).toBe(false);
			zoomControl.disableZoomOut();
			expect(zoomControl.getStatus('disableZoomOut')).toBe(true);
		});
	});

	describe("The method pointZoomIn", function() {
		it("should return false if disableZoomIn is true", function() {
			zoomControl.disableZoomIn();
			expect(zoomControl.getStatus('disableZoomIn')).toBe(true);
			expect(zoomControl.pointZoomIn()).toBe(false);
		});
	});

	describe("The method zoomIn", function() {
		it("should return false if disableZoomIn is true", function() {
			zoomControl.disableZoomIn();
			expect(zoomControl.getStatus('disableZoomIn')).toBe(true);
			expect(zoomControl.zoomIn()).toBe(false);
		});
	});

	describe("The method zoomOut", function() {
		it("should return flase if disableZoomOut is true", function() {
			zoomControl.disableZoomOut();
			expect(zoomControl.getStatus('disableZoomOut')).toBe(true);
			expect(zoomControl.zoomOut()).toBe(false);
		});
	});

	function CanvasMock () { }

	function MapServiceMock () { }

	function TrackerMock () {
		this.push = function (item) {};
	}
});