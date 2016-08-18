describe("ModalMissionCompleteProgressBar tests", function () {
	var bar;

	beforeEach( function () {
		$uiModalMissionCompleteFixture = $('<div id="modal-mission-complete-complete-bar"></div>');
		uiModalMissionComplete = {};
		uiModalMissionComplete.completeBar = $uiModalMissionCompleteFixture

		bar = new ModalMissionCompleteProgressBar(uiModalMissionComplete);
	});
	

	describe("creating new object", function () {
		it("should initialize svg elements", function () {
			expect(bar).not.toBe(null);
			expect($uiModalMissionCompleteFixture.find('svg')).not.toBe(null);
			expect($uiModalMissionCompleteFixture.find('svg').attr('width')).toBe('275');
			expect($uiModalMissionCompleteFixture.find('svg').attr('height')).toBe('20');
			expect($uiModalMissionCompleteFixture.find('.g-background')).not.toBe(null);
			expect($uiModalMissionCompleteFixture.find('.g-bar-chart').length).toBe(2);
		});
		it("should initialize green bar styles", function () {
			var blueBar = $uiModalMissionCompleteFixture.find('#blue-bar');
			expect(blueBar).not.toBe(null);
			expect(blueBar.attr('x')).toBe('0');
			expect(blueBar.attr('y')).toBe('0');
			expect(blueBar.attr('fill')).toBe('rgba(49,130,189,1)');
			expect(blueBar.attr('width')).toBe('0');
			expect(blueBar.attr('height')).toBe('20');
		});
		it("should initialize green bar styles", function() {
			var greenBar = $uiModalMissionCompleteFixture.find('#green-bar');
			expect(greenBar).not.toBe(null);
			expect(greenBar.attr('x')).toBe('0');
			expect(greenBar.attr('y')).toBe('0');
			expect(greenBar.attr('fill')).toBe('rgba(100,240,110,1)');
			expect(greenBar.attr('width')).toBe('0');
			expect(greenBar.attr('height')).toBe('20');
		});
		it("should initialize text", function () {
			var barText = $uiModalMissionCompleteFixture.find('#bar-text');
			expect(barText).not.toBe(null);
			expect(barText.attr('style')).toBe('visibility: hidden;');
			expect(barText.attr('x')).toBe('3');
			expect(barText.attr('y')).toBe('15');
			expect(barText.attr('fill')).toBe('white');
			expect(barText.attr('font-size')).toBe('10pt');
		});
	});

	describe("update method 20%", function() {
		describe("with 20% mission completion rate", function() {
			it("should change bar width and text", function (done) {
				// missionDistanceRate = 10%
				// auditedDistanceRate = 10%
				bar.update(0.1, 0.1);
				var greenBar = $uiModalMissionCompleteFixture.find('#green-bar');
				var blueBar = $uiModalMissionCompleteFixture.find('#blue-bar');
				var barText = $uiModalMissionCompleteFixture.find('#bar-text');

				setTimeout(function () { 
					expect(greenBar.attr('width')).toBe('27.5');
					expect(blueBar.attr('width')).toBe('27.5');
					expect(barText.html()).toBe('20%');
					done(); 
				}, 2000);
			});
		});

		describe("with 10% mission completion rate", function() {
			it("should change bar width and text", function (done) {
				// missionDistanceRate = 10%
				// auditedDistanceRate = 0%
				bar.update(0.1, 0);
				var greenBar = $uiModalMissionCompleteFixture.find('#green-bar');
				var blueBar = $uiModalMissionCompleteFixture.find('#blue-bar');
				var barText = $uiModalMissionCompleteFixture.find('#bar-text');

				setTimeout(function () { 
					expect(greenBar.attr('width')).toBe('27.5');
					expect(blueBar.attr('width')).toBe('0');
					expect(barText.html()).toBe('10%');
					done(); 
				}, 2000);
				
			});
		});

		describe("with 100% mission completion rate", function() {
			it("should change bar width and text", function (done) {
				// missionDistanceRate = 70%
				// auditedDistanceRate = 30%
				bar.update(0.7, 0.3);
				var greenBar = $uiModalMissionCompleteFixture.find('#green-bar');
				var blueBar = $uiModalMissionCompleteFixture.find('#blue-bar');
				var barText = $uiModalMissionCompleteFixture.find('#bar-text');

				setTimeout(function () { 
					expect(greenBar.attr('width')).toBe('192.5');
					expect(greenBar.attr('x')).toBe('82.5');
					expect(blueBar.attr('width')).toBe('82.5');
					expect(barText.html()).toBe('100%');
					done(); 
				}, 2000);
			});
		});
	});

	
});